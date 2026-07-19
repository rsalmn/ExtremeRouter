// Pure SSE stream parsing utilities — no React, no DOM assumptions beyond fetch.
//
// Extracted from the inline loops that were duplicated in PlaygroundClient.js
// (single + compare modes) and BasicChatPageClient.js. The previous code only
// read `delta.content` and silently dropped reasoning_content / tool_calls /
// usage in compare mode. This parser extracts ALL fields the gateway emits so
// callers never lose data.
//
// Reusable by any dashboard feature that consumes a /v1/chat/completions
// SSE stream (Playground, basic-chat, future consumers).

/**
 * Normalize one parsed SSE chunk into the fields callers care about.
 *
 * @param {object} chunk - parsed JSON from a `data:` line
 * @returns {{ content: string|null, reasoning: string|null, toolCalls: array|null,
 *            finishReason: string|null, usage: object|null }}
 */
export function parseSSEChunk(chunk) {
  const choice = chunk?.choices?.[0];
  const delta = choice?.delta || {};
  return {
    content: typeof delta.content === "string" ? delta.content : null,
    reasoning: typeof delta.reasoning_content === "string" ? delta.reasoning_content : null,
    toolCalls: Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0 ? delta.tool_calls : null,
    finishReason: choice?.finish_reason ?? null,
    // usage appears only in the terminal chunk when stream_options.include_usage
    // is set (the gateway injects it). { prompt_tokens, completion_tokens, total_tokens, ... }
    usage: chunk?.usage ?? null,
  };
}

/**
 * Consume a streaming fetch Response body as SSE.
 *
 * Handles partial-line buffering (chunks can split across reads), the
 * `data: [DONE]` sentinel, and malformed JSON lines (skipped silently).
 *
 * @param {Response} response - a fetch Response with a readable .body
 * @param {object} [opts]
 * @param {(parsed: ReturnType<typeof parseSSEChunk>) => void} [opts.onChunk]
 *        Called for every data event with the normalized chunk.
 * @returns {Promise<object|null>} the final `usage` object if the stream
 *          emitted one (terminal chunk), else null.
 */
export async function consumeSSEStream(response, { onChunk } = {}) {
  if (!response?.body?.getReader) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastUsage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Split on newlines; keep the trailing partial line in the buffer.
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = parseSSEChunk(JSON.parse(payload));
        if (parsed.usage) lastUsage = parsed.usage;
        onChunk?.(parsed);
      } catch {
        // malformed JSON line — skip. Never let one bad chunk abort the stream.
      }
    }
  }

  return lastUsage;
}
