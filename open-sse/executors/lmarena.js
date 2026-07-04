import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// LMArenaExecutor — LMArena Web Session Provider
//
// Routes requests through LMArena's web API using session credentials. LMArena is a FREE model
// comparison platform with 40+ frontier models (GPT, Claude, Gemini, Llama, ...).
//
// API Structure:
//   Endpoint: https://arena.ai/nextjs-api/stream
//   Method:   POST, Content-Type: application/json, Accept: text/event-stream
//
// Auth pipeline (per request):
//   1. Extract/reconstruct the `arena-auth-prod-v1` session cookie from credentials.
//      LMArena migrated to @supabase/ssr, which splits the auth cookie across
//      arena-auth-prod-v1.0, .1, … — we recombine them (combineChunks semantics).
//   2. Build request with model + messages, make an authenticated POST.
//   3. Handle the custom SSE response stream with prefixes (a0:, ag:, a3:, ae:, ad:, a2:).
//
// SSE Format (LMArena's custom prefixes):
//   a0: — text content (JSON string)
//   ag: — thinking/reasoning content
//   a2: — heartbeat (ignore)
//   a3: — model error
//   ae: — platform error
//   ad: — done marker
//
// Ported from OmniRoute's lmarena.ts. TS stripped → plain JS, OmniRoute shared helpers inlined,
// errorResponse/sanitizeErrorMessage replaced with inline Responses.

const CFG = PROVIDERS["lmarena"];
// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at CFG.baseUrl (not CFG.transport.baseUrl). See grok-web / chatglm-cn executors
// for the same pattern.
const LMARENA_STREAM_URL = CFG.baseUrl; // https://arena.ai/nextjs-api/stream
const LMARENA_API_BASE = "https://arena.ai";

const LMARENA_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const LMARENA_AUTH_COOKIE = "arena-auth-prod-v1";

// --- Inline error helper (replaces OmniRoute errorResponse + sanitizeErrorMessage) -----------
function errorResponse(status, message, code = "LMARENA_ERROR", type = "upstream_error") {
  return new Response(
    JSON.stringify({ error: { message, type, code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// Avoid leaking raw upstream stack traces into the client; keep the human-readable gist.
function sanitizeErrorMessage(message) {
  if (typeof message !== "string") message = String(message);
  // Trim overly long error bodies and strip obvious paths/tokens.
  let trimmed = message.slice(0, 500);
  trimmed = trimmed.replace(/eyJ[A-Za-z0-9_\-.]+/g, "[REDACTED]");
  return trimmed;
}

// --- Cookie handling ------------------------------------------------------------------------

/**
 * Parse a raw `Cookie:`-style blob (`name=value; name2=value2; …`) into an ordered list of
 * name/value pairs. Whitespace around names is trimmed; values are kept verbatim (they may
 * legitimately contain `=`, e.g. base64 padding).
 */
function parseCookieBlob(blob) {
  const pairs = [];
  for (const part of String(blob).split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const value = part.slice(eq + 1).trim();
    pairs.push({ name, value });
  }
  return pairs;
}

/**
 * Reconstruct LMArena's single `arena-auth-prod-v1` auth cookie from the Supabase SSR chunked form.
 *
 * LMArena migrated to @supabase/ssr, which splits a large auth cookie across
 * `arena-auth-prod-v1.0`, `arena-auth-prod-v1.1`, … (ascending). The single
 * `arena-auth-prod-v1` cookie is then left empty. Following @supabase/ssr's combineChunks, we
 * read chunks in ascending numeric order until one is missing and join("") their raw values — NO
 * base64-decode, NO JSON-parse. The joined value typically starts with the literal `base64-`
 * prefix; we keep it verbatim (the upstream expects it).
 *
 * - If the blob already carries a non-empty `arena-auth-prod-v1=<value>`, it is returned unchanged
 *   (back-compat with the pre-migration single cookie).
 * - Otherwise the reconstructed `arena-auth-prod-v1=<joined>` is injected while every other cookie
 *   in the pasted jar is preserved.
 * - If neither the single cookie nor any `.N` chunk has a value, the blob is returned as-is so the
 *   existing missing-cookie path still fires.
 */
export function reconstructLMArenaCookie(rawCookie) {
  if (!rawCookie || !String(rawCookie).trim()) return rawCookie;

  const pairs = parseCookieBlob(rawCookie);

  // Back-compat: a non-empty single cookie is already usable — forward verbatim.
  const existing = pairs.find((p) => p.name === LMARENA_AUTH_COOKIE);
  if (existing && existing.value) return rawCookie;

  // Collect chunk values keyed by their numeric index (`arena-auth-prod-v1.<N>`).
  const chunkPrefix = `${LMARENA_AUTH_COOKIE}.`;
  const chunks = new Map();
  for (const { name, value } of pairs) {
    if (!name.startsWith(chunkPrefix)) continue;
    const idxRaw = name.slice(chunkPrefix.length);
    if (!/^\d+$/.test(idxRaw)) continue;
    chunks.set(Number(idxRaw), value);
  }

  // Join in ascending order until a chunk is missing (combineChunks semantics).
  const joinedParts = [];
  for (let i = 0; chunks.has(i); i++) {
    joinedParts.push(chunks.get(i) ?? "");
  }
  const joined = joinedParts.join("");

  // No usable session anywhere → return as-is so the missing-cookie path fires.
  if (!joined) return rawCookie;

  // Inject the reconstructed single cookie while preserving the rest of the jar (drop the empty
  // base cookie and the now-redundant chunks).
  const preserved = pairs.filter(
    (p) => p.name !== LMARENA_AUTH_COOKIE && !p.name.startsWith(chunkPrefix)
  );
  const rebuilt = [`${LMARENA_AUTH_COOKIE}=${joined}`, ...preserved.map((p) => `${p.name}=${p.value}`)];
  return rebuilt.join("; ");
}

// Read the cookie from whatever shape the credentials take (cookie / apiKey / nested psd).
function readLMArenaCookie(credentials) {
  if (!credentials || typeof credentials !== "object") return "";
  const direct = typeof credentials.cookie === "string" ? credentials.cookie : "";
  if (direct.trim()) return reconstructLMArenaCookie(direct);
  const apiKey = typeof credentials.apiKey === "string" ? credentials.apiKey : "";
  if (apiKey.trim()) return reconstructLMArenaCookie(apiKey);
  const psd = credentials.providerSpecificData;
  if (psd && typeof psd === "object") {
    const nested = psd.cookie;
    if (typeof nested === "string" && nested.trim()) return reconstructLMArenaCookie(nested);
  }
  return "";
}

// --- SSE parsing -----------------------------------------------------------------------------

// Parse one LMArena prefixed event line into { type, content }.
// type ∈ {"text","thinking","error","done","heartbeat"}.
export function parseArenaSSE(line) {
  if (line.startsWith("a0:")) {
    try {
      const content = JSON.parse(line.substring(3));
      return { type: "text", content: typeof content === "string" ? content : content.text || "" };
    } catch {
      return null;
    }
  } else if (line.startsWith("ag:")) {
    try {
      const content = JSON.parse(line.substring(3));
      return {
        type: "thinking",
        content: typeof content === "string" ? content : content.thinking || "",
      };
    } catch {
      return null;
    }
  } else if (line.startsWith("a3:") || line.startsWith("ae:")) {
    try {
      const content = JSON.parse(line.substring(3));
      return {
        type: "error",
        content: typeof content === "string" ? content : content.error || JSON.stringify(content),
      };
    } catch {
      return { type: "error", content: line.substring(3) };
    }
  } else if (line.startsWith("ad:")) {
    return { type: "done" };
  } else if (line.startsWith("a2:")) {
    return { type: "heartbeat" };
  }
  return null;
}

// Async generator over parsed LMArena SSE events from a response body stream.
// Splits on newlines; lines may optionally start with "data: " (stripped before parseArenaSSE).
async function* readArenaEvents(responseBody, signal) {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        const sseLine = trimmed.startsWith("data: ") ? trimmed.substring(6) : trimmed;
        const event = parseArenaSSE(sseLine);
        if (event) yield event;
      }
    }
    // Flush any trailing line.
    const remaining = buffer.trim();
    if (remaining) {
      const sseLine = remaining.startsWith("data: ") ? remaining.substring(6) : remaining;
      const event = parseArenaSSE(sseLine);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

// --- Response builders -----------------------------------------------------------------------

// Stream: translate LMArena SSE events → OpenAI chat.completion.chunk frames, then [DONE].
function buildStreamingResponse(responseBody, model, cid, created, signal, log) {
  const encoder = new TextEncoder();
  const push = (controller, delta, finishReason = null, extra = {}) =>
    controller.enqueue(
      encoder.encode(
        sseChunk({
          id: cid,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: null,
          choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
          ...extra,
        })
      )
    );

  return new ReadableStream({
    async start(controller) {
      try {
        // Initial role frame.
        push(controller, { role: "assistant" });

        for await (const event of readArenaEvents(responseBody, signal)) {
          if (event.type === "text" && event.content) {
            push(controller, { content: event.content });
          } else if (event.type === "thinking" && event.content) {
            push(controller, { reasoning_content: event.content });
          } else if (event.type === "error") {
            push(controller, { content: `\n[LMArena error: ${sanitizeErrorMessage(event.content)}]` });
            break;
          } else if (event.type === "done") {
            break;
          }
          // heartbeat → ignore
        }

        // Final stop frame + [DONE].
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
      } catch (err) {
        const aborted = err?.name === "AbortError";
        const msg = aborted ? "Stream aborted." : err?.message || String(err);
        log?.error?.("LMARENA", `Streaming error: ${msg}`);
        push(controller, { content: `\n[LMArena stream error: ${sanitizeErrorMessage(msg)}]` });
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
}

// Non-streaming: aggregate the same event stream into one chat.completion JSON.
async function buildNonStreamingResponse(responseBody, model, cid, created, signal, log) {
  let fullContent = "";
  const thinkingParts = [];
  let upstreamError = null;

  for await (const event of readArenaEvents(responseBody, signal)) {
    if (event.type === "text" && event.content) {
      fullContent += event.content;
    } else if (event.type === "thinking" && event.content) {
      thinkingParts.push(event.content);
    } else if (event.type === "error") {
      upstreamError = event.content || "Unknown LMArena error";
      break;
    } else if (event.type === "done") {
      break;
    }
  }

  if (upstreamError) {
    return errorResponse(
      502,
      sanitizeErrorMessage(upstreamError),
      "LMARENA_ERROR",
      "api_error"
    );
  }

  const message = { role: "assistant", content: fullContent || "[LMArena returned no content]" };
  if (thinkingParts.length > 0) message.reasoning_content = thinkingParts.join("\n");

  const promptTokens = Math.ceil(fullContent.length / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);

  return new Response(
    JSON.stringify({
      id: cid,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [{ index: 0, message, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// --- Executor --------------------------------------------------------------------------------

export class LMArenaExecutor extends BaseExecutor {
  constructor() {
    super("lmarena", CFG);
  }

  // Build the LMArena request body from an OpenAI payload.
  // SKIP tool/function-calling — plain text chat only. Flatten multimodal content to text.
  transformRequest(body, model) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const mapped = messages.map((m) => {
      let content = "";
      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content
          .filter((c) => c && (c.type === "text" || typeof c === "string"))
          .map((c) => (typeof c === "string" ? c : String(c.text || "")))
          .join("");
      }
      return { role: String(m.role || "user"), content };
    });
    return {
      messages: mapped,
      model,
      stream: body?.stream || false,
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array.", "INVALID_REQUEST", "invalid_request"),
        url: LMARENA_STREAM_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const cookie = readLMArenaCookie(credentials);
    const transformedBody = this.transformRequest(body, model);

    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": LMARENA_USER_AGENT,
      Origin: LMARENA_API_BASE,
      Referer: `${LMARENA_API_BASE}/`,
    };
    if (cookie) headers.Cookie = cookie;

    if (!cookie) {
      return {
        response: errorResponse(
          401,
          "LMArena requires a session cookie. Log into lmarena.ai, copy the full Cookie header (including arena-auth-prod-v1.0/.1/… chunks), and paste it in the connection.",
          "MISSING_COOKIE",
          "authentication_error"
        ),
        url: LMARENA_STREAM_URL,
        headers,
        transformedBody,
      };
    }

    log?.info?.("LMARENA", `Query to ${model}, msgs=${messages.length}, stream=${!!stream}`);

    let response;
    try {
      response = await proxyAwareFetch(
        LMARENA_STREAM_URL,
        { method: "POST", headers, body: JSON.stringify(transformedBody), signal },
        proxyOptions
      );
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      log?.error?.("LMARENA", `Fetch failed: ${err?.message || String(err)}`);
      return {
        response: errorResponse(
          502,
          `LMArena connection failed: ${sanitizeErrorMessage(err?.message || String(err))}`,
          "REQUEST_FAILED",
          "network_error"
        ),
        url: LMARENA_STREAM_URL,
        headers,
        transformedBody,
      };
    }

    if (!response.ok) {
      const status = response.status;
      let detail = "";
      try { detail = await response.text(); } catch { /* ignore */ }
      let errMsg = `LMArena API error: ${status}`;
      if (status === 401 || status === 403) {
        errMsg = "LMArena auth failed — your session cookie may be expired or invalid. Re-copy the full Cookie header from lmarena.ai.";
      } else if (status === 429) {
        errMsg = "LMArena rate limited. Wait a moment and retry (free tier has tighter limits).";
      } else {
        // Try to surface the upstream message body.
        try {
          const errorJson = JSON.parse(detail);
          errMsg = errorJson.error?.message || errorJson.message || errMsg;
        } catch {
          if (detail) errMsg = detail.slice(0, 500);
        }
      }
      log?.warn?.("LMARENA", errMsg);
      return {
        response: errorResponse(status, sanitizeErrorMessage(errMsg), `HTTP_${status}`, "api_error"),
        url: LMARENA_STREAM_URL,
        headers,
        transformedBody,
      };
    }

    if (!response.body) {
      return {
        response: errorResponse(502, "LMArena returned an empty response body.", "EMPTY_BODY", "upstream_error"),
        url: LMARENA_STREAM_URL,
        headers,
        transformedBody,
      };
    }

    const cid = `chatcmpl-lmarena-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal, log);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, signal, log);
    }
    return { response: finalResponse, url: LMARENA_STREAM_URL, headers, transformedBody };
  }
}

export default LMArenaExecutor;
