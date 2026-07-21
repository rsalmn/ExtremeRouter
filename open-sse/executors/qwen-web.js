import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Qwen Web — Alibaba Tongyi Qwen Chat via chat.qwen.ai (v2 API).
//
// The v2 API sits behind Alibaba's "baxia" WAF, which requires the FULL browser cookie jar from a
// real logged-in session (cna, ssxmod_itna, ssxmod_itna2, token, ...). The user pastes their entire
// cookie string and we replay it verbatim, plus extract the bearer `token` from it. A bare bearer
// token alone is rejected by the WAF.
//
// Flow:
//   1. POST /api/v2/chats/new                  → create a chat, returns chat_id
//   2. POST /api/v2/chat/completions?chat_id=  → phase-based SSE stream
//
// SSE chunks carry choices[0].delta with a `phase` field: think / thinking_summary map to reasoning,
// answer (or null phase) carries the assistant content.
//
// Ported from OmniRoute open-sse/executors/qwen-web.ts. Tool/function-calling is intentionally
// skipped — plain text chat only.

const CFG = PROVIDERS["qwen-web"];
// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at CFG.baseUrl (not CFG.transport.baseUrl). See grok-web / chatglm-cn executors.
const BASE_URL = CFG.baseUrl; // https://chat.qwen.ai
const CHATS_NEW_URL = `${BASE_URL}/api/v2/chats/new`;
const CHAT_COMPLETIONS_URL = `${BASE_URL}/api/v2/chat/completions`;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// Anti-bot headers the v2 endpoint expects. bx-umidtoken is normally minted per-session from
// sg-wum.alibaba.com; a captured value travels with the cookie jar, but we send a static fallback
// so the header is always present.
const BX_VERSION = "2.5.36";
const BX_UMIDTOKEN_FALLBACK = "T2gA0000000000000000000000000000000000000000";

// Qwen SPA version — required by the v2 chat completion endpoint. Without this header the upstream
// returns HTTP 200 with {"success":false,"data":{"code":"Bad_Request"}} for every request.
// Pinned from a live capture; bump if Qwen ships a breaking change.
const QWEN_SPA_VERSION = "0.2.66";

const MODEL_ALIASES = {
  // Legacy ids → current upstream catalog (GET /api/models).
  "qwen-plus": "qwen3.7-plus",
  "qwen-max": "qwen3.7-max",
  "qwen-turbo": "qwen3.6-plus",
  "qwen3-plus": "qwen3.7-plus",
  "qwen3-max": "qwen3.7-max",
  "qwen3-flash": "qwen3.6-plus",
  "qwen3-coder-plus": "qwen3.7-max",
  "qwen3-coder-flash": "qwen3.6-plus",
  qwen: "qwen3.7-max",
  qwen3: "qwen3.7-max",
};

const DEFAULT_MODEL = "qwen3.7-max";

// Some Qwen models reject requests with `thinking_enabled: false`. The model
// name doesn't always contain "think"/"reason", so we maintain an explicit
// allowlist — these models MUST get thinking_enabled=true.
const REQUIRED_THINKING_MODELS = new Set(["qwen3.8-max-preview"]);

function mapModel(modelId) {
  return MODEL_ALIASES[modelId] || modelId;
}

function uuid() {
  return crypto.randomUUID();
}

// ── Cookie / token helpers (inlined from OmniRoute webCookieAuth) ────────

function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";
  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

// Forward the whole pasted cookie blob verbatim — the WAF needs the full jar. Returns "" for a bare
// token (no cookie pairs) since there's no jar to replay.
function buildQwenCookieHeader(rawValue) {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed || !trimmed.includes("=")) return "";
  return trimmed;
}

// Extract the Qwen bearer token: a `token=...` cookie pair, or a bare token (no cookie pairs).
function extractQwenToken(rawValue) {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";
  if (!trimmed.includes("=")) return trimmed;
  const match = trimmed.match(/(?:^|;\s*)token=([^;\s]+)/);
  return match ? match[1] : "";
}

function errorResponse(status, message, code = `HTTP_${status}`) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/** Detect Alibaba's WAF / retired-v1 gateway page so we never surface raw HTML. */
function isWafResponse(status, contentType, bodyText) {
  if (contentType.includes("text/html")) return true;
  if (status === 504) return true;
  return /aliyun_waf|baxia|<html/i.test(bodyText);
}

const WAF_ERROR_MESSAGE =
  "Qwen session expired or blocked by Alibaba's WAF. Re-login at https://chat.qwen.ai and " +
  "paste a fresh full Cookie header (must include cna, ssxmod_itna and token) — a bearer token " +
  "alone is no longer accepted by the v2 endpoint.";

// ── Headers ─────────────────────────────────────────────────────────────

function buildHeaders(token, cookieHeader, chatId) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "*/*",
    "User-Agent": USER_AGENT,
    Origin: BASE_URL,
    Referer: chatId ? `${BASE_URL}/c/${chatId}` : `${BASE_URL}/`,
    source: "web",
    version: QWEN_SPA_VERSION,
    "x-request-id": uuid(),
    "bx-v": BX_VERSION,
    "bx-umidtoken": BX_UMIDTOKEN_FALLBACK,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (cookieHeader) headers["Cookie"] = cookieHeader;
  return headers;
}

// ── Prompt builder (Qwen web is single-turn) ────────────────────────────

function extractMessageText(content) {
  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text")
      .map((item) => String(item.text || ""))
      .join("\n");
  }
  return String(content || "");
}

// Fold the conversation into one user prompt (Qwen web is single-turn).
function foldMessages(messages) {
  let systemContent = "";
  let userContent = "";
  for (const m of messages) {
    const text = extractMessageText(m.content).trim();
    if (!text) continue;
    if (m.role === "system") {
      systemContent += (systemContent ? "\n\n" : "") + text;
    } else if (m.role === "user") {
      userContent = text;
    }
  }
  return systemContent ? `${systemContent}\n\nUser: ${userContent}` : userContent;
}

function buildMessagePayload(chatId, modelId, prompt, requestedModel) {
  const fid = uuid();
  // Thinking must be enabled when (a) the user picked a thinking-flavored
  // model name, OR (b) the model is in REQUIRED_THINKING_MODELS (those models
  // reject thinking_enabled:false with "Invalid input or attachment").
  const enableThinking =
    REQUIRED_THINKING_MODELS.has(modelId) || /think|reason|r1/i.test(requestedModel);
  const featureConfig = {
    thinking_enabled: enableThinking,
    output_schema: "phase",
    auto_thinking: enableThinking,
    research_mode: "normal",
    auto_search: false,
  };
  // Payload shape mirrors the proven OmniRoute reference implementation.
  // Adding extra fields (version, id, extra, edited, error, turn_id, instructions)
  // has been observed to trigger "invalid_input" rejections — keep it minimal.
  return {
    stream: true,
    incremental_output: true,
    chat_id: chatId,
    chat_mode: "normal",
    model: modelId,
    parent_id: null,
    messages: [
      {
        fid,
        parentId: null,
        childrenIds: [],
        role: "user",
        content: prompt,
        user_action: "chat",
        files: [],
        timestamp: Math.floor(Date.now() / 1000),
        models: [modelId],
        chat_type: "t2t",
        feature_config: featureConfig,
        sub_chat_type: "t2t",
        parent_id: null,
      },
    ],
  };
}

// ── SSE delta parser ────────────────────────────────────────────────────

/** Parse one SSE line into a typed delta, or null if it carries no content. */
function parseSseDelta(line) {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  // v2.1 error envelope: top-level `error` object arrives as its own event
  // (e.g. {"error":{"code":"invalid_input","details":"..."},"response_id":...}).
  // Surface it so the streaming transform can show the message instead of
  // silently ending with empty content.
  if (parsed?.error) {
    const details = parsed.error.details || parsed.error.message || parsed.error.code || "upstream error";
    return { kind: "error", text: details };
  }
  // Lifecycle events (response.created, response.completed, etc.) carry no
  // content — ignore. The v2.1 protocol wraps them as {"<event_name>": {...}}.
  if (parsed?.response_created || parsed?.response_completed) return null;

  const delta = parsed?.choices?.[0]?.delta;
  if (!delta) return null;
  const phase = delta.phase;
  const content = typeof delta.content === "string" ? delta.content : "";

  // thinking_summary phase (qwen3.8+ / v2.1): the actual reasoning text lives
  // in delta.extra.summary_thought.content[] (array of strings), NOT in
  // delta.content (which is empty ""). Same for summary_title. Concatenate
  // the array entries so the reasoning stream isn't dropped on the floor.
  if (phase === "thinking_summary") {
    const extra = delta.extra || {};
    const parts = [];
    if (Array.isArray(extra.summary_title?.content)) {
      parts.push(...extra.summary_title.content);
    }
    if (Array.isArray(extra.summary_thought?.content)) {
      parts.push(...extra.summary_thought.content);
    }
    const text = parts.filter(Boolean).join("\n");
    return text ? { kind: "think", text } : null;
  }

  if (phase === "think") {
    return { kind: "think", text: content };
  }
  // answer phase or a null/absent phase both carry assistant content.
  if (phase === "answer" || phase === null || phase === undefined) {
    return { kind: "answer", text: content };
  }
  return null;
}

// ── Streaming transform ─────────────────────────────────────────────────

function buildClientStream(upstreamBody, modelId, signal) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-qwen-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const push = (deltaObj, finishReason = null) =>
    encoder.encode(
      sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model: modelId,
        choices: [{ index: 0, delta: deltaObj, finish_reason: finishReason }],
      })
    );

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody?.getReader();
      if (!reader) {
        controller.enqueue(push({ role: "assistant", content: "" }));
        controller.enqueue(push({}, "stop"));
        controller.enqueue(encoder.encode(SSE_DONE));
        try { controller.close(); } catch { /* */ }
        return;
      }
      let buffer = "";
      let emittedRole = false;
      try {
        while (true) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const delta = parseSseDelta(line);
            if (!delta || !delta.text) continue;
            if (!emittedRole) {
              emittedRole = true;
              controller.enqueue(push({ role: "assistant", content: "" }));
            }
            if (delta.kind === "error") {
              // v2.1 upstream error mid-stream — surface as content so the user
              // sees why the response stopped (e.g. "Invalid input or attachment").
              controller.enqueue(push({ content: `\n\n[Qwen error: ${delta.text}]` }));
            } else if (delta.kind === "answer") {
              controller.enqueue(push({ content: delta.text }));
            } else if (delta.kind === "think") {
              controller.enqueue(push({ reasoning_content: delta.text }));
            }
          }
        }
      } catch (err) {
        if (!signal?.aborted) {
          try { controller.error(err); return; } catch { /* */ }
        }
      }

      if (!emittedRole) controller.enqueue(push({ role: "assistant", content: "" }));
      controller.enqueue(push({}, "stop"));
      controller.enqueue(encoder.encode(SSE_DONE));
      try { controller.close(); } catch { /* */ }
    },
  });
}

// ── Non-streaming aggregator ────────────────────────────────────────────

async function collectStream(upstreamBody, signal) {
  const reader = upstreamBody?.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let reasoning = "";
  let error = "";
  if (!reader) return { content, reasoning, error };

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
        const delta = parseSseDelta(line);
        if (!delta) continue;
        if (delta.kind === "answer") content += delta.text;
        else if (delta.kind === "think") reasoning += delta.text;
        else if (delta.kind === "error") error = delta.text;
      }
    }
  } catch {
    /* upstream closed mid-stream — return what we have */
  }
  return { content, reasoning, error };
}

// ── Executor ────────────────────────────────────────────────────────────

export class QwenWebExecutor extends BaseExecutor {
  constructor() {
    super("qwen-web", CFG);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};

    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    if (messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array."),
        url: CHATS_NEW_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const rawCred = String(credentials?.apiKey ?? "").trim();
    const cookieHeader = buildQwenCookieHeader(rawCred);
    let token = extractQwenToken(rawCred);
    if (!token && credentials?.accessToken) token = String(credentials.accessToken).trim();

    if (!token && !cookieHeader) {
      return {
        response: errorResponse(
          401,
          "Qwen needs your chat.qwen.ai cookies. Paste the full Cookie header (must include cna, " +
            "ssxmod_itna and token). A bare bearer token alone is rejected by the WAF."
        ),
        url: CHATS_NEW_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const requestedModel = bodyObj.model || DEFAULT_MODEL;
    const modelId = mapModel(requestedModel);
    const prompt = foldMessages(messages);

    // ── Step 1: create a chat ────────────────────────────────────────────
    let chatId;
    try {
      const newChatRes = await proxyAwareFetch(
        CHATS_NEW_URL,
        {
          method: "POST",
          headers: buildHeaders(token, cookieHeader),
          body: JSON.stringify({
            title: "New Chat",
            models: [modelId],
            chat_mode: "normal",
            chat_type: "t2t",
            timestamp: Date.now(),
          }),
          signal,
        },
        proxyOptions
      );

      const ct = newChatRes.headers.get("content-type") || "";
      if (!newChatRes.ok || ct.includes("text/html")) {
        const text = await newChatRes.text().catch(() => "");
        if (isWafResponse(newChatRes.status, ct, text)) {
          return {
            response: errorResponse(401, WAF_ERROR_MESSAGE, "WAF_BLOCKED"),
            url: CHATS_NEW_URL,
            headers: {},
            transformedBody: body,
          };
        }
        return {
          response: errorResponse(
            newChatRes.status || 502,
            `Qwen create-chat failed: ${text.slice(0, 300)}`
          ),
          url: CHATS_NEW_URL,
          headers: {},
          transformedBody: body,
        };
      }

      const data = await newChatRes.json();
      chatId = data?.data?.id ?? "";
      if (!chatId) {
        return {
          response: errorResponse(502, "Qwen create-chat returned no chat id"),
          url: CHATS_NEW_URL,
          headers: {},
          transformedBody: body,
        };
      }
    } catch (err) {
      const aborted = err?.name === "AbortError";
      if (aborted) throw err;
      const msg = err instanceof Error ? err.message : "unknown";
      return {
        response: errorResponse(502, `Qwen create-chat error: ${msg}`),
        url: CHATS_NEW_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // ── Step 2: send the message ────────────────────────────────────────
    const completionUrl = `${CHAT_COMPLETIONS_URL}?chat_id=${chatId}`;
    const msgPayload = buildMessagePayload(chatId, modelId, prompt, requestedModel);

    let upstream;
    try {
      upstream = await proxyAwareFetch(
        completionUrl,
        {
          method: "POST",
          headers: buildHeaders(token, cookieHeader, chatId),
          body: JSON.stringify(msgPayload),
          signal,
        },
        proxyOptions
      );
    } catch (err) {
      const aborted = err?.name === "AbortError";
      if (aborted) throw err;
      const msg = err instanceof Error ? err.message : "unknown";
      return {
        response: errorResponse(502, `Qwen completion fetch failed: ${msg}`),
        url: completionUrl,
        headers: {},
        transformedBody: msgPayload,
      };
    }

    const ct = upstream.headers.get("content-type") || "";
    if (!upstream.ok || ct.includes("text/html")) {
      const errText = await upstream.text().catch(() => "");
      if (isWafResponse(upstream.status, ct, errText)) {
        return {
          response: errorResponse(401, WAF_ERROR_MESSAGE, "WAF_BLOCKED"),
          url: completionUrl,
          headers: {},
          transformedBody: msgPayload,
        };
      }
      return {
        response: errorResponse(
          upstream.status || 502,
          `Qwen error: ${errText.slice(0, 300)}`
        ),
        url: completionUrl,
        headers: {},
        transformedBody: msgPayload,
      };
    }

    if (!stream) {
      const { content, reasoning, error } = await collectStream(upstream.body, signal);
      // If the upstream sent an error envelope mid-stream (v2.1 format) AND no
      // content was produced, treat it as a failed request so the user sees the
      // real cause instead of an empty 200.
      if (error && !content) {
        return {
          response: errorResponse(502, `Qwen error: ${error}`, "UPSTREAM_ERROR"),
          url: completionUrl,
          headers: buildHeaders(token, cookieHeader, chatId),
          transformedBody: msgPayload,
        };
      }
      const message = { role: "assistant", content: content || (error ? `[Qwen error: ${error}]` : "") };
      if (reasoning) message.reasoning_content = reasoning;
      return {
        response: new Response(
          JSON.stringify({
            id: `chatcmpl-qwen-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{ index: 0, message, finish_reason: "stop", logprobs: null }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
        url: completionUrl,
        headers: buildHeaders(token, cookieHeader, chatId),
        transformedBody: msgPayload,
      };
    }

    // Streaming: transform Qwen phase SSE → OpenAI chat.completion.chunk SSE.
    const stream$ = buildClientStream(upstream.body, modelId, signal);
    return {
      response: new Response(stream$, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      }),
      url: completionUrl,
      headers: buildHeaders(token, cookieHeader, chatId),
      transformedBody: msgPayload,
    };
  }
}

export default QwenWebExecutor;
