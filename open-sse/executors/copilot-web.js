// CopilotWebExecutor — Microsoft Copilot Web session provider (web-cookie category).
//
// Routes requests through copilot.microsoft.com's WebSocket API, translating between the
// OpenAI chat completions format and Copilot's proprietary WebSocket event protocol.
//
// Protocol:
//   1. POST /c/api/start → conversationId (+ session cookies)
//   2. WS connect wss://copilot.microsoft.com/c/api/chat?api-version=2
//   3. Send: { event: "send", conversationId, content, mode }
//   4. Receive: stream of JSON events (appendText, chainOfThought, done, error, ...)
//
// Auth: access_token from copilot.microsoft.com (extracted from browser DevTools or a HAR
// file), pasted into the apiKey credential field. Anonymous access is supported with limited
// models (may hit a Cloudflare challenge that requires an authenticated token).
//
// WebSocket transport: Node 22+ exposes a native global `WebSocket`, but it does NOT allow
// custom headers (the access token must travel as `Authorization: Bearer`). We therefore try
// to dynamically `import("ws")` (which supports a headers option) and fall back to the native
// global if the `ws` package is absent. With native global + a token we attach the token as a
// query parameter as a last resort so authenticated sessions still work.
//
// Ported from OmniRoute's open-sse/executors/copilot-web.ts (TypeScript), adapted to
// ExtremeRouter's ESM executor pattern (see grok-web.js / chatglm-cn.js).
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { createHash } from "node:crypto";

// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at PROVIDERS["copilot-web"].baseUrl (not .transport.baseUrl). That URL is the
// WebSocket chat endpoint; we derive the HTTP start URL from the base host.
const COPILOT_WS_URL = PROVIDERS["copilot-web"].baseUrl; // wss://copilot.microsoft.com/c/api/chat?api-version=2
const COPILOT_BASE = "https://copilot.microsoft.com";
const COPILOT_START_URL = `${COPILOT_BASE}/c/api/start`;

const COPILOT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// WebSocket overall timeout — Copilot streams can be long, but a hung socket with no frames
// should still abort so the client isn't left waiting forever.
const WS_TIMEOUT_MS = 120_000;

// Model id → Copilot mode.
const MODEL_MODE_MAP = {
  copilot: "chat",
  "copilot-chat": "chat",
  "gpt-4o": "chat",
  "gpt-4": "chat",
  "copilot-think": "reasoning",
  "copilot-think-deeper": "reasoning",
  o1: "reasoning",
  o3: "reasoning",
  "copilot-smart": "smart",
  "copilot-gpt5": "smart",
  "gpt-5": "smart",
  "copilot-study": "chat",
};
const DEFAULT_MODE = "chat";

// Hashcash difficulty cap. The upstream supplies `difficulty`; clamp it so a buggy/malicious
// server can't force effectively infinite work. 8 hex zeros is already ~2^32 expected
// iterations, far beyond the 10M iteration budget below.
const MAX_HASHCASH_DIFFICULTY = 8;

// ─── Session pool (singleton across executor instances) ─────────────────────

const sessionPool = new Map(); // poolKey → CopilotSession
const MIN_REMAINING_TURNS = 5;
const MAX_POOL_SIZE = 100;

function sessionPoolKey(token) {
  return token && token.length > 0 ? token : "anonymous";
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCopilotMode(model) {
  if (!model) return DEFAULT_MODE;
  return MODEL_MODE_MAP[String(model).toLowerCase()] || DEFAULT_MODE;
}

// Solve a hashcash proof-of-work: find i such that sha256(`${parameter}:${i}`) starts with
// `difficulty` hex zeros. Returns the solution counter, or null if not found / invalid.
function solveHashcash(parameter, difficulty) {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > MAX_HASHCASH_DIFFICULTY) {
    return null;
  }
  const prefix = "0".repeat(difficulty);
  for (let i = 0; i < 10_000_000; i++) {
    const hash = createHash("sha256").update(`${parameter}:${i}`).digest("hex");
    if (hash.startsWith(prefix)) return i;
  }
  return null;
}

// Extract an access token from whatever the user pasted: bare JWT, a `access_token=...`
// cookie pair, a `Bearer ...` header, or a full cookie blob.
function extractAccessToken(credential) {
  if (!credential) return null;
  const v = String(credential).trim();
  if (v.startsWith("ey") || v.length > 100) return v;
  const accessMatch = v.match(/access_token=([^;]+)/);
  if (accessMatch) return accessMatch[1];
  const bearerMatch = v.match(/[Bb]earer\s+(.+)/);
  if (bearerMatch) return bearerMatch[1].trim();
  return v;
}

// Flatten OpenAI array content parts (text only) into a plain string.
function textOf(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && (c.type === "text" || typeof c === "string"))
      .map((c) => (typeof c === "string" ? c : String(c.text || "")))
      .join("");
  }
  return String(content);
}

function errorResponse(status, message, code = "COPILOT_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function errorResult(status, message, url, transformedBody, code) {
  return { response: errorResponse(status, message, code), url, headers: {}, transformedBody };
}

// Redact long paths/tokens from upstream error strings before surfacing them.
function sanitizeErrorMessage(message) {
  const str = typeof message === "string" ? message : String(message ?? "");
  const nl = str.indexOf("\n");
  const firstLine = nl >= 0 ? str.slice(0, nl) : str;
  return firstLine.replace(/[A-Za-z]:\\[^\s]+/g, "<path>").replace(/\/[^\s"']+/g, (m) =>
    m.length > 40 ? "<path>" : m
  );
}

// ─── Session management ────────────────────────────────────────────────────

// Create a fresh session via POST /c/api/start. Throws on auth/transport failure (caller
// surfaces a 502).
async function createSession(accessToken, proxyOptions, signal) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": COPILOT_USER_AGENT,
    Origin: COPILOT_BASE,
    Referer: `${COPILOT_BASE}/`,
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await proxyAwareFetch(
    COPILOT_START_URL,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        timeZone: "America/New_York",
        startNewConversation: true,
        teenSupportEnabled: false,
      }),
      signal,
    },
    proxyOptions
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Copilot /c/api/start failed (${res.status}): ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  const convId = data.currentConversationId || data.conversationId;
  if (!convId) throw new Error("Copilot /c/api/start returned no conversationId");

  // Capture Set-Cookie values (Node 18+ exposes getSetCookie()).
  let cookies = "";
  try {
    const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    cookies = setCookies.map((c) => c.split(";")[0]).join("; ");
  } catch {
    /* ignore */
  }

  return {
    conversationId: convId,
    cookies,
    remainingTurns: data.remainingTurns ?? 1000,
    isBlocked: data.isBlocked ?? false,
    createdAt: Date.now(),
  };
}

// Get or create a session, rotating when turns run low or the session is blocked/old.
async function getSession(accessToken, proxyOptions, signal) {
  const poolKey = sessionPoolKey(accessToken);
  const existing = sessionPool.get(poolKey);
  if (
    existing &&
    !existing.isBlocked &&
    existing.remainingTurns > MIN_REMAINING_TURNS &&
    Date.now() - existing.createdAt < 3_600_000 // 1h max age
  ) {
    return existing;
  }
  const session = await createSession(accessToken, proxyOptions, signal);
  // Evict oldest entry (Map preserves insertion order) when at capacity.
  if (sessionPool.size >= MAX_POOL_SIZE) {
    sessionPool.delete(sessionPool.keys().next().value);
  }
  sessionPool.set(poolKey, session);
  return session;
}

// ─── WebSocket chat ────────────────────────────────────────────────────────

// Resolve a WebSocket constructor + connect. Prefers the `ws` npm module (supports custom
// headers for the Bearer token); falls back to the native global WebSocket.
async function openWebSocket(wsUrl, accessToken) {
  // Try the `ws` package first when we have a token (it can carry headers).
  if (accessToken) {
    try {
      // webpack-ignore: comment tells the bundler not to bundle `ws` (it's an optional dep).
      // The dynamic import still resolves at runtime if `ws` is installed.
      const mod = await import(/* webpackIgnore: true */ "ws");
      const WS = mod.WebSocket || mod.default;
      if (typeof WS === "function") {
        return new WS(wsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      }
    } catch {
      /* ws not installed — fall through to native */
    }
  }
  // Native global WebSocket (Node 22+). It cannot send custom headers, so with a token we
  // append it as a query param as a best-effort so authenticated sessions still work.
  const NativeWS = globalThis.WebSocket;
  if (typeof NativeWS !== "function") {
    throw new Error("No WebSocket implementation available (install the `ws` package or use Node 22+).");
  }
  const sep = wsUrl.includes("?") ? "&" : "?";
  const url = accessToken ? `${wsUrl}${sep}token=${encodeURIComponent(accessToken)}` : wsUrl;
  return new NativeWS(url);
}

// Open the Copilot WS, send the chat message, and return a ReadableStream of SSE bytes
// (OpenAI chat.completion.chunk frames). Handles the hashcash challenge handshake.
function wsChat({ conversationId, prompt, mode, accessToken, signal, model, cid, created }) {
  const wsUrl = `${COPILOT_WS_URL}&clientSessionId=${crypto.randomUUID()}`;
  const encoder = new TextEncoder();

  const pushChunk = (controller, delta) =>
    controller.enqueue(
      encoder.encode(
        sseChunk({
          id: cid,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: null,
          choices: [{ index: 0, delta, finish_reason: null, logprobs: null }],
        })
      )
    );

  return new ReadableStream({
    async start(controller) {
      let ws = null;
      let settled = false;
      let timeout = null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (ws) {
          try { ws.close(); } catch { /* */ }
          ws = null;
        }
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        try { controller.close(); } catch { /* */ }
      };
      const abort = (reason) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (reason) {
          pushChunk(controller, { content: `\n[Copilot error: ${reason}]` });
        }
        controller.enqueue(encoder.encode(SSE_DONE));
        try { controller.close(); } catch { /* */ }
      };

      if (signal) {
        if (signal.aborted) return abort("Request aborted");
        signal.addEventListener("abort", () => abort("Request aborted"), { once: true });
      }

      try {
        ws = await openWebSocket(wsUrl, accessToken);
        timeout = setTimeout(() => abort("Copilot WebSocket timeout"), WS_TIMEOUT_MS);

        let chatSent = false;
        const sendChat = () => {
          if (chatSent) return;
          chatSent = true;
          ws.send(
            JSON.stringify({
              event: "send",
              conversationId,
              content: [{ type: "text", text: prompt }],
              mode,
            })
          );
        };

        ws.onopen = () => sendChat();

        ws.onmessage = (ev) => {
          try {
            const raw = ev.data instanceof ArrayBuffer ? new TextDecoder().decode(ev.data) : String(ev.data);
            const event = JSON.parse(raw);
            switch (event.event) {
              case "challenge": {
                if (event.method === "hashcash" && event.parameter) {
                  const parts = String(event.parameter).split(":");
                  const param = parts[0];
                  const difficulty = parseInt(parts[1] || "1", 10);
                  const solution = solveHashcash(param, difficulty);
                  ws.send(
                    JSON.stringify({
                      event: "challengeResponse",
                      token: solution !== null ? String(solution) : "",
                      method: "hashcash",
                    })
                  );
                  // Re-send chat after solving the challenge.
                  chatSent = false;
                  sendChat();
                } else if (event.method === "cloudflare") {
                  abort(
                    "Copilot requires Cloudflare Turnstile verification. Use an authenticated session (access_token)."
                  );
                } else {
                  abort(`Copilot challenge "${event.method}" not supported. Use an authenticated session.`);
                }
                break;
              }
              case "appendText": {
                if (event.text) pushChunk(controller, { content: event.text });
                break;
              }
              case "chainOfThought": {
                if (event.text) pushChunk(controller, { reasoning_content: event.text });
                break;
              }
              case "replaceText": {
                if (event.text) pushChunk(controller, { content: event.text });
                break;
              }
              case "imageGenerated": {
                if (event.url) {
                  pushChunk(controller, {
                    content: [{ type: "image_url", image_url: { url: event.url, detail: "auto" } }],
                  });
                }
                break;
              }
              case "citation": {
                if (event.url) {
                  pushChunk(controller, {
                    annotations: [
                      { type: "url_citation", url_citation: { url: event.url, title: event.title || event.url } },
                    ],
                  });
                }
                break;
              }
              case "suggestedFollowups": {
                if (Array.isArray(event.suggestions) && event.suggestions.length) {
                  pushChunk(controller, {
                    content: `\n\n**Suggested follow-ups:**\n${event.suggestions.map((s) => `- ${s}`).join("\n")}`,
                  });
                }
                break;
              }
              case "done": {
                controller.enqueue(
                  encoder.encode(
                    sseChunk({
                      id: cid,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      system_fingerprint: null,
                      choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
                    })
                  )
                );
                controller.enqueue(encoder.encode(SSE_DONE));
                finish();
                break;
              }
              case "error": {
                abort(event.error || "Copilot stream error");
                break;
              }
              default:
                break; // connected, received, etc.
            }
          } catch {
            /* skip unparseable */
          }
        };

        ws.onerror = (err) => {
          const msg = err?.message || "Copilot WebSocket error";
          abort(msg);
        };
        ws.onclose = () => finish();
      } catch (err) {
        abort(err?.message || "Failed to connect to Copilot");
      }
    },
  });
}

// ─── Executor ──────────────────────────────────────────────────────────────

export class CopilotWebExecutor extends BaseExecutor {
  constructor() {
    super("copilot-web", PROVIDERS["copilot-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};
    const inputModel = model || bodyObj.model || "copilot";
    const mode = getCopilotMode(inputModel);
    const wantStream = stream !== false;

    const rawCred = credentials?.apiKey || credentials?.providerSpecificData?.cookie || "";
    const accessToken = extractAccessToken(rawCred);

    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    const userMsgs = messages.filter((m) => m.role === "user");
    const systemMsgs = messages.filter((m) => m.role === "system" || m.role === "developer");
    const userMsg = userMsgs[userMsgs.length - 1];
    const promptText = textOf(userMsg?.content);

    if (!promptText.trim()) {
      return errorResult(400, "No user message provided.", COPILOT_START_URL, null, "INVALID_REQUEST");
    }

    // Prefix the prompt with any system instructions so Copilot keeps role context.
    let fullPrompt = "";
    if (systemMsgs.length) {
      const sysText = systemMsgs.map((m) => textOf(m.content)).filter(Boolean).join("\n");
      if (sysText) fullPrompt += `[System Instructions]\n${sysText}\n\n`;
    }
    fullPrompt += promptText;

    const transformedBody = { conversationId: null, mode, prompt: fullPrompt.slice(0, 100) };

    // Obtain (or rotate) a session. Failure here surfaces as a 502.
    let conversationId;
    try {
      const session = await getSession(accessToken || undefined, proxyOptions, signal);
      conversationId = session.conversationId;
      log?.info?.("COPILOT-WEB", `Session conv=${conversationId}, mode=${mode}, len=${fullPrompt.length}, stream=${wantStream}`);
    } catch (err) {
      const msg = sanitizeErrorMessage(err?.message || "Failed to start Copilot conversation");
      log?.error?.("COPILOT-WEB", `start failed: ${msg}`);
      return errorResult(err?.status || 502, msg, COPILOT_START_URL, transformedBody, err?.status ? `HTTP_${err.status}` : "START_FAILED");
    }
    transformedBody.conversationId = conversationId;

    const cid = `chatcmpl-copilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const created = Math.floor(Date.now() / 1000);

    const wsStream = wsChat({
      conversationId,
      prompt: fullPrompt,
      mode,
      accessToken: accessToken || undefined,
      signal,
      model: inputModel,
      cid,
      created,
    });

    if (!wantStream) {
      // Non-streaming: aggregate the SSE stream into a single chat.completion JSON.
      try {
        const reader = wsStream.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let reasoningText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = decoder.decode(value, { stream: true }).split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                if (typeof delta.content === "string") fullText += delta.content;
                else fullText += JSON.stringify(delta.content);
              }
              if (delta?.reasoning_content) reasoningText += delta.reasoning_content;
            } catch {
              /* skip */
            }
          }
        }

        const message = { role: "assistant", content: fullText || "(empty response)" };
        if (reasoningText) message.reasoning_content = reasoningText;
        return {
          response: new Response(
            JSON.stringify({
              id: cid,
              object: "chat.completion",
              created,
              model: inputModel,
              system_fingerprint: null,
              choices: [{ index: 0, message, finish_reason: "stop", logprobs: null }],
              usage: {
                prompt_tokens: Math.ceil(fullPrompt.length / 4),
                completion_tokens: Math.ceil(fullText.length / 4),
                total_tokens: Math.ceil((fullPrompt.length + fullText.length) / 4),
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          ),
          url: COPILOT_WS_URL,
          headers: {},
          transformedBody,
        };
      } catch (err) {
        return errorResult(502, err?.message || "Copilot non-streaming error", COPILOT_WS_URL, transformedBody);
      }
    }

    // Streaming: pipe the WebSocket→SSE stream straight through.
    return {
      response: new Response(wsStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
      url: COPILOT_WS_URL,
      headers: {},
      transformedBody,
    };
  }
}

export default CopilotWebExecutor;
