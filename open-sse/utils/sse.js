import { SSE_DONE } from "./sseConstants.js";

export function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// Build OpenAI chat.completion.chunk SSE frame. Key order: id, object, created, model, choices.
export function chatChunkSse({ id, created, model, delta, finishReason = null }) {
  return sseChunk({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

// Client-facing SSE headers (CORS + no buffering) for virtual streams we emit
// from a finalized JSON body (e.g. Cascade internal non-streaming stages that
// must be served to a stream:true client).
const SSE_HEADERS_CLIENT = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

/**
 * Wrap a finalized OpenAI chat.completion JSON (from a buffered/non-streaming
 * stage) as an OpenAI chat.completion.chunk SSE stream. Used when the external
 * client requested stream:true but the orchestration must consume the complete
 * response before deciding (e.g. Cascade confidence parsing) — the internal
 * stage stays non-streaming, the external boundary follows the client contract.
 *
 * Preserves content, reasoning_content, tool_calls, finish_reason, model, id,
 * and usage; emits exactly one [DONE] sentinel (the existing system contract).
 *
 * @param {object} json - normalized OpenAI chat.completion JSON
 * @returns {Response} text/event-stream Response
 */
export function openAICompletionJsonToSSE(json) {
  const encoder = new TextEncoder();
  const choice = json?.choices?.[0];
  const msg = choice?.message || {};
  const id = json?.id || `chatcmpl-${Date.now()}`;
  const created = json?.created || Math.floor(Date.now() / 1000);
  const model = json?.model || "unknown";

  const frames = [];
  frames.push(chatChunkSse({ id, created, model, delta: { role: "assistant" } }));

  const reasoning = msg.reasoning_content;
  if (reasoning) {
    frames.push(chatChunkSse({ id, created, model, delta: { reasoning_content: reasoning } }));
  }
  if (typeof msg.content === "string" && msg.content.length > 0) {
    frames.push(chatChunkSse({ id, created, model, delta: { content: msg.content } }));
  }
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    frames.push(chatChunkSse({ id, created, model, delta: { tool_calls: msg.tool_calls } }));
  }
  frames.push(chatChunkSse({ id, created, model, delta: {}, finishReason: choice?.finish_reason || "stop" }));
  if (json?.usage && typeof json.usage === "object") {
    frames.push(sseChunk({
      id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: {}, finish_reason: null }],
      usage: json.usage,
    }));
  }
  frames.push(SSE_DONE);

  const body = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: SSE_HEADERS_CLIENT });
}

/**
 * Read an SSE stream from a ReadableStream reader, invoking onEvent for each
 * parsed `data:` JSON payload and onDone for `[DONE]`. Handles partial chunks
 * across read boundaries and multi-JSON lines (concatenated `data:` lines).
 *
 * Replaces the 22+ duplicated `for (const line of lines) { if (!line.startsWith("data: ")) ... }`
 * loops scattered across executors. Returns when the stream ends or [DONE] is seen.
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {Object} handlers
 * @param {(data: object) => void} [handlers.onEvent] — called for each parsed JSON event
 * @param {() => void} [handlers.onDone] — called when [DONE] sentinel is encountered
 * @param {AbortSignal} [handlers.signal] — if aborted, stops reading immediately
 */
export async function parseEventStream(reader, { onEvent, onDone, signal } = {}) {
  const decoder = new TextDecoder();
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
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const payload = trimmed.replace(/^data:\s*/, "").trim();
        if (payload === "[DONE]") {
          onDone?.();
          return;
        }
        if (!payload) continue;

        try {
          const data = JSON.parse(payload);
          onEvent?.(data);
        } catch {
          // Non-JSON data line — skip (matches existing executor behavior)
        }
      }
    }

    // Flush any trailing partial line
    if (buffer.trim().startsWith("data:")) {
      const payload = buffer.trim().replace(/^data:\s*/, "").trim();
      if (payload === "[DONE]") {
        onDone?.();
      } else if (payload) {
        try {
          const data = JSON.parse(payload);
          onEvent?.(data);
        } catch { /* skip */ }
      }
    }
  } finally {
    // Release the reader lock so the stream can be cancelled or reused.
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
