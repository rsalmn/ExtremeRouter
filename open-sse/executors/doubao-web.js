// DoubaoWebExecutor — ByteDance AI Chat via doubao.com (web-cookie provider).
//
// Routes requests through Doubao's consumer chat API. Chinese-market provider with a
// large model catalog. This is a thin reverse-adapter: it forwards an OpenAI-shaped
// request to doubao.com's /api/chat with a browser-style cookie + headers, then
// translates the response (streaming SSE or JSON) back into OpenAI chat.completion
// frames.
//
// Auth: session Cookie from doubao.com (pasted into the apiKey credential field).
//
// Ported from OmniRoute's open-sse/executors/doubao-web.ts (TypeScript), adapted to
// ExtremeRouter's ESM executor pattern (see grok-web.js).
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at PROVIDERS["doubao-web"].baseUrl (not .transport.baseUrl).
const CHAT_URL = PROVIDERS["doubao-web"].baseUrl;
const BASE_URL = "https://www.doubao.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// Strip a leading "Cookie:" label if the user pasted the full header.
function normalizeCookie(raw) {
  if (!raw) return "";
  const v = String(raw).trim();
  return v.startsWith("Cookie:") ? v.slice(7).trim() : v;
}

function errorResponse(status, message, code = "DOUBAO_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function errorResult(status, message, url, transformedBody, code) {
  return {
    response: errorResponse(status, message, code),
    url,
    headers: {},
    transformedBody,
  };
}

export class DoubaoWebExecutor extends BaseExecutor {
  constructor() {
    super("doubao-web", PROVIDERS["doubao-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};
    const rawCookie = normalizeCookie(credentials?.apiKey || "");
    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    const modelId = bodyObj.model || model || "doubao-default";

    if (messages.length === 0) {
      return errorResult(400, "Missing or empty messages array.", CHAT_URL, body, "INVALID_REQUEST");
    }
    if (!rawCookie) {
      return errorResult(
        401,
        "Doubao needs your doubao.com cookies. Paste the full Cookie header in the connection.",
        CHAT_URL,
        body,
        "NO_COOKIE"
      );
    }

    const wantStream = stream !== false;

    const reqBody = {
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : extractText(m.content),
      })),
      model: modelId,
      stream: wantStream,
      max_tokens: bodyObj.max_tokens || 4096,
    };

    const reqHeaders = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: wantStream ? "text/event-stream" : "application/json",
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
      Cookie: rawCookie,
    };

    log?.info?.("DOUBAO-WEB", `Query to ${modelId}, len=${JSON.stringify(reqBody).length}, stream=${wantStream}`);

    let upstream;
    try {
      upstream = await proxyAwareFetch(
        CHAT_URL,
        { method: "POST", headers: reqHeaders, body: JSON.stringify(reqBody), signal },
        proxyOptions
      );
    } catch (err) {
      log?.error?.("DOUBAO-WEB", `Fetch failed: ${err?.message || String(err)}`);
      return errorResult(502, `Doubao fetch failed: ${err?.message || String(err)}`, CHAT_URL, reqBody);
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      log?.warn?.("DOUBAO-WEB", `HTTP ${upstream.status}: ${errText.slice(0, 200)}`);
      return errorResult(upstream.status, `Doubao error: ${errText}`, CHAT_URL, reqBody, `HTTP_${upstream.status}`);
    }

    const cid = `chatcmpl-doubao-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const created = Math.floor(Date.now() / 1000);

    if (!wantStream) {
      const data = await upstream.json().catch(() => ({}));
      const content =
        data?.choices?.[0]?.message?.content || data?.content || "";
      return {
        response: new Response(
          JSON.stringify({
            id: cid,
            object: "chat.completion",
            created,
            model: modelId,
            system_fingerprint: null,
            choices: [
              { index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null },
            ],
            usage: {
              prompt_tokens: Math.ceil(JSON.stringify(reqBody.messages).length / 4),
              completion_tokens: Math.ceil(String(content).length / 4),
              total_tokens: Math.ceil((JSON.stringify(reqBody.messages).length + String(content).length) / 4),
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
        url: CHAT_URL,
        headers: reqHeaders,
        transformedBody: reqBody,
      };
    }

    // Streaming: parse the upstream SSE and re-emit OpenAI chat.completion.chunk frames.
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

        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode(SSE_DONE));
          controller.close();
          return;
        }

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
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const text = parsed.choices?.[0]?.delta?.content || "";
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
                /* skip unparseable */
              }
            }
          }
        } catch (err) {
          if (!signal?.aborted) {
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model: modelId,
                  system_fingerprint: null,
                  choices: [
                    {
                      index: 0,
                      delta: { content: `\n[Doubao stream error: ${err?.message || String(err)}]` },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                })
              )
            );
          }
        } finally {
          try { reader.releaseLock?.(); } catch { /* */ }
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
          controller.close();
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

// Flatten OpenAI array content parts (text only) into a plain string.
function extractText(content) {
  if (!Array.isArray(content)) return String(content || "");
  return content
    .filter((c) => c && (c.type === "text" || typeof c === "string"))
    .map((c) => (typeof c === "string" ? c : String(c.text || "")))
    .join("");
}

export default DoubaoWebExecutor;
