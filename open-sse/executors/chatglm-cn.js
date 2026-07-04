import { createHash, randomBytes } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// ChatGLM.cn (智谱清言) web-chat reverse adapter.
//
// chatglm.cn is a consumer web app — NOT an OpenAI-compatible API. This executor bridges it:
//   1. Refresh: chatglm_refresh_token (cookie, ~6mo life) → access_token (~1h) via
//      POST /user-api/user/refresh. The access token is cached in-process and auto-renewed.
//   2. Chat: POST /backend-api/assistant/stream (SSE) with browser-style headers + an
//      X-Sign signature (MD5 of `{timestamp}-{nonce}-{SECRET}`).
//   3. Translate: the GLM event stream (parts[] with logic_id + content[]) into OpenAI
//      chat.completion.chunk frames.
//   4. Cleanup: POST /backend-api/assistant/conversation/delete to discard the conversation.
//
// Credential input (apiKey field): either the FULL cookie string (we extract
// chatglm_refresh_token) or just the refresh-token JWT value.
//
// Reverse-engineering reference: github.com/XxxXTeam/glm2api (MIT-licensed).

const CFG = PROVIDERS["chatglm-cn"];
// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at CFG.baseUrl (not CFG.transport.baseUrl). See grok-web executor for the same
// pattern.
const BASE = CFG.baseUrl; // https://chatglm.cn/chatglm
const REFRESH_URL = `${BASE}/user-api/user/refresh`;
const CHAT_STREAM_URL = `${BASE}/backend-api/assistant/stream`;
const DELETE_URL = `${BASE}/backend-api/assistant/conversation/delete`;

// Signing — reverse-engineered from the web client. Same for all requests.
const SIGN_SECRET = "8a1317a7468aa3ad86e997d08f3f31cb";
const DEFAULT_ASSISTANT_ID = "65940acff94777010aa6b796";
const ACCESS_TOKEN_TTL = 3600; // seconds (1h)

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

// In-process access-token cache keyed by refresh token. Survives hot-reload via global.
const TOKEN_CACHE = (global._chatglmTokenCache ??= new Map()); // refreshToken → { accessToken, expiresAt }

function md5Hex(input) {
  // MD5 isn't part of Web Crypto (subtle), so use node:crypto. The executor runs server-side
  // only, and Bun also implements node:crypto.
  return createHash("md5").update(input, "utf8").digest("hex");
}

// Build the (timestamp, nonce, sign) triplet the web backend expects.
// Algorithm lifted from glm2api build_sign(): inject a checksum digit so the timestamp
// passes server-side validation.
function buildSign() {
  const now = String(Date.now());
  const digits = [...now].map(Number);
  const checksum = (digits.reduce((a, b) => a + b, 0) - digits[digits.length - 2]) % 10;
  const timestamp = now.slice(0, -2) + String(checksum) + now.slice(-1);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const sign = md5Hex(`${timestamp}-${nonce}-${SIGN_SECRET}`);
  return { timestamp, nonce, sign };
}

function randomHex(len) {
  return randomBytes(len).toString("hex");
}

// Browser-like header set the web backend expects. Combined with per-request sign + auth.
function browserHeaders(acceptSse = true) {
  return {
    Accept: acceptSse ? "text/event-stream" : "application/json, text/plain, */*",
    "Accept-Encoding": acceptSse ? "identity" : "gzip, deflate",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "App-Name": "chatglm",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    Origin: "https://chatglm.cn",
    Pragma: "no-cache",
    "Sec-Ch-Ua": '"Microsoft Edge";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": USER_AGENT,
    "X-App-Fr": acceptSse ? "browser_extension" : "default",
    "X-App-Platform": "pc",
    "X-App-Version": "0.0.1",
    "X-Device-Brand": "",
    "X-Device-Model": "",
    "X-Lang": "zh",
  };
}

function signedHeaders(accessToken) {
  const { timestamp, nonce, sign } = buildSign();
  return {
    ...browserHeaders(true),
    Authorization: `Bearer ${accessToken}`,
    "X-Device-Id": randomHex(16),
    "X-Nonce": nonce,
    "X-Request-Id": randomHex(16),
    "X-Sign": sign,
    "X-Timestamp": timestamp,
  };
}

// Pull chatglm_refresh_token out of a full cookie string, or accept a bare token.
export function parseChatGLMCookie(raw) {
  if (!raw) return "";
  const value = String(raw).trim();
  // Bare JWT (no "=" / ";") → use directly.
  if (!value.includes("=") && !value.includes(";")) return value;
  // Otherwise scan cookie pairs for the refresh token key.
  const match = value.match(/chatglm_refresh_token=([^;]+)/);
  if (match) return match[1].trim();
  // Fallback: chatglm_token if refresh not present (short-lived but better than nothing).
  const accessMatch = value.match(/chatglm_token=([^;]+)/);
  return accessMatch ? accessMatch[1].trim() : "";
}

// Refresh the stored refresh token → a short-lived access token. Cached for ~1h.
// Throws on auth failure (caller surfaces 401).
async function getAccessToken(refreshToken, proxyOptions, signal) {
  const cached = TOKEN_CACHE.get(refreshToken);
  if (cached && cached.expiresAt - 60 > Math.floor(Date.now() / 1000)) {
    return cached.accessToken;
  }

  const { timestamp, nonce, sign } = buildSign();
  const res = await proxyAwareFetch(
    REFRESH_URL,
    {
      method: "POST",
      headers: {
        ...browserHeaders(false),
        Authorization: `Bearer ${refreshToken}`,
        "X-Device-Id": randomHex(16),
        "X-Nonce": nonce,
        "X-Request-Id": randomHex(16),
        "X-Sign": sign,
        "X-Timestamp": timestamp,
      },
      body: "{}",
      signal,
    },
    proxyOptions
  );

  if (!res.ok) {
    throw Object.assign(new Error(`ChatGLM token refresh failed (HTTP ${res.status})`), {
      status: res.status,
      code: res.status === 401 || res.status === 403 ? "AUTH_FAILED" : "REFRESH_FAILED",
    });
  }

  const payload = await res.json().catch(() => ({}));
  const result = payload?.result || {};
  const accessToken = result.access_token;
  if (!accessToken) {
    throw Object.assign(new Error("ChatGLM refresh response missing access_token"), { code: "BAD_RESPONSE" });
  }
  TOKEN_CACHE.set(refreshToken, {
    accessToken,
    expiresAt: Math.floor(Date.now() / 1000) + (ACCESS_TOKEN_TTL - 25),
  });
  return accessToken;
}

// Flatten OpenAI messages into the single-prompt transcript GLM expects.
// GLM takes ONE user message containing the whole conversation; we label turns so the
// model keeps role context. (Mirrors glm2api convert_messages, minus the tool layer.)
function buildTranscript(messages) {
  if (!Array.isArray(messages)) return "";
  const parts = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c) => c && (c.type === "text" || typeof c === "string"))
        .map((c) => (typeof c === "string" ? c : String(c.text || "")))
        .join("\n");
    }
    content = String(content || "").trim();
    if (!content) continue;
    const title =
      role === "system" ? "System"
        : role === "assistant" ? "Assistant"
        : role === "developer" ? "Developer"
        : "User";
    parts.push(`${title}: ${content}`);
  }
  return parts.join("\n\n").trim();
}

// Decide chat_mode from the requested model id / thinking flags.
// Mirrors glm2api resolve_chat_mode: deep-research / zero(thinking) / ""(default).
function resolveChatMode(model, body) {
  const lower = String(model || "").toLowerCase();
  if (lower.includes("deep-research") || body?.deep_research) return "deep_research";
  const thinking = body?.reasoning_effort != null
    || lower.includes("think") || lower.includes("zero")
    || lower.includes("-4.5") || lower.includes("-5.2") || lower.includes("-4.7");
  return thinking ? "zero" : "";
}

// Build the GLM chat request body from an OpenAI payload.
function buildChatBody(model, body) {
  const transcript = buildTranscript(body?.messages || []);
  const chatMode = resolveChatMode(model, body);
  return {
    assistant_id: DEFAULT_ASSISTANT_ID,
    conversation_id: "",
    project_id: "",
    chat_type: "user_chat",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `${transcript}\n\nAssistant: ` }],
      },
    ],
    meta_data: {
      channel: "",
      chat_mode: chatMode,
      draft_id: "",
      if_plus_model: true,
      input_question_type: "xxxx",
      is_networking: false,
      is_test: false,
      platform: "pc",
      quote_log_id: "",
      cogview: { rm_label_watermark: false },
    },
  };
}

function errorResponse(status, message, code = "CHATGLM_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// Parse the GLM SSE byte stream into discrete JSON event objects.
// GLM emits `data: {...}\n\n` frames (and a terminal `data: [DONE]`).
async function* readGlmEvents(responseBody, signal) {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!block) continue;
        // A block may contain several "data:" lines; join them.
        const dataLines = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (!dataLines.length) continue;
        const payload = dataLines.join("\n");
        if (payload === "[DONE]") return;
        try {
          yield JSON.parse(payload);
        } catch {
          /* skip unparseable */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Render the latest state of a GLM event's parts into concatenated text + reasoning.
// Returns { text, reasoning }. Tracks per-logic_id deltas so callers stream only diffs.
function renderParts(partsByLogicId, orderedLogicIds) {
  const textParts = [];
  const reasoningParts = [];
  for (const logicId of orderedLogicIds) {
    const part = partsByLogicId[logicId];
    if (!part || !Array.isArray(part.content)) continue;
    const t = [];
    const r = [];
    for (const item of part.content) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "text") t.push(String(item.text || ""));
      else if (item.type === "think") r.push(String(item.think || ""));
      else if (item.type === "code") t.push("```python\n" + String(item.code || "") + "\n```");
      else if (item.type === "execution_output") t.push(String(item.content || ""));
      else if (item.type === "image" && Array.isArray(item.image)) {
        for (const img of item.image) if (img?.image_url) t.push(`![image](${img.image_url})`);
      }
    }
    const rendered = t.filter(Boolean).join("\n").trim();
    const reasoning = r.filter(Boolean).join("\n").trim();
    if (rendered) textParts.push(rendered);
    if (reasoning) reasoningParts.push(reasoning);
  }
  return { text: textParts.join("\n\n"), reasoning: reasoningParts.join("\n\n") };
}

// Delete the conversation server-side so it doesn't pile up in the user's history.
// Best-effort: failures here are logged, never fatal.
async function deleteConversation(accessToken, conversationId, proxyOptions, signal, log) {
  if (!conversationId) return;
  try {
    const { timestamp, nonce, sign } = buildSign();
    await proxyAwareFetch(
      DELETE_URL,
      {
        method: "POST",
        headers: {
          ...browserHeaders(false),
          Authorization: `Bearer ${accessToken}`,
          Referer: "https://chatglm.cn/main/alltoolsdetail",
          "X-Device-Id": randomHex(16),
          "X-Nonce": nonce,
          "X-Request-Id": randomHex(16),
          "X-Sign": sign,
          "X-Timestamp": timestamp,
        },
        body: JSON.stringify({ assistant_id: DEFAULT_ASSISTANT_ID, conversation_id: conversationId }),
        signal,
      },
      proxyOptions
    );
  } catch (err) {
    log?.warn?.("CHATGLM", `conversation delete failed (non-fatal): ${err?.message || String(err)}`);
  }
}

// Stream: open the GLM chat SSE, translate events → OpenAI chunks, then delete conversation.
function buildStreamingResponse({ accessToken, requestBody, model, cid, created, proxyOptions, signal, log }) {
  const encoder = new TextEncoder();
  // State for incremental rendering.
  const partsByLogicId = {};
  const orderedLogicIds = [];
  let lastTextLen = 0;
  let lastReasoningLen = 0;
  let conversationId = "";
  let emittedRole = false;
  let busyRetriesLeft = 3;

  const push = (controller, deltaObj) =>
    controller.enqueue(
      encoder.encode(
        sseChunk({
          id: cid,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: null,
          choices: [{ index: 0, delta: deltaObj, finish_reason: null, logprobs: null }],
        })
      )
    );

  return new ReadableStream({
    async start(controller) {
      try {
        // Initial role frame.
        push(controller, { role: "assistant" });
        emittedRole = true;

        let response;
        const attempt = async () => {
          const res = await proxyAwareFetch(
            CHAT_STREAM_URL,
            { method: "POST", headers: signedHeaders(accessToken), body: JSON.stringify(requestBody), signal },
            proxyOptions
          );
          return res;
        };

        response = await attempt();

        // 429 "busy" (GLM processing another conversation) is retryable.
        while (response.status === 429 && busyRetriesLeft > 0) {
          busyRetriesLeft--;
          log?.info?.("CHATGLM", "upstream busy (429), retrying in 2s");
          await new Promise((r) => setTimeout(r, 2000));
          if (signal?.aborted) break;
          response = await attempt();
        }

        if (!response.ok) {
          let detail = "";
          try { detail = await response.text(); } catch { /* ignore */ }
          const msg =
            response.status === 401 || response.status === 403
              ? "ChatGLM auth failed — your refresh token may be expired or invalid."
              : `ChatGLM request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`;
          push(controller, { content: `\n[ChatGLM error: ${msg}]` });
          controller.enqueue(encoder.encode(SSE_DONE));
          try { controller.close(); } catch { /* */ }
          return;
        }
        if (!response.body) {
          push(controller, { content: "\n[ChatGLM error: empty response body]" });
          controller.enqueue(encoder.encode(SSE_DONE));
          try { controller.close(); } catch { /**/ }
          return;
        }

        let terminalStatus = null;
        for await (const event of readGlmEvents(response.body, signal)) {
          if (!conversationId && event.conversation_id) conversationId = String(event.conversation_id);

          // Collect parts (deduped by logic_id, insertion-sorted).
          if (Array.isArray(event.parts)) {
            for (const part of event.parts) {
              if (part && typeof part === "object" && part.logic_id) {
                const lid = String(part.logic_id);
                if (!(lid in partsByLogicId)) {
                  partsByLogicId[lid] = part;
                  // Insert maintaining sorted order (logic_ids sort lexically).
                  let i = 0;
                  while (i < orderedLogicIds.length && orderedLogicIds[i] < lid) i++;
                  orderedLogicIds.splice(i, 0, lid);
                } else {
                  partsByLogicId[lid] = part;
                }
              }
            }
          }

          // Surface upstream errors mid-stream.
          if (String(event.status || "").toLowerCase() === "error") {
            const errMsg = event.last_error?.message || event.message || "ChatGLM stream error";
            push(controller, { content: `\n[ChatGLM error: ${errMsg}]` });
            break;
          }

          // Compute deltas and emit.
          const { text, reasoning } = renderParts(partsByLogicId, orderedLogicIds);
          if (reasoning.length > lastReasoningLen) {
            push(controller, { reasoning_content: reasoning.slice(lastReasoningLen) });
            lastReasoningLen = reasoning.length;
          }
          if (text.length > lastTextLen) {
            push(controller, { content: text.slice(lastTextLen) });
            lastTextLen = text.length;
          }

          if (event.status === "finish" || event.status === "intervene") {
            terminalStatus = event.status;
            // One final render to flush any straggler content.
            const finalRender = renderParts(partsByLogicId, orderedLogicIds);
            if (finalRender.text.length > lastTextLen) {
              push(controller, { content: finalRender.text.slice(lastTextLen) });
            }
            if (event.status === "intervene" && event.last_error?.intervene_text) {
              push(controller, { content: `\n\n${event.last_error.intervene_text}` });
            }
            break;
          }
        }

        // Final stop frame + [DONE].
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        const aborted = err?.name === "AbortError";
        const msg = aborted ? "Stream aborted." : err?.message || String(err);
        push(controller, { content: `\n[ChatGLM error: ${msg}]` });
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        try { controller.close(); } catch { /* already closed */ }
        if (conversationId) {
          await deleteConversation(accessToken, conversationId, proxyOptions, signal, log);
        }
      }
    },
  });
}

// Non-streaming: aggregate the same event stream into one chat.completion JSON.
async function buildNonStreamingResponse({ accessToken, requestBody, model, cid, created, proxyOptions, signal, log }) {
  let response;
  let busyRetriesLeft = 3;
  const attempt = () =>
    proxyAwareFetch(
      CHAT_STREAM_URL,
      { method: "POST", headers: signedHeaders(accessToken), body: JSON.stringify(requestBody), signal },
      proxyOptions
    );
  response = await attempt();
  while (response.status === 429 && busyRetriesLeft > 0) {
    busyRetriesLeft--;
    await new Promise((r) => setTimeout(r, 2000));
    if (signal?.aborted) break;
    response = await attempt();
  }
  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch { /* ignore */ }
    return errorResponse(
      response.status,
      response.status === 401 || response.status === 403
        ? "ChatGLM auth failed — your refresh token may be expired or invalid."
        : `ChatGLM request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      `HTTP_${response.status}`
    );
  }

  const partsByLogicId = {};
  const orderedLogicIds = [];
  let conversationId = "";
  let fullText = "";
  let fullReasoning = "";

  try {
    for await (const event of readGlmEvents(response.body, signal)) {
      if (!conversationId && event.conversation_id) conversationId = String(event.conversation_id);
      if (Array.isArray(event.parts)) {
        for (const part of event.parts) {
          if (part && typeof part === "object" && part.logic_id) {
            const lid = String(part.logic_id);
            if (!(lid in partsByLogicId)) {
              partsByLogicId[lid] = part;
              let i = 0;
              while (i < orderedLogicIds.length && orderedLogicIds[i] < lid) i++;
              orderedLogicIds.splice(i, 0, lid);
            } else {
              partsByLogicId[lid] = part;
            }
          }
        }
      }
      if (event.status === "finish" || event.status === "intervene") {
        const rendered = renderParts(partsByLogicId, orderedLogicIds);
        fullText = rendered.text;
        fullReasoning = rendered.reasoning;
        break;
      }
    }
  } finally {
    if (conversationId) await deleteConversation(accessToken, conversationId, proxyOptions, signal, log);
  }

  const message = { role: "assistant", content: fullText || "[ChatGLM returned no content]" };
  if (fullReasoning) message.reasoning_content = fullReasoning;
  const promptTokens = Math.ceil((requestBody?.messages?.[0]?.content?.[0]?.text?.length || 0) / 4);
  const completionTokens = Math.ceil(fullText.length / 4);
  return new Response(
    JSON.stringify({
      id: cid,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [{ index: 0, message, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export class ChatGLMExecutor extends BaseExecutor {
  constructor() {
    super("chatglm-cn", CFG);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { response: errorResponse(400, "Missing or empty messages array.", "INVALID_REQUEST"), url: CHAT_STREAM_URL, headers: {}, transformedBody: body };
    }

    // Resolve the refresh token from whatever the user pasted (full cookies or bare token).
    const raw = credentials?.apiKey || credentials?.accessToken || "";
    const refreshToken = parseChatGLMCookie(raw);
    if (!refreshToken) {
      return {
        response: errorResponse(401, "ChatGLM needs your chatglm.cn cookies (or chatglm_refresh_token). Paste them in the connection.", "NO_COOKIE"),
        url: CHAT_STREAM_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Obtain a short-lived access token (cached). 401 here surfaces immediately.
    let accessToken;
    try {
      accessToken = await getAccessToken(refreshToken, proxyOptions, signal);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      // Invalidate the cached token so the next attempt re-refreshes.
      TOKEN_CACHE.delete(refreshToken);
      return {
        response: errorResponse(err?.status || 502, err?.message || "ChatGLM token refresh failed", err?.code || "REFRESH_FAILED"),
        url: REFRESH_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const cid = `chatcmpl-chatglm-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const requestBody = buildChatBody(model, body);

    if (stream) {
      const sseStream = buildStreamingResponse({ accessToken, requestBody, model, cid, created, proxyOptions, signal, log });
      return {
        response: new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
        url: CHAT_STREAM_URL,
        headers: signedHeaders(accessToken),
        transformedBody: requestBody,
      };
    }

    const response = await buildNonStreamingResponse({ accessToken, requestBody, model, cid, created, proxyOptions, signal, log });
    return { response, url: CHAT_STREAM_URL, headers: signedHeaders(accessToken), transformedBody: requestBody };
  }
}

export default ChatGLMExecutor;
