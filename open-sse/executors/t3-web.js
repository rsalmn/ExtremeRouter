import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// T3ChatWebExecutor — t3.chat Session Provider (consumer web reverse).
//
// Routes requests through t3.chat using cookie-based session auth. t3.chat is a TanStack
// Start app — requests go to `/api/chat`. Response format is TSS (Turbo Stream
// Serialization, application/x-tss-framed) or NDJSON streaming.
//
// Auth: cookies (including the convex-session-id cookie) — all required.
// Plain text chat only — tool/function-calling is intentionally NOT supported.

const T3_CHAT_BASE = PROVIDERS["t3-web"].baseUrl; // https://t3.chat
const COMPLETION_URL = `${T3_CHAT_BASE}/api/chat`;
const SERVER_FN_PLACEHOLDER = `${T3_CHAT_BASE}/_serverFn/...`;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// TanStack Start accepts these content types, in priority order.
const TSS_ACCEPT = "application/x-tss-framed, application/x-ndjson, application/json";

function errorResponse(status, message, code) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code: code || `HTTP_${status}` } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// ─── Cookie parsing ─────────────────────────────────────────────────────────
// Parse the single stored credential into { cookieHeader, convexSessionId }.
// Accepted forms:
//   (a) "convex-session-id=abc; sessionToken=xyz"      — plain Cookie header
//   (b) full Cookie header already containing convex-session-id=...
//   (c) "cookies=<Cookie header>\nconvexSessionId=<id>" — structured form
export function parseT3Credentials(creds) {
  const rawCreds = typeof creds === "object" && creds !== null ? creds : {};
  const raw = String(rawCreds.apiKey ?? rawCreds.accessToken ?? "").trim();
  if (!raw) return { cookieHeader: "", convexSessionId: "" };

  let cookieHeader = raw;
  let convexSessionId = "";

  if (raw.includes("convexSessionId") || raw.includes("convex-session-id")) {
    // Structured / multi-part format: split on separators and pull out the id.
    const parts = raw.split(/[,;\n]/).map((s) => s.trim());
    const cookieParts = [];
    for (const part of parts) {
      if (part.startsWith("convexSessionId=") || part.startsWith("convex-session-id=")) {
        convexSessionId = part.split("=").slice(1).join("=");
      } else if (part.startsWith("cookies=")) {
        cookieParts.push(part.slice("cookies=".length));
      } else if (part.includes("=")) {
        cookieParts.push(part);
      }
    }
    if (cookieParts.length) cookieHeader = cookieParts.join("; ");
  }

  // Append convex-session-id only when it was provided separately and isn't already embedded.
  const finalCookie =
    convexSessionId && !cookieHeader.includes("convex-session-id")
      ? `${cookieHeader}; convex-session-id=${convexSessionId}`
      : cookieHeader;

  // Derive convexSessionId from an embedded header form (b) for validation.
  if (!convexSessionId) {
    const m = finalCookie.match(/convex-session-id=([^;]+)/);
    if (m) convexSessionId = m[1].trim();
  }

  return { cookieHeader: finalCookie, convexSessionId };
}

export function validateT3Credentials(creds) {
  if (!creds) return false;
  return (
    typeof creds.cookieHeader === "string" && creds.cookieHeader.length > 0 &&
    typeof creds.convexSessionId === "string" && creds.convexSessionId.length > 0
  );
}

// Build standard TanStack Start headers matching live captured traffic.
function buildServerFnHeaders(cookieHeader) {
  return {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Accept: TSS_ACCEPT,
    Cookie: cookieHeader,
    Referer: `${T3_CHAT_BASE}/`,
    Origin: T3_CHAT_BASE,
  };
}

// ─── TSS Stream Transform (TanStack Start → OpenAI SSE) ─────────────────────
// Streaming responses use NDJSON lines (or SSE "data:" lines) with TSS-encoded payloads.
// Each line is a JSON object with typed fields: {t: type, i: id, p: {k: keys, v: values}, o: ordinal}

/**
 * Extract text content from a TSS-encoded payload.
 * TSS types: t=0 number, t=2 string/enum, t=9 array, t=10 object, t=11 null
 * Chat text typically comes as t=2 (string) in a streaming envelope.
 */
function extractTextFromTSS(data) {
  if (!data || typeof data !== "object") return null;
  // Direct string field (common in streaming deltas).
  if (typeof data.text === "string") return data.text;
  if (typeof data.delta === "string") return data.delta;
  if (typeof data.content === "string") return data.content;

  // TSS object envelope: {t:10, p:{k:["content"], v:[{t:2, s:"text"}]}}
  const p = data.p;
  if (p && p.k && p.v && Array.isArray(p.k) && Array.isArray(p.v)) {
    for (let i = 0; i < p.k.length; i++) {
      if (p.k[i] === "content" || p.k[i] === "text" || p.k[i] === "delta") {
        const val = p.v[i];
        if (typeof val === "string") return val;
        if (val && val.t === 2 && typeof val.s === "string") return val.s;
      }
    }
  }

  // Nested value envelope: {t:2, s:"some text"}
  if (data.t === 2 && typeof data.s === "string") return data.s;

  return null;
}

// Detect TSS end-of-stream markers.
function isTSSDone(data) {
  return (
    data?.type === "done" ||
    data?.done === true ||
    data?.status === "complete" ||
    data?.finish_reason === "stop"
  );
}

// Translate the upstream TSS/NDJSON/SSE stream into OpenAI chat.completion.chunk frames.
function transformTSSStream(upstreamStream, model, cid, created, signal) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let emittedRole = false;

  const chunk = (controller, delta, finish) => {
    controller.enqueue(
      encoder.encode(
        sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta, finish_reason: finish ?? null, logprobs: null }],
        })
      )
    );
  };

  const close = (controller) => {
    if (!emittedRole) {
      emittedRole = true;
      chunk(controller, { role: "assistant", content: "" });
    }
    chunk(controller, {}, "stop");
    controller.enqueue(encoder.encode(SSE_DONE));
  };

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamStream.getReader();
      let buffer = "";
      try {
        while (true) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Handle both NDJSON (newline-delimited) and SSE (data: prefix) formats.
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // SSE format: "data: {...}"
            const payload = trimmed.startsWith("data: ") ? trimmed.slice(6).trim() : trimmed;
            if (payload === "[DONE]") {
              close(controller);
              return;
            }

            let data;
            try {
              data = JSON.parse(payload);
            } catch {
              continue;
            }

            const textContent = extractTextFromTSS(data);
            if (typeof textContent === "string" && textContent.length > 0) {
              if (!emittedRole) {
                emittedRole = true;
                chunk(controller, { role: "assistant", content: "" });
              }
              chunk(controller, { content: textContent });
            }

            if (isTSSDone(data)) {
              close(controller);
              return;
            }
          }
        }
      } catch {
        // Stream error — fall through to close.
      } finally {
        try { reader.releaseLock(); } catch { /* */ }
      }
      close(controller);
      try { controller.close(); } catch { /* already closed */ }
    },
  });
}

// Collect all text from a non-streaming TSS/JSON/SSE response.
async function collectStreamContent(upstreamStream, signal) {
  const decoder = new TextDecoder();
  const reader = upstreamStream.getReader();
  let buffer = "";
  const parts = [];

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const payload = trimmed.startsWith("data: ") ? trimmed.slice(6).trim() : trimmed;
        if (payload === "[DONE]") break;
        try {
          const data = JSON.parse(payload);
          const text = extractTextFromTSS(data);
          if (typeof text === "string") parts.push(text);
        } catch {
          // skip
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* */ }
  }

  return parts.join("");
}

export class T3ChatWebExecutor extends BaseExecutor {
  constructor() {
    super("t3-web", PROVIDERS["t3-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};
    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];

    // Parse + validate credentials. The credential pipeline stores the single pasted
    // string as `apiKey` (fallback `accessToken`); parse out the Cookie header +
    // convex-session-id instead of expecting pre-structured fields.
    const parsed = parseT3Credentials(credentials);
    if (!validateT3Credentials(parsed)) {
      return {
        response: errorResponse(
          400,
          "t3.chat credentials invalid: paste your full Cookie header (including convex-session-id) from t3.chat.",
          "INVALID_CREDENTIALS"
        ),
        url: SERVER_FN_PLACEHOLDER,
        headers: {},
        transformedBody: body,
      };
    }

    if (messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array", "INVALID_REQUEST"),
        url: COMPLETION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Flatten OpenAI messages to plain {role, content} pairs (text only).
    const effectiveMessages = messages.map((m) => {
      let content = "";
      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content
          .filter((c) => c && (c.type === "text" || c.type === "input_text"))
          .map((c) => String(c.text || ""))
          .join("\n");
      }
      return { role: String(m.role || "user"), content };
    });

    const cookieHeader = parsed.cookieHeader;
    const headers = buildServerFnHeaders(cookieHeader);

    // t3.chat's /api/chat accepts OpenAI-compatible fields (model, messages, stream).
    const requestPayload = {
      model,
      messages: effectiveMessages,
      stream: stream !== false,
    };

    log?.info?.("T3-WEB", `POST ${COMPLETION_URL} model=${model}`);

    let resp;
    try {
      resp = await proxyAwareFetch(
        COMPLETION_URL,
        { method: "POST", headers, body: JSON.stringify(requestPayload), signal },
        proxyOptions
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("T3-WEB", `Fetch failed: ${msg}`);
      if (err?.name === "AbortError") {
        return {
          response: errorResponse(499, "Request cancelled", "ABORTED"),
          url: SERVER_FN_PLACEHOLDER,
          headers: {},
          transformedBody: body,
        };
      }
      return {
        response: errorResponse(502, `t3.chat connection error: ${msg}`, "FETCH_FAILED"),
        url: SERVER_FN_PLACEHOLDER,
        headers,
        transformedBody: body,
      };
    }

    if (!resp.ok) {
      const status = resp.status;
      let errMsg = `t3.chat API error (${status})`;
      if (status === 401 || status === 403) {
        errMsg = "t3.chat session expired or unauthorized — re-paste your cookies and convex-session-id.";
      } else if (status === 429) {
        errMsg = "t3.chat rate limited. Wait and retry.";
      }
      log?.warn?.("T3-WEB", errMsg);
      return {
        response: errorResponse(status, errMsg, `HTTP_${status}`),
        url: COMPLETION_URL,
        headers,
        transformedBody: requestPayload,
      };
    }

    const ct = resp.headers.get("content-type") || "";
    const cid = `chatcmpl-t3-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const modelId = model || "unknown";

    // Non-streaming full JSON response.
    if (ct.includes("application/json") && !ct.includes("ndjson")) {
      const json = await resp.json().catch(() => ({}));
      if (json?.error) {
        const errMsg = `t3.chat error: ${json.error?.message ?? JSON.stringify(json.error)}`;
        log?.warn?.("T3-WEB", errMsg);
        return {
          response: errorResponse(502, errMsg, "T3_ERROR"),
          url: COMPLETION_URL,
          headers,
          transformedBody: requestPayload,
        };
      }
      if (json?.choices) {
        // Already OpenAI-shaped — pass through (ensure standard envelope fields).
        const passthrough = {
          id: cid,
          object: "chat.completion",
          created,
          model: modelId,
          system_fingerprint: null,
          choices: json.choices,
          ...(json.usage ? { usage: json.usage } : {}),
        };
        return {
          response: new Response(JSON.stringify(passthrough), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
          url: COMPLETION_URL,
          headers,
          transformedBody: requestPayload,
        };
      }
      // TSS or plain response — extract content and wrap in OpenAI format.
      const content = extractTextFromTSS(json) ?? json?.message?.content ?? "";
      return {
        response: new Response(
          JSON.stringify({
            id: cid,
            object: "chat.completion",
            created,
            model: modelId,
            system_fingerprint: null,
            choices: [
              { index: 0, message: { role: "assistant", content: String(content) }, finish_reason: "stop", logprobs: null },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
        url: COMPLETION_URL,
        headers,
        transformedBody: requestPayload,
      };
    }

    // Streaming path (TSS, NDJSON, or SSE).
    if (!resp.body) {
      return {
        response: errorResponse(502, "t3.chat returned an empty response body", "EMPTY_BODY"),
        url: COMPLETION_URL,
        headers,
        transformedBody: requestPayload,
      };
    }

    if (stream !== false) {
      const openaiStream = transformTSSStream(resp.body, modelId, cid, created, signal);
      return {
        response: new Response(openaiStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
        url: COMPLETION_URL,
        headers,
        transformedBody: requestPayload,
      };
    }

    // Non-streaming: collect all content and return OpenAI JSON.
    const rawContent = await collectStreamContent(resp.body, signal);
    const completionTokens = Math.max(1, Math.ceil(rawContent.length / 4));
    return {
      response: new Response(
        JSON.stringify({
          id: cid,
          object: "chat.completion",
          created,
          model: modelId,
          system_fingerprint: null,
          choices: [
            { index: 0, message: { role: "assistant", content: rawContent }, finish_reason: "stop", logprobs: null },
          ],
          usage: { prompt_tokens: completionTokens, completion_tokens: completionTokens, total_tokens: completionTokens * 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      url: COMPLETION_URL,
      headers,
      transformedBody: requestPayload,
    };
  }
}

export default T3ChatWebExecutor;
