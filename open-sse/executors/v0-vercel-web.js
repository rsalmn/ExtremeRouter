// V0VercelWebExecutor — v0.app (Vercel's AI code generation tool) via session cookie.
//
// v0.app uses a custom streaming protocol (line-delimited JSON with nested diff
// patches). This executor:
//   1. POST /chat/api/chat with a structured message body
//   2. Parse the line-delimited diff protocol to extract text + reasoning
//   3. Translate to OpenAI chat.completion.chunk frames
//
// Auth: session Cookie from v0.app (user_session JWE + other cookies).
//
// Protocol analysis (v0.app, July 2026):
//   - Each line is a JSON object with numeric-keyed nested paths (CRDT patches)
//   - Key "2" at leaf level holds text content arrays
//   - Text arrays are positional: last string element = most current text
//   - "thought" keys hold reasoning content (same array format)
//   - "finishReason"/"finishedAt"/"finalizing":[_,false] signal completion
//   - "creditCost" in the final line has cost info
//
// Bug fixes applied per audit (C1-C3, M2-M4, A1):
//   - C1: AbortSignal checked in read loops + reader.releaseLock in finally
//   - C2: Per-path text tracking (not global lastTextLength)
//   - C3: extractTextFromValue picks LAST string (not longest)
//   - M2: Dedupe finish frames + only treat terminal finishReason as done
//   - M3: Emit finish_reason on stream end without done signal
//   - M4: Content-type check for HTML on 200 response
//   - A1: total_tokens = prompt + completion

import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const CHAT_URL = "https://v0.app/chat/api/chat";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

function normalizeCookie(raw) {
  if (!raw) return "";
  const v = String(raw).trim();
  return v.startsWith("Cookie:") ? v.slice(7).trim() : v;
}

function errorResponse(status, message, code = "V0_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

// C3 FIX: Pick the LAST string element (diff format is [old, new]), not longest.
function extractTextFromValue(val) {
  if (typeof val === "string") return val;
  if (!Array.isArray(val)) return "";
  // The last string element is the most current value in the diff.
  // Format: ["old text", "new text"] or ["text", 0, 0] or ["accumulated text"]
  let last = "";
  for (const item of val) {
    if (typeof item === "string") last = item;
  }
  return last;
}

const TERMINAL_FINISH_REASONS = new Set(["stop", "length", "content_filter", "error"]);

// C2 FIX: Per-path text tracking to avoid cross-contamination between sibling blocks.
// Instead of a global lastTextLength, track the last full text string per path.
// When a new text arrives:
//   - If it starts with the previous text → append delta
//   - Otherwise → replacement (emit full new text)
function processPatch(obj, state, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 32) {
    return { textDelta: "", reasoningDelta: "", done: false };
  }

  let textDelta = "";
  let reasoningDelta = "";
  let done = false;

  // M2 FIX: Only treat terminal finishReason as done (not tool-calls mid-stream)
  if (typeof obj.finishReason === "string" && TERMINAL_FINISH_REASONS.has(obj.finishReason)) {
    done = true;
  }
  if (Array.isArray(obj.finalizing) && obj.finalizing[1] === false) {
    done = true;
  }
  if (obj.finishedAt && typeof obj.finishedAt !== "object") {
    done = true;
  }
  // Also handle finishedAt as [null, timestamp] diff format
  if (Array.isArray(obj.finishedAt) && obj.finishedAt[1]) {
    done = true;
  }

  // Reasoning/thought content
  if (obj.thought !== undefined) {
    const thoughtText = extractTextFromValue(obj.thought);
    if (thoughtText) {
      const prev = state.lastThought || "";
      if (thoughtText.startsWith(prev) && thoughtText.length > prev.length) {
        reasoningDelta = thoughtText.slice(prev.length);
      } else if (thoughtText !== prev) {
        // Replacement — emit full new text
        reasoningDelta = thoughtText;
      }
      state.lastThought = thoughtText;
    }
  }

  // Text content — key "2" at leaf level
  if (obj["2"] !== undefined) {
    const text = extractTextFromValue(obj["2"]);
    if (text) {
      const prev = state.lastText || "";
      if (text.startsWith(prev) && text.length > prev.length) {
        textDelta = text.slice(prev.length);
      } else if (text !== prev) {
        // Replacement
        textDelta = text;
      }
      state.lastText = text;
    }
  }

  // Direct string text (simpler format)
  if (typeof obj.text === "string" && obj.text) {
    const prev = state.lastText || "";
    if (obj.text.startsWith(prev) && obj.text.length > prev.length) {
      textDelta = obj.text.slice(prev.length);
    } else if (obj.text !== prev) {
      textDelta = obj.text;
    }
    state.lastText = obj.text;
  }

  // Recurse into nested objects (numeric keys) — L2 FIX: depth limit
  for (const key of Object.keys(obj)) {
    if (/^\d+$/.test(key)) {
      const child = obj[key];
      if (child && typeof child === "object") {
        const result = processPatch(child, state, depth + 1);
        if (result.textDelta) textDelta += result.textDelta;
        if (result.reasoningDelta) reasoningDelta += result.reasoningDelta;
        if (result.done) done = true;
      }
    }
  }

  return { textDelta, reasoningDelta, done };
}

export class V0VercelWebExecutor extends BaseExecutor {
  constructor() {
    super("v0-vercel-web", null);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const rawCookie = normalizeCookie(credentials?.apiKey || "");
    if (!rawCookie) {
      return {
        response: errorResponse(401, "v0 needs your v0.app cookies. Paste the full Cookie header from v0.app DevTools."),
        url: CHAT_URL, headers: {}, transformedBody: body,
      };
    }

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

    // Extract team scope from cookie (v0-last-scope)
    const teamMatch = rawCookie.match(/v0-last-scope=([^;]+)/);
    const team = teamMatch ? decodeURIComponent(teamMatch[1]) : "personal";

    const modelId = model || "v0-mini";
    const messageId = randomUUID().replace(/-/g, "").slice(0, 32);
    const chatId = randomUUID().replace(/-/g, "").slice(0, 12);
    const chatCreationTime = Date.now();

    const v0Body = {
      messageContent: { version: 1, parts: [{ type: "mdx", content: fullText }], type: "parts" },
      messageId,
      chatId,
      isNew: true,
      team,
      modelConfiguration: { modelId, imageGenerations: false, thinking: false },
      suggestedActionsEnabled: false,
      mcpServers: [],
      permissionsMode: "auto",
      chatCreationTime,
    };

    const reqHeaders = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "text/event-stream",
      Cookie: rawCookie,
      Origin: "https://v0.app",
      Referer: `https://v0.app/${team}/chats`,
    };

    log?.info?.("V0-WEB", `model=${modelId} team=${team} len=${fullText.length}`);

    let upstream;
    try {
      upstream = await proxyAwareFetch(CHAT_URL, {
        method: "POST", headers: reqHeaders, body: JSON.stringify(v0Body), signal,
      }, proxyOptions);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      return {
        response: errorResponse(502, `v0 fetch failed: ${err?.message || err}`),
        url: CHAT_URL, headers: reqHeaders, transformedBody: v0Body,
      };
    }

    // Auto-refresh cookies
    let refreshedCookie = null;
    try {
      const setCookie = upstream.headers?.get?.("set-cookie") || "";
      if (setCookie) {
        const match = setCookie.match(/user_session=([^;]+)/);
        if (match && match[1]) {
          const oldSession = rawCookie.match(/user_session=([^;]+)/)?.[1];
          if (match[1] !== oldSession) {
            refreshedCookie = rawCookie.replace(/user_session=[^;]+/, `user_session=${match[1]}`);
            log?.debug?.("V0-WEB", "session cookie refreshed via Set-Cookie");
          }
        }
      }
    } catch { /* non-fatal */ }

    if (upstream.status === 401 || upstream.status === 403) {
      return {
        response: errorResponse(401, "v0: session cookie is invalid or expired — re-copy from v0.app DevTools."),
        url: CHAT_URL, headers: reqHeaders, transformedBody: v0Body,
      };
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      if (errText.includes("<!DOCTYPE html>") || errText.includes("<html")) {
        return {
          response: errorResponse(upstream.status, `v0 endpoint returned HTML (${upstream.status}) — the API may have changed.`),
          url: CHAT_URL, headers: reqHeaders, transformedBody: v0Body,
        };
      }
      return {
        response: errorResponse(upstream.status, `v0 error: ${errText.slice(0, 300)}`),
        url: CHAT_URL, headers: reqHeaders, transformedBody: v0Body,
      };
    }

    // M4 FIX: Check content-type for HTML even on 200 (Cloudflare/Vercel edge pages)
    const contentType = upstream.headers?.get?.("content-type") || "";
    if (contentType.includes("text/html")) {
      return {
        response: errorResponse(502, "v0 returned an HTML page instead of API data — possible WAF challenge or login redirect."),
        url: CHAT_URL, headers: reqHeaders, transformedBody: v0Body,
      };
    }

    if (!upstream.body) {
      return {
        response: errorResponse(502, "v0: empty response body"),
        url: CHAT_URL, headers: reqHeaders, transformedBody: v0Body,
      };
    }

    const cid = `chatcmpl-v0-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    // Non-streaming
    if (!stream) {
      const { content, reasoning } = await collectV0Response(upstream.body, signal);
      const msg = { role: "assistant", content };
      if (reasoning) msg.reasoning_content = reasoning;
      const promptTokens = Math.ceil(fullText.length / 4);
      const completionTokens = Math.ceil(content.length / 4);
      return {
        response: new Response(
          JSON.stringify({
            id: cid, object: "chat.completion", created, model: modelId,
            choices: [{ index: 0, message: msg, finish_reason: "stop" }],
            // A1 FIX: total_tokens = prompt + completion (not 0)
            usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
        url: CHAT_URL, headers: reqHeaders, transformedBody: v0Body,
        refreshedCookie,
      };
    }

    // Streaming: parse v0 diff protocol → OpenAI SSE
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        let buffer = "";
        const state = { lastText: "", lastThought: "" };
        let emittedFinish = false; // M2/M3 FIX: track finish emission

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model: modelId,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        })));

        try {
          while (true) {
            // C1 FIX: Check abort signal before each read
            if (signal?.aborted) break;
            const { done: readerDone, value } = await reader.read();
            if (readerDone) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const patch = JSON.parse(trimmed);
                const result = processPatch(patch, state);

                if (result.reasoningDelta) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: { reasoning_content: result.reasoningDelta }, finish_reason: null }],
                  })));
                }
                if (result.textDelta) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: { content: result.textDelta }, finish_reason: null }],
                  })));
                }
                // M2 FIX: Only emit finish once, and only for terminal reasons
                if (result.done && !emittedFinish) {
                  emittedFinish = true;
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                  })));
                }
              } catch { /* skip unparseable lines */ }
            }
          }
        } catch (err) {
          if (!signal?.aborted) controller.error(err);
        } finally {
          // M3 FIX: If stream ended without done signal, emit finish_reason
          if (!emittedFinish && !signal?.aborted) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model: modelId,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })));
          }
          // C1 FIX: releaseLock in finally
          try { reader.releaseLock?.(); } catch { /* */ }
          controller.enqueue(encoder.encode(SSE_DONE));
          controller.close();
        }
      },
    });

    return {
      response: new Response(responseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
      url: CHAT_URL, headers: reqHeaders, transformedBody: v0Body,
      refreshedCookie,
    };
  }
}

/** Collect full response from v0 diff protocol stream. */
async function collectV0Response(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const state = { lastText: "", lastThought: "" };
  let content = "";
  let reasoning = "";

  try {
    while (true) {
      // C1 FIX: Check abort signal
      if (signal?.aborted) break;
      const { done: readerDone, value } = await reader.read();
      if (readerDone) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const patch = JSON.parse(trimmed);
          const result = processPatch(patch, state);
          if (result.textDelta) content += result.textDelta;
          if (result.reasoningDelta) reasoning += result.reasoningDelta;
        } catch { /* skip */ }
      }
    }
  } finally {
    try { reader.releaseLock?.(); } catch { /* */ }
  }

  return { content, reasoning };
}

export default V0VercelWebExecutor;
