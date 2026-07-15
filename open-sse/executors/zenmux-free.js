import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { tlsFetch } from "../utils/tlsClient.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// ZenMux Free — session-cookie free-tier gateway.
//
// Accesses ZenMux's free-tier LLM gateway via session cookies exported from
// the browser. Uses ZenMux's Anthropic-compatible SSE endpoint, translating
// the response to OpenAI-format chunks.
//
// Endpoint: POST https://zenmux.ai/api/anthropic/v1/messages?ctoken=<token>
// Auth: Full cookie header string from zenmux.ai (must include ctoken).
//
// Reference: github.com/diegosouzapw/OmniRoute (zenmux-free executor, MIT).

const CHAT_URL = PROVIDERS["zenmux-free"]?.baseUrl || "https://zenmux.ai/api/anthropic/v1/messages";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function extractCtoken(cookieStr) {
  const m = cookieStr.match(/ctoken=([^;]+)/);
  return m ? m[1] : "";
}

function normalizeCookie(raw) {
  let v = String(raw || "").trim();
  if (v.startsWith("Cookie:")) v = v.slice(7).trim();
  if (v.startsWith("cookie:")) v = v.slice(7).trim();
  return v;
}

function errorResponse(status, message, code = "ZENMUX_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export class ZenmuxFreeExecutor extends BaseExecutor {
  constructor() {
    super("zenmux-free", PROVIDERS["zenmux-free"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const rawCookie = normalizeCookie(credentials?.apiKey || "");
    const ctoken = extractCtoken(rawCookie);
    if (!ctoken) {
      return {
        response: errorResponse(401, "ZenMux Free: ctoken not found in cookies. Export all cookies from zenmux.ai and paste as the credential."),
        url: CHAT_URL, headers: {}, transformedBody: body,
      };
    }

    const messages = (body?.messages || []);
    const modelId = model || body?.model || "deepseek/deepseek-chat";
    const maxTokens = body?.max_tokens || 4096;

    // Flatten messages into a single user text for ZenMux's Anthropic endpoint.
    const userMessages = messages.filter((m) => m.role === "user");
    const sysMessages = messages.filter((m) => m.role === "system");
    const lastUser = userMessages[userMessages.length - 1];
    const userText = typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.filter((c) => c.type === "text").map((c) => c.text).join("\n")
        : "Hello";
    const sysText = sysMessages.length > 0
      ? (typeof sysMessages[0].content === "string" ? sysMessages[0].content : "")
      : null;
    const fullText = sysText ? `${sysText}\n\n${userText}` : userText;

    const reqId = randomUUID().replace(/-/g, "");
    const anthropicBody = {
      model: modelId,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: [{ type: "text", text: fullText }] }],
      stream: true,
    };
    if (body?.temperature !== undefined) anthropicBody.temperature = body.temperature;

    const url = new URL(CHAT_URL);
    url.searchParams.set("ctoken", ctoken);

    const reqHeaders = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "text/event-stream",
      Origin: "https://zenmux.ai",
      Referer: "https://zenmux.ai/platform/chat",
      "anthropic-version": "2023-06-01",
      "chat-request-id": reqId,
      "x-zenmux-accept-processing": "true, true",
      "x-zenmux-apikey-source": "subscription",
    };
    if (rawCookie) reqHeaders.Cookie = rawCookie;

    log?.info?.("ZENMUX-FREE", `model=${modelId} len=${fullText.length}`);

    let upstream;
    try {
      // C3 FIX: Use proxyAwareFetch when proxyOptions is set, fall back to tlsFetch
      const fetchFn = proxyOptions?.connectionProxyEnabled ? proxyAwareFetch : tlsFetch;
      upstream = await fetchFn(url.toString(), {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(anthropicBody),
        signal,
      }, proxyOptions);
    } catch (err) {
      return {
        response: errorResponse(502, `ZenMux Free fetch failed: ${err?.message || err}`),
        url: CHAT_URL, headers: reqHeaders, transformedBody: anthropicBody,
      };
    }

    if (!upstream.ok) {
      if (upstream.status === 401 || upstream.status === 403) {
        return { response: errorResponse(401, "ZenMux Free: cookies expired or invalid"), url: CHAT_URL, headers: reqHeaders, transformedBody: anthropicBody };
      }
      if (upstream.status === 402) {
        return { response: errorResponse(402, "ZenMux Free: free-tier quota exhausted"), url: CHAT_URL, headers: reqHeaders, transformedBody: anthropicBody };
      }
      const errText = await upstream.text().catch(() => "");
      return { response: errorResponse(upstream.status, `ZenMux Free error: ${errText.slice(0, 300)}`), url: CHAT_URL, headers: reqHeaders, transformedBody: anthropicBody };
    }

    if (!upstream.body) {
      return { response: errorResponse(502, "ZenMux Free: empty response body"), url: CHAT_URL, headers: reqHeaders, transformedBody: anthropicBody };
    }

    const cid = `chatcmpl-zmf-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    if (!stream) {
      const txt = await collectText(upstream.body, signal);
      return {
        response: new Response(
          JSON.stringify({
            id: cid, object: "chat.completion", created, model: modelId,
            choices: [{ index: 0, message: { role: "assistant", content: txt }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: Math.ceil(txt.length / 4), total_tokens: 0 },
          }),
          { headers: { "Content-Type": "application/json" } }
        ),
        url: CHAT_URL, headers: reqHeaders, transformedBody: anthropicBody,
      };
    }

    // Streaming: translate Anthropic SSE → OpenAI SSE
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        let buffer = "";

        // Send role delta first
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model: modelId,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        })));

        try {
          while (true) {
            // C4 FIX: Check abort signal before each read
            if (signal?.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith("data: ")) continue;
              const raw = t.slice(6);
              if (raw === "[DONE]") continue;
              try {
                const d = JSON.parse(raw);
                const delta = d.delta;
                if (d.type === "content_block_delta" && delta) {
                  const text = delta.text || delta.thinking || "";
                  if (text) {
                    controller.enqueue(encoder.encode(sseChunk({
                      id: cid, object: "chat.completion.chunk", created, model: modelId,
                      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
                    })));
                  }
                } else if (d.type === "message_delta" && delta) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: {}, finish_reason: delta.stop_reason || "stop" }],
                  })));
                }
              } catch { /* skip malformed */ }
            }
          }
        } catch (err) {
          if (!signal?.aborted) controller.error(err);
        } finally {
          controller.enqueue(encoder.encode(SSE_DONE));
          controller.close();
        }
      },
    });

    return {
      response: new Response(responseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
      url: CHAT_URL, headers: reqHeaders, transformedBody: anthropicBody,
    };
  }
}

/** Collect text from an Anthropic-format SSE stream body. */
async function collectText(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fullText = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data: ")) continue;
        const raw = t.slice(6);
        if (raw === "[DONE]") continue;
        try {
          const d = JSON.parse(raw);
          if (d.type === "content_block_delta" && d.delta?.text) {
            fullText += d.delta.text;
          }
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
  return fullText;
}

export default ZenmuxFreeExecutor;
