import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// PuterExecutor — OpenAI-compatible proxy for Puter AI.
//
// Puter is FREE AI that exposes 500+ models (GPT, Claude, Gemini, Grok, DeepSeek,
// Qwen, Mistral, Llama...) through a single OpenAI-compatible REST endpoint. This
// executor forwards the incoming OpenAI chat.completions body to Puter verbatim
// (model IDs pass through unchanged) and relays the response back — streaming SSE
// frames are forwarded as OpenAI chat.completion.chunk frames; non-streaming JSON
// is returned as a chat.completion object.
//
// Endpoint: https://api.puter.com/puterai/openai/v1/chat/completions
// Auth:     Bearer <puter_auth_token>  (from puter.com/dashboard → Copy Auth Token)
// Docs:     https://docs.puter.com/AI/
//
// Only chat completions (with streaming SSE) are available via REST. Image
// generation, TTS, STT, and video are puter.js SDK-only features and are skipped.
// Tool/function-calling is intentionally skipped — plain text chat only.
//
// Auth input: the bare auth token OR a full cookie string containing
// `puter_auth_token`. The cookie-parsing helper below extracts either.

const CFG = PROVIDERS["puter"];
// buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at CFG.baseUrl (not CFG.transport.baseUrl). See grok-web / chatglm-cn
// executors for the same pattern.
const PUTER_CHAT_API = CFG.baseUrl;

// Pull the auth token out of whatever the user pasted.
// Accepts: bare token, full cookie string ("puter_auth_token=...; other=..."),
// or any leading "Bearer " prefix.
export function parsePuterCookie(raw) {
  if (!raw) return "";
  let value = String(raw).trim();
  // Strip a "Bearer " prefix if pasted by mistake.
  if (value.toLowerCase().startsWith("bearer ")) value = value.slice(7).trim();
  // Bare token (no "=" / ";") → use directly.
  if (!value.includes("=") && !value.includes(";")) return value;
  // Otherwise scan cookie pairs for the auth token key.
  const match = value.match(/puter_auth_token=([^;]+)/);
  if (match) return match[1].trim();
  // Fallback: the first cookie value if no known key is present.
  const first = value.match(/[^=;]+=[^;]+/);
  if (first) {
    const eqIdx = first[0].indexOf("=");
    return first[0].slice(eqIdx + 1).trim();
  }
  return value;
}

function errorResponse(status, message, code = "PUTER_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// Read Puter's OpenAI-style SSE stream and re-emit it as OpenAI chat.completion.chunk
// frames. Puter already emits OpenAI-format chunks, so we parse and forward them,
// filling in any missing fields and guaranteeing a terminal stop frame + [DONE].
function buildStreamingResponse(responseBody, model, cid, created, signal) {
  const encoder = new TextEncoder();
  let emittedRole = false;

  const push = (controller, deltaObj, finishReason = null) =>
    controller.enqueue(
      encoder.encode(
        sseChunk({
          id: cid,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: null,
          choices: [{ index: 0, delta: deltaObj, finish_reason: finishReason, logprobs: null }],
        })
      )
    );

  return new ReadableStream({
    async start(controller) {
      const reader = responseBody.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          if (signal?.aborted) break;
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line || !line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") {
              buffer = ""; // terminal marker seen
              break;
            }
            let chunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue; // skip unparseable
            }
            // Forward upstream errors as an inline content note.
            if (chunk.error) {
              const msg = chunk.error.message || "Puter stream error";
              push(controller, { content: `\n[Puter error: ${msg}]` });
              buffer = "";
              break;
            }
            const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
            const delta = choice?.delta || {};
            if (!emittedRole && !delta.role && !delta.content && !delta.reasoning_content) {
              push(controller, { role: "assistant" });
              emittedRole = true;
            } else if (!emittedRole && delta.role) {
              emittedRole = true;
            }
            // Re-frame through sseChunk to guarantee consistent shape.
            push(controller, delta, choice?.finish_reason ?? null);
          }
          if (buffer === "") break;
        }
        // Drain any trailing bytes (no newline terminator).
        buffer += decoder.decode();
        const tail = buffer.trim();
        if (tail.startsWith("data:")) {
          const payload = tail.slice(5).trim();
          if (payload && payload !== "[DONE]") {
            try {
              const chunk = JSON.parse(payload);
              if (!chunk.error) {
                const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
                push(controller, choice?.delta || {}, choice?.finish_reason ?? null);
              }
            } catch {
              /* skip */
            }
          }
        }
        // Always emit a terminal stop frame + [DONE] for a clean client shutdown.
        push(controller, {}, "stop");
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        const aborted = err?.name === "AbortError";
        const msg = aborted ? "Stream aborted." : err?.message || String(err);
        push(controller, { content: `\n[Puter error: ${msg}]` });
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
}

export class PuterExecutor extends BaseExecutor {
  constructor() {
    super("puter", CFG);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array.", "INVALID_REQUEST"),
        url: PUTER_CHAT_API,
        headers: {},
        transformedBody: body,
      };
    }

    // Resolve the auth token from whatever the user pasted (bare token or cookies).
    const raw = credentials?.apiKey || credentials?.accessToken || "";
    const token = parsePuterCookie(raw);
    if (!token) {
      return {
        response: errorResponse(
          401,
          "Puter needs your auth token. Open puter.com/dashboard → Copy Auth Token (or your puter_auth_token cookie) and paste it in the connection.",
          "NO_TOKEN"
        ),
        url: PUTER_CHAT_API,
        headers: {},
        transformedBody: body,
      };
    }

    // Puter accepts model IDs directly from its catalog — pass the body through,
    // forcing plain-text chat (drop any tool/function-calling fields).
    const transformedBody = {
      ...body,
      model,
      stream: !!stream,
      tools: undefined,
      functions: undefined,
      tool_choice: undefined,
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (stream) headers["Accept"] = "text/event-stream";

    log?.info?.("PUTER", `Query to ${model}, len=${JSON.stringify(transformedBody).length}`);

    let response;
    try {
      response = await proxyAwareFetch(
        PUTER_CHAT_API,
        { method: "POST", headers, body: JSON.stringify(transformedBody), signal },
        proxyOptions
      );
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      log?.error?.("PUTER", `Fetch failed: ${err?.message || String(err)}`);
      return {
        response: errorResponse(502, `Puter connection failed: ${err?.message || String(err)}`, "CONNECT_FAILED"),
        url: PUTER_CHAT_API,
        headers,
        transformedBody,
      };
    }

    if (!response.ok) {
      const status = response.status;
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        /* ignore */
      }
      let errMsg = `Puter returned HTTP ${status}`;
      if (status === 401 || status === 403) {
        errMsg = "Puter auth failed — your auth token may be expired or invalid. Re-copy it from puter.com/dashboard.";
      } else if (status === 429) {
        errMsg = "Puter rate limited. Wait a moment and retry.";
      }
      log?.warn?.("PUTER", errMsg);
      const errResp = new Response(
        JSON.stringify({
          error: {
            message: detail ? `${errMsg}: ${detail.slice(0, 300)}` : errMsg,
            type: "upstream_error",
            code: `HTTP_${status}`,
          },
        }),
        { status, headers: { "Content-Type": "application/json" } }
      );
      return { response: errResp, url: PUTER_CHAT_API, headers, transformedBody };
    }

    // Streaming: relay Puter's SSE as OpenAI chat.completion.chunk frames.
    if (stream) {
      if (!response.body) {
        return {
          response: errorResponse(502, "Puter returned empty response body.", "EMPTY_BODY"),
          url: PUTER_CHAT_API,
          headers,
          transformedBody,
        };
      }
      const cid = `chatcmpl-puter-${crypto.randomUUID().slice(0, 12)}`;
      const created = Math.floor(Date.now() / 1000);
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      return {
        response: new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
        url: PUTER_CHAT_API,
        headers,
        transformedBody,
      };
    }

    // Non-streaming: Puter already returns an OpenAI chat.completion object —
    // relay it as-is (with a normalized id/created if upstream omits them).
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      // Not valid JSON — surface the raw text as an assistant message.
      payload = {
        id: `chatcmpl-puter-${crypto.randomUUID().slice(0, 12)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        system_fingerprint: null,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text || "[Puter returned no content]" },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    }
    return {
      response: new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      url: PUTER_CHAT_API,
      headers,
      transformedBody,
    };
  }
}

export default PuterExecutor;
