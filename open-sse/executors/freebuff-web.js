import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { tlsFetch } from "../utils/tlsClient.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// FreeBuff — free consumer web chat (freebuff.com/chat).
//
// Bridges the NextAuth.js web API to an OpenAI-compatible interface:
//   1. POST /api/chat/stream { threadId, content, images, attachments }
//      → SSE stream of { type, text } events
//   2. Translate SSE events → OpenAI chat.completion.chunk frames:
//      - "delta" → content delta
//      - "reasoning_delta" → reasoning_content delta
//      - "meta" → extract model name (ignored for output)
//      - "suggestions" / "title" → ignored
//      - "done" → finish_reason: stop
//
// Auth: __Secure-next-auth.session-token cookie (NextAuth.js session).
// User pastes bare token value, full session cookie, or complete Cookie header.

const CHAT_URL = "https://freebuff.com/api/chat/stream";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function normalizeCookie(raw) {
  let v = String(raw || "").trim();
  if (v.toLowerCase().startsWith("cookie:")) v = v.slice(7).trim();
  // Bare token (UUID format) — wrap as session cookie
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    return `__Secure-next-auth.session-token=${v}`;
  }
  // Full cookie string — extract session token if present
  if (v.includes("__Secure-next-auth.session-token=")) return v;
  // If it has other cookie format but no session token, wrap it
  if (!v.includes("=")) return `__Secure-next-auth.session-token=${v}`;
  return v;
}

function errorResponse(status, message, code = "FREEBUFF_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

export class FreeBuffWebExecutor extends BaseExecutor {
  constructor() {
    super("freebuff-web", null);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const rawCookie = normalizeCookie(credentials?.apiKey || "");
    if (!rawCookie) {
      return {
        response: errorResponse(401, "FreeBuff: no session cookie provided. Log in at freebuff.com/chat and copy the __Secure-next-auth.session-token cookie."),
        url: CHAT_URL, headers: {}, transformedBody: body,
      };
    }

    // Flatten messages into a single content string (FreeBuff only accepts one
    // text field — no multi-turn, no system prompt, no tool calls).
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

    const modelId = model || "deepseek-v4-flash";
    const freebuffBody = {
      threadId: null,
      content: fullText,
      images: [],
      attachments: [],
    };

    const reqHeaders = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "text/event-stream",
      Cookie: rawCookie,
      Origin: "https://freebuff.com",
      Referer: "https://freebuff.com/chat",
    };

    log?.info?.("FREEBUFF", `model=${modelId} len=${fullText.length}`);

    let upstream;
    try {
      // C3 FIX: Use proxyAwareFetch when proxyOptions is set, fall back to tlsFetch
      // for TLS impersonation (Cloudflare-protected) when no proxy is configured.
      const fetchFn = proxyOptions?.connectionProxyEnabled ? proxyAwareFetch : tlsFetch;
      upstream = await fetchFn(CHAT_URL, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(freebuffBody),
        signal,
      }, proxyOptions);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      return {
        response: errorResponse(502, `FreeBuff fetch failed: ${err?.message || err}`),
        url: CHAT_URL, headers: reqHeaders, transformedBody: freebuffBody,
      };
    }

    // Auto-refresh: NextAuth.js rotates the session JWT on each request via
    // Set-Cookie header. Capture it and pass back via the return value so the
    // caller (chatCore) can update the connection in the DB. This keeps the
    // session alive indefinitely as long as the user uses it regularly.
    let refreshedCookie = null;
    try {
      const setCookie = upstream.headers?.get?.("set-cookie") || "";
      if (setCookie) {
        // Extract the new session token from Set-Cookie
        const match = setCookie.match(/__Secure-next-auth\.session-token=([^;]+)/);
        if (match && match[1] && match[1] !== rawCookie.match(/session-token=([^;]+)/)?.[1]) {
          // Token changed — build the refreshed full cookie string
          // Preserve other cookies, just replace the session token
          refreshedCookie = rawCookie.replace(
            /__Secure-next-auth\.session-token=[^;]+/,
            `__Secure-next-auth.session-token=${match[1]}`,
          );
          log?.debug?.("FREEBUFF", "session token refreshed via Set-Cookie");
        }
      }
    } catch { /* non-fatal */ }

    if (upstream.status === 401 || upstream.status === 403) {
      return {
        response: errorResponse(401, "FreeBuff: session cookie is invalid or expired — re-copy from freebuff.com DevTools."),
        url: CHAT_URL, headers: reqHeaders, transformedBody: freebuffBody,
      };
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return {
        response: errorResponse(upstream.status, `FreeBuff error: ${errText.slice(0, 300)}`),
        url: CHAT_URL, headers: reqHeaders, transformedBody: freebuffBody,
      };
    }

    if (!upstream.body) {
      return {
        response: errorResponse(502, "FreeBuff: empty response body"),
        url: CHAT_URL, headers: reqHeaders, transformedBody: freebuffBody,
      };
    }

    const cid = `chatcmpl-fb-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    // Non-streaming: collect all text, return single JSON
    if (!stream) {
      const { content, reasoning } = await collectText(upstream.body, signal);
      const msg = { role: "assistant", content };
      if (reasoning) msg.reasoning_content = reasoning;
      return {
        response: new Response(
          JSON.stringify({
            id: cid, object: "chat.completion", created, model: modelId,
            choices: [{ index: 0, message: msg, finish_reason: "stop" }],
            usage: { prompt_tokens: Math.ceil(fullText.length / 4), completion_tokens: Math.ceil(content.length / 4), total_tokens: 0 },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
        url: CHAT_URL, headers: reqHeaders, transformedBody: freebuffBody,
        refreshedCookie,
      };
    }

    // Streaming: translate FreeBuff SSE → OpenAI SSE
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        let buffer = "";

        // Initial role delta
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
                if (d.type === "delta" && d.text) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: { content: d.text }, finish_reason: null }],
                  })));
                } else if (d.type === "reasoning_delta" && d.text) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: { reasoning_content: d.text }, finish_reason: null }],
                  })));
                } else if (d.type === "done") {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                  })));
                }
                // "meta", "suggestions", "title" → ignored
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
      url: CHAT_URL, headers: reqHeaders, transformedBody: freebuffBody,
      refreshedCookie,
    };
  }
}

/** Collect content + reasoning text from a FreeBuff SSE stream body. */
async function collectText(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let reasoning = "";
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
          if (d.type === "delta" && d.text) content += d.text;
          else if (d.type === "reasoning_delta" && d.text) reasoning += d.text;
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { content, reasoning };
}

export default FreeBuffWebExecutor;
