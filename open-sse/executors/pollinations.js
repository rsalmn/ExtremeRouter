import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// PollinationsExecutor — free text generation via the Pollinations OpenAI-compatible gateway.
//
// Pollinations (gen.pollinations.ai/v1) is FREE and works anonymously for keyless models.
// Premium models (claude, gemini, midijourney) require a Pollinations API key. This executor
// is a self-contained port of OmniRoute's open-sse/executors/pollinations.ts, which was a thin
// subclass of an OpenAI-passthrough base. Here the OpenAI passthrough logic is inlined so the
// executor stands alone (ExtremeRouter's BaseExecutor doesn't assume OpenAI-format for us).
//
// Flow:
//   1. POST the OpenAI chat.completions body to gen.pollinations.ai/v1/chat/completions.
//   2. Attach Authorization: Bearer <key> ONLY when the user supplied a key (anonymous by default).
//   3. Translate response_format json_object/json_schema → Pollinations `jsonMode` flag
//      (the upstream treats jsonMode=true as "the model MUST return JSON" and 400s requests
//      whose messages don't mention "json").
//   4. Pass the upstream OpenAI-format SSE stream through, re-encoding it with sseChunk + SSE_DONE
//      so the framing is normalized. Non-streaming aggregates into a single chat.completion JSON.
//   5. On 401 for a known premium model, enhance the error with a keyless-model suggestion.
//
// Plain text chat only — tool/function-calling is intentionally NOT supported.
//
// Auth input: OPTIONAL. Leave blank for anonymous/keyless models; paste a Pollinations API key
// (from https://enter.pollinations.ai) to unlock premium models.

// baseUrl is FLAT at PROVIDERS["pollinations"].baseUrl — buildTransport() in providers/index.js
// flattens `transport` to the top level, so it is NOT at .transport.baseUrl. See grok-web.js.
const POLLINATIONS_CHAT_API = PROVIDERS["pollinations"].baseUrl;

// Models that always require a Pollinations API key (premium tier).
const PREMIUM_MODELS = new Set([
  "claude", "claude-fast", "claude-large",
  "gemini", "gemini-fast",
  "midijourney", "midijourney-large",
]);

// Free keyless models — surfaced in 401 guidance when a premium model is requested without a key.
const FREE_KEYLESS_MODELS = [
  "openai", "openai-fast", "openai-large",
  "qwen-coder", "mistral", "deepseek",
  "grok", "gemini-flash-lite-3.1",
  "perplexity-fast", "perplexity-reasoning",
];

function errorResponse(status, message, code) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code: code || `HTTP_${status}` } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// Build the request body. Ported from OmniRoute transformRequest():
//   - force model + stream
//   - jsonMode translation: only when the caller actually asked for JSON output (#3981)
function transformRequestBody(model, body, stream) {
  if (body && typeof body === "object") {
    body.model = model;
    body.stream = stream;
    const responseFormatType = body.response_format?.type;
    if (responseFormatType === "json_object" || responseFormatType === "json_schema") {
      body.jsonMode = true;
    }
  }
  return body;
}

// Resolve a Bearer token from credentials (apiKey or accessToken). Anonymous when absent.
function resolveBearer(credentials) {
  return credentials?.apiKey || credentials?.accessToken || "";
}

// Read the upstream OpenAI-format SSE stream and re-emit normalized chat.completion.chunk frames.
// Pollinations already speaks OpenAI chat.completion.chunk, so we largely normalize framing and
// guarantee a terminal role→content→stop sequence + [DONE].
function buildStreamingResponse(responseBody, model, cid, created, signal) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedRole = false;
  let sawFinish = false;

  const push = (controller, delta, finishReason = null) =>
    controller.enqueue(
      encoder.encode(
        sseChunk({
          id: cid,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: null,
          choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
        })
      )
    );

  return new Response(
    new ReadableStream({
      async start(controller) {
        const reader = responseBody.getReader();
        const finalize = () => {
          if (!sawFinish) {
            push(controller, {}, "stop");
            sawFinish = true;
          }
          controller.enqueue(encoder.encode(SSE_DONE));
        };
        try {
          while (true) {
            if (signal?.aborted) break;
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let nl;
            while ((nl = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!line) continue;
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") {
                finalize();
                try { controller.close(); } catch { /* */ }
                return;
              }
              let event;
              try {
                event = JSON.parse(payload);
              } catch {
                continue;
              }
              // Surface upstream errors inline.
              if (event.error) {
                push(controller, { content: `\n[Pollinations error: ${event.error.message || JSON.stringify(event.error)}]` });
                finalize();
                try { controller.close(); } catch { /* */ }
                return;
              }
              const choice = event.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta || {};
              const finishReason = choice.finish_reason ?? null;
              if (!emittedRole) {
                push(controller, { role: delta.role || "assistant" });
                emittedRole = true;
              }
              if (delta.content) push(controller, { content: delta.content });
              if (delta.reasoning_content) push(controller, { reasoning_content: delta.reasoning_content });
              if (finishReason) {
                push(controller, {}, finishReason);
                sawFinish = true;
              }
            }
          }
          // Stream ended without an explicit [DONE]; flush a clean terminal sequence.
          if (!emittedRole) push(controller, { role: "assistant" });
          finalize();
        } catch (err) {
          const aborted = err?.name === "AbortError";
          const msg = aborted ? "Stream aborted." : err?.message || String(err);
          push(controller, { content: `\n[Pollinations stream error: ${msg}]` });
          finalize();
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    }),
    { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }
  );
}

// Non-streaming: the upstream returns a single OpenAI chat.completion JSON. Pass it through,
// only re-serializing on parse failure so we always return well-formed OpenAI output.
async function buildNonStreamingResponse(response, model, cid, created) {
  const text = await response.text().catch(() => "");
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* fall through to synthetic payload */
  }
  if (parsed && typeof parsed === "object") {
    // Normalize id/created/model so downstream consumers always see OpenAI fields.
    const message = parsed.choices?.[0]?.message || { role: "assistant", content: text || "" };
    return new Response(
      JSON.stringify({
        ...parsed,
        id: parsed.id || cid,
        created: parsed.created || created,
        model: parsed.model || model,
        choices: parsed.choices || [{ index: 0, message, finish_reason: "stop", logprobs: null }],
        usage: parsed.usage || undefined,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  // Couldn't parse — wrap the raw text as a chat.completion.
  return new Response(
    JSON.stringify({
      id: cid,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop", logprobs: null }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export class PollinationsExecutor extends BaseExecutor {
  constructor() {
    super("pollinations", PROVIDERS["pollinations"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array.", "INVALID_REQUEST"),
        url: POLLINATIONS_CHAT_API,
        headers: {},
        transformedBody: body,
      };
    }

    const transformedBody = transformRequestBody(model, body, stream !== false);
    const token = resolveBearer(credentials);
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (stream !== false) headers["Accept"] = "text/event-stream";

    const anon = !token;
    log?.info?.("POLLINATIONS", `Query to ${model}${anon ? " (anonymous)" : ""}`);

    let response;
    try {
      response = await proxyAwareFetch(
        POLLINATIONS_CHAT_API,
        { method: "POST", headers, body: JSON.stringify(transformedBody), signal },
        proxyOptions
      );
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      log?.error?.("POLLINATIONS", `Fetch failed: ${err.message || String(err)}`);
      return {
        response: errorResponse(502, `Pollinations connection failed: ${err.message || String(err)}`, "FETCH_FAILED"),
        url: POLLINATIONS_CHAT_API,
        headers,
        transformedBody,
      };
    }

    if (!response.ok) {
      const status = response.status;
      let detail = "";
      try { detail = await response.text(); } catch { /* ignore */ }
      let msg =
        status === 401 || status === 403
          ? "Pollinations auth failed. If you're using a premium model (claude, gemini, midijourney), add a Pollinations API key from enter.pollinations.ai."
          : status === 429
            ? "Pollinations rate limited. Wait a moment and retry, or add an API key for a higher quota."
            : `Pollinations returned HTTP ${status}${detail ? `: ${detail.slice(0, 300)}` : ""}`;

      // Premium model requested without a key → actionable guidance (ported from OmniRoute).
      if ((status === 401 || status === 403) && anon && PREMIUM_MODELS.has(model)) {
        msg =
          `Pollinations model "${model}" requires an API key. ` +
          `Free keyless models: ${FREE_KEYLESS_MODELS.join(", ")}. ` +
          `Get a Pollinations API key at https://enter.pollinations.ai and add it to this connection.`;
      }
      log?.warn?.("POLLINATIONS", msg);
      return {
        response: errorResponse(status, msg, `HTTP_${status}`),
        url: POLLINATIONS_CHAT_API,
        headers,
        transformedBody,
      };
    }

    const cid = `chatcmpl-pollinations-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream !== false) {
      if (!response.body) {
        return {
          response: errorResponse(502, "Pollinations returned an empty response body.", "EMPTY_BODY"),
          url: POLLINATIONS_CHAT_API,
          headers,
          transformedBody,
        };
      }
      const sseResponse = buildStreamingResponse(response.body, model, cid, created, signal);
      return { response: sseResponse, url: POLLINATIONS_CHAT_API, headers, transformedBody };
    }

    const finalResponse = await buildNonStreamingResponse(response, model, cid, created);
    return { response: finalResponse, url: POLLINATIONS_CHAT_API, headers, transformedBody };
  }
}

export default PollinationsExecutor;
