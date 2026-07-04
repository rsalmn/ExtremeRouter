import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// VeniceWebExecutor — Privacy-Focused AI Chat via venice.ai (consumer web reverse).
//
// Routes requests through Venice's consumer web `/api/chat` endpoint. Privacy-focused,
// less bot detection than major providers.
//
// Endpoint: POST https://venice.ai/api/chat
// Auth: session cookie from venice.ai (pasted as the credential).
// Plain text chat only — tool/function-calling is intentionally NOT supported.

const BASE_URL = PROVIDERS["venice-web"].baseUrl; // https://venice.ai
const CHAT_URL = `${BASE_URL}/api/chat`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// Strip a leading "Cookie:" prefix if present.
function normalizeCookie(raw) {
  const value = String(raw || "").trim();
  return value.startsWith("Cookie:") ? value.slice(7).trim() : value;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function errorResponse(status, message, code) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code: code || `HTTP_${status}` } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export class VeniceWebExecutor extends BaseExecutor {
  constructor() {
    super("venice-web", PROVIDERS["venice-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};
    const rawCookie = normalizeCookie(credentials?.apiKey ?? "");

    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    const modelId = bodyObj.model || model || "venice-default";

    if (messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array", "INVALID_REQUEST"),
        url: CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Flatten OpenAI messages to plain {role, content} pairs (text only).
    const reqMessages = messages.map((m) => {
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

    const reqBody = {
      messages: reqMessages,
      model: modelId,
      stream: stream !== false,
      max_tokens: Number(bodyObj.max_tokens) || 4096,
    };

    const reqHeaders = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: stream !== false ? "text/event-stream" : "application/json",
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
    };
    if (rawCookie) reqHeaders.Cookie = rawCookie;

    let upstream;
    try {
      upstream = await proxyAwareFetch(
        CHAT_URL,
        { method: "POST", headers: reqHeaders, body: JSON.stringify(reqBody), signal },
        proxyOptions
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("VENICE-WEB", `Fetch failed: ${msg}`);
      if (err?.name === "AbortError") throw err;
      return {
        response: errorResponse(502, `Venice connection failed: ${msg}`, "FETCH_FAILED"),
        url: CHAT_URL,
        headers: reqHeaders,
        transformedBody: reqBody,
      };
    }

    if (!upstream.ok) {
      const status = upstream.status;
      let errMsg = `Venice returned HTTP ${status}`;
      const errText = await upstream.text().catch(() => "");
      if (status === 401 || status === 403) {
        errMsg = "Venice auth failed — your venice.ai session cookie may be missing or expired. Re-paste your Cookie header.";
      } else if (status === 429) {
        errMsg = "Venice rate limited. Wait a moment and retry.";
      } else if (errText) {
        errMsg = `Venice error: ${errText.slice(0, 300)}`;
      }
      log?.warn?.("VENICE-WEB", errMsg);
      return {
        response: errorResponse(status, errMsg, `HTTP_${status}`),
        url: CHAT_URL,
        headers: reqHeaders,
        transformedBody: reqBody,
      };
    }

    const cid = `chatcmpl-venice-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    // Non-streaming: aggregate upstream SSE (Venice always streams from /api/chat) into one JSON.
    if (stream === false) {
      const fullContent = await collectStreamContent(upstream.body, signal);
      const completionTokens = estimateTokens(fullContent);
      return {
        response: new Response(
          JSON.stringify({
            id: cid,
            object: "chat.completion",
            created,
            model: modelId,
            system_fingerprint: null,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: fullContent },
                finish_reason: "stop",
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: completionTokens,
              completion_tokens: completionTokens,
              total_tokens: completionTokens * 2,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
        url: CHAT_URL,
        headers: reqHeaders,
        transformedBody: reqBody,
      };
    }

    if (!upstream.body) {
      return {
        response: errorResponse(502, "Venice returned an empty response body", "EMPTY_BODY"),
        url: CHAT_URL,
        headers: reqHeaders,
        transformedBody: reqBody,
      };
    }

    // Streaming: translate upstream SSE → OpenAI chat.completion.chunk frames.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const sseStream = new ReadableStream({
      async start(controller) {
        // Initial role frame.
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model: modelId,
              system_fingerprint: null,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
            })
          )
        );

        const reader = upstream.body.getReader();
        let buffer = "";
        try {
          while (true) {
            if (signal?.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const text = parsed?.choices?.[0]?.delta?.content || "";
                if (text) {
                  controller.enqueue(
                    encoder.encode(
                      sseChunk({
                        id: cid,
                        object: "chat.completion.chunk",
                        created,
                        model: modelId,
                        system_fingerprint: null,
                        choices: [{ index: 0, delta: { content: text }, finish_reason: null, logprobs: null }],
                      })
                    )
                  );
                }
              } catch {
                // Skip unparseable chunks.
              }
            }
          }
        } catch (err) {
          if (!signal?.aborted && err?.name !== "AbortError") {
            log?.warn?.("VENICE-WEB", `Stream read error: ${err?.message || String(err)}`);
          }
        } finally {
          try {
            reader.releaseLock();
          } catch { /* already released */ }
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid,
                object: "chat.completion.chunk",
                created,
                model: modelId,
                system_fingerprint: null,
                choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
              })
            )
          );
          controller.enqueue(encoder.encode(SSE_DONE));
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return {
      response: new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
      url: CHAT_URL,
      headers: reqHeaders,
      transformedBody: reqBody,
    };
  }
}

// Collect all delta content from a Venice SSE body (used for non-streaming aggregation).
async function collectStreamContent(body, signal) {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
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
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.choices?.[0]?.delta?.content || parsed?.content || "";
          if (text) parts.push(text);
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

export default VeniceWebExecutor;
