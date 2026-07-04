// Adapta Web — reverse-adapter for agent.adapta.one's agentic chat.
//
// Ported from OmniRoute's adapta-web executor to ExtremeRouter's executor pattern.
// Adapta is an agentic-chat web app (NOT an OpenAI-compatible API). This executor bridges it by:
//   1. Exchanging the long-lived Clerk `__client` JWT for a short-lived session JWT via
//      Clerk's /v1/client (active session id) + /v1/client/sessions/{id}/tokens endpoints.
//      The session JWT is cached in-process and auto-refreshed ~30s before expiry.
//   2. POSTing to /api/chat/stream/v1 — a Vercel AI SDK SSE stream emitting text-delta / text-end
//      / error / done frames — with `Authorization: Bearer <sessionJwt>`.
//   3. Translating those frames into OpenAI chat.completion.chunk frames (streaming) or
//      aggregating into a single chat.completion JSON (non-streaming).
//
// Credential input (apiKey field): the `__client` cookie value from clerk.agent.adapta.one.
// Users paste either the bare JWT or the full `__client=<jwt>` pair; extractClientJwt() handles
// both. The system prompt (if any) is injected into the first user message, since Adapta has no
// dedicated system role.

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Provider config from the registry loader (buildTransport() in providers/index.js flattens
// `transport` to the top level, so baseUrl lives at CFG.baseUrl — see grok-web executor). We fall
// back to the known constants so this module loads even before its registry entry is wired into
// index.js (the registry index is auto-generated separately).
const CFG = PROVIDERS["adapta-web"] || {};
const ADAPTA_STREAM_URL = CFG.baseUrl || "https://agent.adapta.one/api/chat/stream/v1";
const ADAPTA_APP_URL = "https://agent.adapta.one";
const ADAPTA_CLERK_URL = "https://clerk.agent.adapta.one";

// Default Adapta internal model id ("ONE" / auto-select). All exposed models currently map to
// this id — Adapta's own model picker decides the underlying model. Add more ids as discovered.
const DEFAULT_AI_MODEL_ID = 14;
const MODEL_ID_MAP = {
  "adapta-one": 14,
  "adapta-gpt": 14,
  "adapta-claude": 14,
  "adapta-gemini": 14,
  "adapta-grok": 14,
  "adapta-deepseek": 14,
  "adapta-llama": 14,
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// ─── In-memory session-JWT cache ─────────────────────────────────────────────
// Keyed by the first 32 chars of the stored __client JWT (stable identifier for the long-lived
// credential). A fresh session JWT is minted from Clerk and reused until ~30s before its exp.

const sessionCache = new Map(); // clientJwtKey → { jwt, jwtExpiresAt }

function cacheKey(clientJwt) {
  return clientJwt.slice(0, 32);
}

function cachedJwt(clientJwt) {
  const entry = sessionCache.get(cacheKey(clientJwt));
  if (!entry) return null;
  if (Date.now() >= entry.jwtExpiresAt - 30_000) return null; // 30s pre-expiry buffer
  return entry.jwt;
}

function storeSession(clientJwt, jwt, expMs) {
  sessionCache.set(cacheKey(clientJwt), { jwt, jwtExpiresAt: expMs });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Accept either the bare JWT value or the full `__client=<jwt>` pair the user may paste.
function extractClientJwt(rawApiKey) {
  const trimmed = (rawApiKey || "").trim();
  const eqIdx = trimmed.indexOf("=");
  // A bare JWT starts with "eyJ"; a `name=value` pair does not.
  if (eqIdx > 0 && !trimmed.startsWith("eyJ")) {
    return trimmed.slice(eqIdx + 1).trim();
  }
  return trimmed;
}

// Decode the `exp` claim from a JWT without verifying the signature (we only need the expiry
// to decide when to refresh). Returns unix ms, or 0 if unparseable.
function jwtExpMs(jwt) {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return 0;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function makeErrorResponse(status, message, code) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code: code || `HTTP_${status}` } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === "text")
      .map((c) => String(c.text ?? ""))
      .join("");
  }
  return String(content ?? "");
}

// Build the Adapta messages array. Adapta has no system role, so any system/developer messages
// are concatenated and prepended to the FIRST user message.
function buildAdaptaMessages(messages) {
  let systemText = "";
  const rest = [];
  for (const msg of messages) {
    const role = msg.role === "developer" ? "system" : msg.role;
    if (role === "system") {
      systemText += (systemText ? "\n" : "") + extractText(msg.content);
    } else {
      rest.push(msg);
    }
  }

  const adapted = [];
  let systemInjected = false;
  for (const msg of rest) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = extractText(msg.content);
    if (!text.trim()) continue;
    if (!systemInjected && systemText && msg.role === "user") {
      adapted.push({ role: "user", parts: [{ type: "text", text: `${systemText}\n\n${text}` }] });
      systemInjected = true;
    } else {
      adapted.push({ role: msg.role, parts: [{ type: "text", text }] });
    }
  }
  return adapted;
}

// ─── Clerk auth flow ─────────────────────────────────────────────────────────

// Step 1: GET /v1/client → returns the active session id for this __client cookie.
async function getSessionId(clientJwt, proxyOptions, signal, log) {
  const resp = await proxyAwareFetch(
    `${ADAPTA_CLERK_URL}/v1/client`,
    {
      headers: {
        Cookie: `__client=${clientJwt}`,
        "User-Agent": USER_AGENT,
        Origin: ADAPTA_APP_URL,
      },
      signal,
    },
    proxyOptions
  );
  if (!resp.ok) {
    throw Object.assign(
      new Error(`Clerk /v1/client returned HTTP ${resp.status} — check your __client cookie`),
      { status: resp.status }
    );
  }
  const body = await resp.json().catch(() => ({}));
  const sessions = Array.isArray(body?.response?.sessions) ? body.response.sessions : [];
  const active = sessions.find((s) => s && s.status === "active");
  if (!active?.id) {
    throw Object.assign(
      new Error("No active Clerk session found — your __client cookie may be expired or invalid"),
      { status: 401 }
    );
  }
  log?.info?.("ADAPTA-WEB", `Got session ID: ${active.id}`);
  return active.id;
}

// Step 2: POST /v1/client/sessions/{id}/tokens → a fresh short-lived JWT.
async function refreshSessionJwt(clientJwt, sessionId, proxyOptions, signal, log) {
  const resp = await proxyAwareFetch(
    `${ADAPTA_CLERK_URL}/v1/client/sessions/${sessionId}/tokens`,
    {
      method: "POST",
      headers: {
        Cookie: `__client=${clientJwt}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Origin: ADAPTA_APP_URL,
      },
      signal,
    },
    proxyOptions
  );
  if (!resp.ok) {
    throw Object.assign(new Error(`Clerk token refresh returned HTTP ${resp.status}`), {
      status: resp.status,
    });
  }
  const body = await resp.json().catch(() => ({}));
  const jwt = body?.jwt;
  if (typeof jwt !== "string" || !jwt.startsWith("eyJ")) {
    throw Object.assign(new Error("Clerk token refresh did not return a valid JWT"), { status: 502 });
  }
  log?.info?.("ADAPTA-WEB", `Got fresh session JWT (${jwt.length} chars)`);
  return jwt;
}

// Returns a valid (non-expired) session JWT, refreshing via Clerk when the cached one is stale.
async function getSessionJwt(clientJwt, proxyOptions, signal, log) {
  const cached = cachedJwt(clientJwt);
  if (cached) {
    log?.info?.("ADAPTA-WEB", "Using cached session JWT");
    return cached;
  }
  const sessionId = await getSessionId(clientJwt, proxyOptions, signal, log);
  const jwt = await refreshSessionJwt(clientJwt, sessionId, proxyOptions, signal, log);
  storeSession(clientJwt, jwt, jwtExpMs(jwt) || Date.now() + 55_000);
  return jwt;
}

// ─── SSE transform: Adapta (Vercel AI SDK) → OpenAI ──────────────────────────
// Adapta emits `data: {"type":"text-delta","delta":"…"}` frames (plus text-end/error/done).
// The "quick-response" id is a loading placeholder we suppress. We translate to OpenAI chunks.

function transformStream(adaptaStream, model, signal, cid, created) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      let roleEmitted = false;
      let buffer = "";

      const push = (delta, finishReason = null) =>
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
            })
          )
        );

      const reader = adaptaStream.getReader();
      const ensureRole = () => {
        if (!roleEmitted) {
          roleEmitted = true;
          push({ role: "assistant", content: "" });
        }
      };
      const finalize = () => {
        ensureRole();
        push({}, "stop");
        controller.enqueue(encoder.encode(SSE_DONE));
        try { controller.close(); } catch { /* already closed */ }
      };

      try {
        while (true) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (!payload) continue;
            let event;
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }
            const type = event.type;

            if (type === "text-delta") {
              if (event.id === "quick-response") continue; // loading placeholder
              const delta = event.delta;
              if (typeof delta === "string" && delta.length > 0) {
                ensureRole();
                push({ content: delta });
              }
            } else if (type === "text-end") {
              if (event.id === "quick-response") continue;
              // real text ended; more events may follow
            } else if (type === "error") {
              const errText = String(event.errorText ?? "Adapta upstream error");
              ensureRole();
              push({ content: `\n\n[Error: ${errText}]` });
              finalize();
              return;
            } else if (type === "done" || type === "end") {
              finalize();
              return;
            }
          }
        }
      } catch {
        // Stream aborted or network error — emit what we have.
      }
      finalize();
    },
  });
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class AdaptaWebExecutor extends BaseExecutor {
  constructor() {
    super("adapta-web", CFG);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    // 1. Extract + validate credentials.
    const rawKey = String(credentials?.apiKey ?? "");
    if (!rawKey) {
      return {
        response: makeErrorResponse(
          401,
          "Missing Adapta credentials — paste your __client cookie from clerk.agent.adapta.one",
          "NO_COOKIE"
        ),
        url: ADAPTA_STREAM_URL, headers: {}, transformedBody: body,
      };
    }
    const clientJwt = extractClientJwt(rawKey);

    // 2. Obtain a short-lived session JWT (cached, auto-refreshed).
    let sessionJwt;
    try {
      log?.info?.("ADAPTA-WEB", "Obtaining session JWT via Clerk...");
      sessionJwt = await getSessionJwt(clientJwt, proxyOptions, signal, log);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      const msg = err?.message || String(err);
      log?.warn?.("ADAPTA-WEB", `Auth failed: ${msg}`);
      return {
        response: makeErrorResponse(err?.status || 401, `Adapta auth failed: ${msg}`, "AUTH_FAILED"),
        url: ADAPTA_STREAM_URL, headers: {}, transformedBody: body,
      };
    }

    // 3. Build Adapta request body.
    const aiModelId = MODEL_ID_MAP[model] ?? DEFAULT_AI_MODEL_ID;
    const adaptaMessages = buildAdaptaMessages(messages);
    if (adaptaMessages.length === 0) {
      return {
        response: makeErrorResponse(400, "No messages provided", "INVALID_REQUEST"),
        url: ADAPTA_STREAM_URL, headers: {}, transformedBody: body,
      };
    }

    const requestPayload = { messages: adaptaMessages, aiModelId };
    const headers = {
      Authorization: `Bearer ${sessionJwt}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": USER_AGENT,
      Origin: ADAPTA_APP_URL,
      Referer: `${ADAPTA_APP_URL}/agentic-chat`,
    };

    log?.info?.(
      "ADAPTA-WEB",
      `POST ${ADAPTA_STREAM_URL} | model=${model} aiModelId=${aiModelId} msgs=${adaptaMessages.length}`
    );

    // 4. Fire request.
    let resp;
    try {
      resp = await proxyAwareFetch(
        ADAPTA_STREAM_URL,
        { method: "POST", headers, body: JSON.stringify(requestPayload), signal },
        proxyOptions
      );
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      const msg = err?.message || String(err);
      log?.error?.("ADAPTA-WEB", `Fetch failed: ${msg}`);
      return {
        response: makeErrorResponse(502, `Adapta connection failed: ${msg}`, "ADAPTA_FETCH_FAILED"),
        url: ADAPTA_STREAM_URL, headers, transformedBody: requestPayload,
      };
    }

    if (!resp.ok) {
      let errMsg = `Adapta error HTTP ${resp.status}`;
      if (resp.status === 401 || resp.status === 403) {
        errMsg = "Adapta session expired or invalid — re-paste your __client cookie from clerk.agent.adapta.one";
        sessionCache.delete(cacheKey(clientJwt)); // force re-auth next turn
      } else if (resp.status === 429) {
        errMsg = "Adapta rate limited — wait and retry";
      }
      log?.warn?.("ADAPTA-WEB", errMsg);
      return {
        response: makeErrorResponse(resp.status, errMsg, `HTTP_${resp.status}`),
        url: ADAPTA_STREAM_URL, headers, transformedBody: requestPayload,
      };
    }

    if (!resp.body) {
      return {
        response: makeErrorResponse(502, "Adapta returned an empty response body", "ADAPTA_EMPTY_BODY"),
        url: ADAPTA_STREAM_URL, headers, transformedBody: requestPayload,
      };
    }

    const cid = `chatcmpl-adp-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    // 5a. Streaming: translate Adapta SSE → OpenAI chunks.
    if (stream) {
      const sseStream = transformStream(resp.body, model, signal, cid, created);
      return {
        response: new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
        url: ADAPTA_STREAM_URL, headers, transformedBody: requestPayload,
      };
    }

    // 5b. Non-streaming: aggregate all text-delta events into one chat.completion.
    const decoder = new TextDecoder();
    const reader = resp.body.getReader();
    let buf = "";
    let fullText = "";
    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "text-delta" && ev.id !== "quick-response") {
              fullText += String(ev.delta ?? "");
            }
          } catch {
            // skip unparseable
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      response: new Response(
        JSON.stringify({
          id: cid, object: "chat.completion", created, model, system_fingerprint: null,
          choices: [
            { index: 0, message: { role: "assistant", content: fullText }, finish_reason: "stop", logprobs: null },
          ],
          usage: {
            prompt_tokens: Math.ceil(fullText.length / 4),
            completion_tokens: Math.ceil(fullText.length / 4),
            total_tokens: Math.ceil(fullText.length / 2),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      url: ADAPTA_STREAM_URL, headers, transformedBody: requestPayload,
    };
  }
}

export default AdaptaWebExecutor;
