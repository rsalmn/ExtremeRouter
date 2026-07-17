import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// PerplexityAgentExecutor — multi-model routing via Perplexity's Agent API.
//
// Translates OpenAI chat.completions requests to/from Perplexity's Responses API:
//   - Converts messages[] → input (string or array format)
//   - Translates streaming: response.output_text.delta → chat.completion.chunk
//   - Translates non-streaming: output[].content[].text → choices[].message.content
//
// Endpoint: POST https://api.perplexity.ai/v1/agent
// Auth: Bearer <pplx-...>

const AGENT_URL = "https://api.perplexity.ai/v1/agent";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function errorResponse(status, message, code = "PERPLEXITY_AGENT_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

export class PerplexityAgentExecutor extends BaseExecutor {
  constructor() {
    super("perplexity-agent", null);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const apiKey = credentials?.apiKey || "";
    if (!apiKey) {
      return {
        response: errorResponse(401, "Perplexity Agent: no API key provided. Get one at perplexity.ai/settings/api."),
        url: AGENT_URL, headers: {}, transformedBody: body,
      };
    }

    // Flatten messages into input format for the Agent API
    const messages = body?.messages || [];
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

    const modelId = model || "openai/gpt-5-mini";

    // Build Responses API request body
    const agentBody = {
      model: modelId,
      input: fullText,
      stream: !!stream,
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": USER_AGENT,
      Accept: stream ? "text/event-stream" : "application/json",
    };

    log?.info?.("PPLX-AGENT", `model=${modelId} len=${fullText.length} stream=${stream}`);

    let upstream;
    try {
      upstream = await proxyAwareFetch(AGENT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(agentBody),
        signal,
      }, proxyOptions);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      return {
        response: errorResponse(502, `Perplexity Agent fetch failed: ${err?.message || err}`),
        url: AGENT_URL, headers, transformedBody: agentBody,
      };
    }

    if (upstream.status === 401 || upstream.status === 403) {
      return {
        response: errorResponse(401, "Perplexity Agent: invalid or expired API key."),
        url: AGENT_URL, headers, transformedBody: agentBody,
      };
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return {
        response: errorResponse(upstream.status, `Perplexity Agent error: ${errText.slice(0, 300)}`),
        url: AGENT_URL, headers, transformedBody: agentBody,
      };
    }

    const cid = `chatcmpl-pplxa-${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);

    // Non-streaming: parse Responses API output
    if (!stream) {
      const data = await upstream.json().catch(() => ({}));
      const content = data?.output?.map?.(o =>
        o?.content?.map?.(c => c?.text || "").join("") || ""
      ).join("") || "";
      const reasoning = data?.output?.map?.(o =>
        o?.content?.filter?.(c => c?.type === "reasoning").map(c => c?.text || "").join("")
      ).join("") || "";
      const usage = data?.usage || {};
      const msg = { role: "assistant", content };
      if (reasoning) msg.reasoning_content = reasoning;
      return {
        response: new Response(
          JSON.stringify({
            id: cid, object: "chat.completion", created, model: modelId,
            choices: [{ index: 0, message: msg, finish_reason: "stop" }],
            usage: {
              prompt_tokens: usage.input_tokens || 0,
              completion_tokens: usage.output_tokens || 0,
              total_tokens: usage.total_tokens || 0,
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
        url: AGENT_URL, headers, transformedBody: agentBody,
      };
    }

    // Streaming: translate Responses API events → OpenAI chat.completion.chunk
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        let buffer = "";
        let emittedFinish = false;

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model: modelId,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        })));

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
              if (!trimmed || trimmed.startsWith("event:")) continue;
              if (!trimmed.startsWith("data:")) continue;
              const raw = trimmed.slice(5).trim();
              if (raw === "[DONE]") continue;

              try {
                const evt = JSON.parse(raw);
                const evtType = evt.type || "";

                if (evtType === "response.output_text.delta" && evt.delta) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: { content: evt.delta }, finish_reason: null }],
                  })));
                } else if (evtType === "response.reasoning.delta" && evt.delta) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: { reasoning_content: evt.delta }, finish_reason: null }],
                  })));
                } else if ((evtType === "response.completed" || evtType === "response.failed") && !emittedFinish) {
                  emittedFinish = true;
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                  })));
                }
              } catch { /* skip unparseable */ }
            }
          }
        } catch (err) {
          if (!signal?.aborted) controller.error(err);
        } finally {
          if (!emittedFinish && !signal?.aborted) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model: modelId,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })));
          }
          try { reader.releaseLock?.(); } catch {}
          controller.enqueue(encoder.encode(SSE_DONE));
          controller.close();
        }
      },
    });

    return {
      response: new Response(responseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
      url: AGENT_URL, headers, transformedBody: agentBody,
    };
  }
}

export default PerplexityAgentExecutor;
