// Muse Spark Web (Meta AI) — reverse-adapter for meta.ai's consumer GraphQL chat.
//
// Ported from OmniRoute's muse-spark-web executor to ExtremeRouter's executor pattern.
// meta.ai is NOT an OpenAI-compatible API: this executor bridges it by POSTing a GraphQL
// persisted-query "subscription" to https://www.meta.ai/api/graphql and translating the
// streamed AssistantMessage payloads into OpenAI chat.completion.chunk frames.
//
//   1. Auth: replay the `ecto_1_sess` session cookie (formerly `abra_sess`). Users paste a
//      bare value or a full cookie line; normalizeMetaAiCookieHeader() handles both.
//   2. Continuity: an in-memory cache maps (connectionId, model, normalized history prefix)
//      → a meta.ai conversationId so repeated turns grow ONE meta.ai conversation instead of
//      opening a fresh one each turn. See the cache block below for the rationale.
//   3. IDs: meta.ai's conversationId/eventId are base62-packed (timestamp || random) blobs;
//      generateMetaConversationId()/generateMetaEventId() reproduce the format the web client
//      emits so server-side validation passes.
//   4. Translation: the GraphQL response (plain JSON or SSE-framed JSON) is scanned for
//      AssistantMessage payloads; contentRenderer is walked recursively for text, and the
//      thinking models' reasoning is surfaced via reasoning_content.
//
// Credential input (apiKey field): the ecto_1_sess cookie value or full cookie line.

import { createHash } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Source-of-truth endpoint. We prefer the flat baseUrl the registry loader exposes
// (PROVIDERS["muse-spark-web"].baseUrl — buildTransport() in providers/index.js flattens
// `transport` to the top level; see grok-web / chatglm-cn executors), but fall back to the
// constant so this module loads even before its registry entry is wired into index.js.
const META_AI_GRAPHQL_API = PROVIDERS["muse-spark-web"]?.baseUrl || "https://www.meta.ai/api/graphql";

// Meta rebranded the chat product from "Abra" to "Ecto"; the session cookie `abra_sess` was
// replaced by `ecto_1_sess`. normalizeSessionCookieHeader() only uses this default when the
// user pastes a bare cookie value with no `name=` prefix; full cookie lines pass through
// untouched, so users who paste their entire DevTools cookie line still work.
const META_AI_DEFAULT_COOKIE = "ecto_1_sess";
// Persisted-query id for the current send-message operation. This is a Subscription rather
// than a Mutation, but Meta's GraphQL endpoint still accepts it over POST and streams the
// response. (The previous Abra mutation with RewriteOptionsInput was retired when Meta
// removed that type from the schema.)
const META_AI_SEND_MESSAGE_DOC_ID = "29ae946c82d1f301196c6ca2226400b5";
const META_AI_ROOT_BRANCH_PATH = "0";
const META_AI_ENTRY_POINT = "KADABRA__CHAT__UNIFIED_INPUT_BAR";
const META_AI_FRIENDLY_NAME = "useEctoSendMessageSubscription";
const META_AI_REQUEST_ANALYTICS_TAGS = "graphservice";
const META_AI_ASBD_ID = "129477";
const META_AI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const MODEL_MAP = {
  "muse-spark": { mode: "mode_fast", isThinking: false },
  "muse-spark-thinking": { mode: "mode_thinking", isThinking: true },
  "muse-spark-contemplating": { mode: "think_hard", isThinking: true },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getMuseSparkModelInfo(model) {
  return MODEL_MAP[model] || MODEL_MAP["muse-spark"];
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function encodeBase62(value, padLength) {
  let remaining = value;
  let encoded = "";
  while (remaining > 0n) {
    encoded = BASE62_ALPHABET[Number(remaining % 62n)] + encoded;
    remaining /= 62n;
  }
  return encoded.padStart(padLength, "0");
}

function decodeBase62(value) {
  let decoded = 0n;
  for (const char of value) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base62 character: ${char}`);
    decoded = decoded * 62n + BigInt(index);
  }
  return decoded;
}

function randomBigInt(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

// meta.ai conversationIds look like "c.<19 base62 chars>" — a 44-bit timestamp shifted left
// 64 bits OR'd with 64 bits of randomness. We reproduce the format so server-side validation
// accepts our self-generated ids for new conversations.
function generateMetaConversationId() {
  const timestamp = BigInt(Date.now()) & ((1n << 44n) - 1n);
  const random = randomBigInt(8) & ((1n << 64n) - 1n);
  const packed = (timestamp << 64n) | random;
  return `c.${encodeBase62(packed, 19)}`;
}

// Event ids ("e.<25 base62 chars>") are derived from the conversation's random suffix so the
// server can correlate them. Returns null if the conversationId isn't in our format.
function generateMetaEventId(conversationId) {
  if (!conversationId.startsWith("c.")) return null;
  try {
    const packedConversation = decodeBase62(conversationId.slice(2));
    const conversationRandom = packedConversation & ((1n << 64n) - 1n);
    const timestamp = BigInt(Date.now()) & ((1n << 44n) - 1n);
    const eventRandom = randomBigInt(4) & ((1n << 32n) - 1n);
    const packedEvent =
      (timestamp << (64n + 32n)) | (conversationRandom << 32n) | eventRandom;
    return `e.${encodeBase62(packedEvent, 25)}`;
  } catch {
    return null;
  }
}

function generateNumericMessageId() {
  return (
    BigInt(Date.now()) * 1000n +
    BigInt(Math.floor(Math.random() * 1000)) +
    (randomBigInt(2) & 0xfffn)
  ).toString();
}

function normalizeMetaLocale() {
  const locale =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().locale || "en-US"
      : "en-US";
  return locale.replace(/-/g, "_");
}

// ─── Cookie handling (inlined from OmniRoute webCookieAuth) ──────────────────

function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";
  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

// Emit a `Cookie:` header value. If the user pasted a bare value (no `=`), wrap it as
// `ecto_1_sess=<value>`; otherwise pass the full line through verbatim so multi-cookie lines
// from DevTools keep working.
export function normalizeMetaAiCookieHeader(rawValue) {
  const normalized = stripCookieInputPrefix(rawValue);
  if (!normalized) return "";
  if (normalized.includes("=")) return normalized;
  return `${META_AI_DEFAULT_COOKIE}=${normalized}`;
}

function selectMetaAiCookieHeader(credentials) {
  // OmniRoute supported a rotating pool of extra cookies; ExtremeRouter only exposes the
  // single apiKey, so just normalize that. extraApiKeys (if ever populated) are folded in too.
  const extraCookieValues = Array.isArray(credentials?.providerSpecificData?.extraApiKeys)
    ? credentials.providerSpecificData.extraApiKeys.filter(
        (v) => typeof v === "string" && v.trim().length > 0
      )
    : [];
  const pool = [credentials?.apiKey || "", ...extraCookieValues]
    .map(normalizeMetaAiCookieHeader)
    .filter((v) => v.length > 0);
  if (pool.length === 0) return "";
  return pool[0];
}

// ─── OpenAI message flattening ───────────────────────────────────────────────
// meta.ai has no native multi-turn API surface we can target; we fold the OpenAI history into
// a single prompt, labeling turns by role (the last user turn is sent bare so the model treats
// it as the thing to answer).

function extractMessageText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "input_text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter((p) => p.trim().length > 0)
    .join("\n")
    .trim();
}

function parseOpenAIMessages(messages) {
  const extracted = [];
  for (const message of messages) {
    let role = String(message.role || "user");
    if (role === "developer") role = "system";
    const content = extractMessageText(message.content);
    if (!content) continue;
    extracted.push({ role, content });
  }

  if (extracted.length === 0) {
    return { foldedPrompt: "", latestUserContent: "", lastAssistantIndex: -1, normalized: [] };
  }

  let lastUserIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") { lastUserIndex = i; break; }
  }
  let lastAssistantIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "assistant") { lastAssistantIndex = i; break; }
  }

  const foldedPrompt = extracted
    .map((message, index) =>
      index === lastUserIndex ? message.content : `${message.role}: ${message.content}`
    )
    .join("\n\n")
    .trim();

  const latestUserContent = lastUserIndex >= 0 ? extracted[lastUserIndex].content : "";
  return { foldedPrompt, latestUserContent, lastAssistantIndex, normalized: extracted };
}

// ─── Conversation continuity cache ───────────────────────────────────────────
// The default behavior of /v1/chat/completions is stateless: the caller passes the full message
// history each turn. Without continuation, every turn would open a brand-new meta.ai
// conversation containing the OpenAI history folded into one user prompt — three real chat
// turns become three separate conversations, each polluted with prior turns rendered as
// "user: …" / "assistant: …" text.
//
// To present a clean single growing conversation in meta.ai, we cache the conversationId we
// created on the previous turn keyed by a hash of (connectionId, model, normalized history
// through the last assistant turn). On the next turn, if the incoming history's prefix matches
// a cached entry, we reuse the cached conversationId, set isNewConversation=false, and send only
// the latest user turn — Meta appends to the existing conversation tree.
//
// Hashing the *full prefix* (not just the assistant text) is important: two independent chats
// from the same connection that happen to land on identical assistant text would otherwise
// collide and route the next turn into the wrong meta.ai conversation. TTL is 30 minutes.

const MUSE_CONV_CACHE_MAX = 5000;
const MUSE_CONV_CACHE_TTL_MS = 30 * 60 * 1000;
const conversationCache = new Map();

function canonicalizeNormalizedHistory(messages) {
  return messages.map((m) => `${m.role}\x1e${m.content}`).join("\x1f");
}

function makeConversationCacheKey(connectionId, model, normalizedPrefix) {
  return createHash("sha256")
    .update(`${connectionId}\x1f${model}\x1f${canonicalizeNormalizedHistory(normalizedPrefix)}`)
    .digest("hex");
}

function lookupCachedConversation(key) {
  const entry = conversationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    conversationCache.delete(key);
    return null;
  }
  return entry;
}

function rememberConversation(key, context) {
  if (conversationCache.size >= MUSE_CONV_CACHE_MAX && !conversationCache.has(key)) {
    const oldest = conversationCache.keys().next().value;
    if (oldest) conversationCache.delete(oldest);
  }
  conversationCache.set(key, {
    conversationId: context.conversationId,
    branchPath: context.branchPath,
    expiresAt: Date.now() + MUSE_CONV_CACHE_TTL_MS,
  });
}

// ─── GraphQL request body + headers ──────────────────────────────────────────

function buildMetaAiRequestBody(prompt, model, conversation) {
  return {
    doc_id: META_AI_SEND_MESSAGE_DOC_ID,
    variables: {
      assistantMessageId: crypto.randomUUID(),
      attachments: null,
      clientLatitude: null,
      clientLongitude: null,
      clientTimezone:
        typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
      clippyIp: null,
      content: prompt,
      conversationId: conversation.conversationId,
      conversationStarterId: null,
      currentBranchPath: conversation.branchPath,
      developerOverridesForMessage: null,
      devicePixelRatio: 1,
      entryPoint: META_AI_ENTRY_POINT,
      imagineOperationRequest: null,
      isNewConversation: conversation.isNewConversation,
      mentions: null,
      mode: getMuseSparkModelInfo(model).mode,
      promptEditType: null,
      promptSessionId: crypto.randomUUID(),
      promptType: null,
      qplJoinId: null,
      requestedToolCall: null,
      // `rewriteOptions` was removed from Meta's GraphQL schema; sending it (even null) makes
      // the server reject the persisted query with "Unknown type RewriteOptionsInput". Omit it.
      turnId: crypto.randomUUID(),
      userAgent: META_AI_USER_AGENT,
      userEventId: generateMetaEventId(conversation.conversationId),
      userLocale: normalizeMetaLocale(),
      userMessageId: crypto.randomUUID(),
      userUniqueMessageId: generateNumericMessageId(),
    },
  };
}

function buildMetaAiHeaders(cookieHeader) {
  return {
    Accept: "text/event-stream",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    Origin: "https://www.meta.ai",
    Referer: "https://www.meta.ai/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": META_AI_USER_AGENT,
    "X-ASBD-ID": META_AI_ASBD_ID,
    "X-FB-Friendly-Name": META_AI_FRIENDLY_NAME,
    "X-FB-Request-Analytics-Tags": META_AI_REQUEST_ANALYTICS_TAGS,
  };
}

// ─── Response parsing ────────────────────────────────────────────────────────
// Meta streams the GraphQL subscription result either as a single JSON document or as SSE
// frames (`event:`/`data:` lines). We normalize both into a list of JSON payloads, then scan
// each for an `AssistantMessage` payload, walking its contentRenderer tree for text and (for
// thinking models) reasoning.

const META_AI_REASONING_KEYS = [
  "reasoning", "reasoningContent", "reasoning_content", "reasoningText",
  "thinking", "thinkingContent", "thinkingText",
  "thought", "thoughtText", "thoughts",
  "internalThoughts", "chainOfThought",
  "thinkingTrace", "thinking_trace",
];

const META_AI_NESTED_RENDERER_KEYS = [
  "contentRenderer", "textContent", "message", "mediaContent",
  "unified_response", "unifiedResponseContent",
  "sections", "view_model", "primitive", "primitives", "nested_responses",
];

function parseMetaSseFrames(text) {
  const frames = [];
  const lines = text.split(/\r?\n/);
  let currentEvent = "message";
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0 && currentEvent === "message") return;
    frames.push({ event: currentEvent, data: dataLines.join("\n").trim() });
    currentEvent = "message";
    dataLines = [];
  };
  for (const line of lines) {
    if (!line) { flush(); continue; }
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      currentEvent = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
  }
  flush();
  return frames;
}

function readMetaJsonPayloads(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return isRecord(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  }
  return parseMetaSseFrames(text)
    .filter((frame) => frame.data)
    .map((frame) => {
      try {
        const parsed = JSON.parse(frame.data);
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function collectRendererTexts(value, seen, depth = 0) {
  if (depth > 8) return [];
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectRendererTexts(item, seen, depth + 1));
  }
  if (!isRecord(value)) return [];
  const parts = [];
  if (typeof value.text === "string") {
    parts.push(...collectRendererTexts(value.text, seen, depth + 1));
  }
  for (const key of META_AI_NESTED_RENDERER_KEYS) {
    if (key in value) parts.push(...collectRendererTexts(value[key], seen, depth + 1));
  }
  return parts;
}

function collectReasoningTexts(value, seen, depth = 0, force = false) {
  if (depth > 8) return [];
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!force || !normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectReasoningTexts(item, seen, depth + 1, force));
  }
  if (!isRecord(value)) return [];
  const typename = typeof value.__typename === "string" ? value.__typename : "";
  const localForce = force || /reasoning|thinking|thought/i.test(typename);
  const parts = [];
  if (typeof value.text === "string" && localForce) {
    parts.push(...collectReasoningTexts(value.text, seen, depth + 1, true));
  }
  for (const key of META_AI_REASONING_KEYS) {
    if (key in value) parts.push(...collectReasoningTexts(value[key], seen, depth + 1, true));
  }
  for (const key of META_AI_NESTED_RENDERER_KEYS) {
    if (key in value) parts.push(...collectReasoningTexts(value[key], seen, depth + 1, localForce));
  }
  return parts;
}

function extractAssistantContent(message) {
  if (typeof message.content === "string" && message.content.length > 0) return message.content;
  const contentRenderer = isRecord(message.contentRenderer) ? message.contentRenderer : null;
  if (!contentRenderer) return "";
  return collectRendererTexts(contentRenderer, new Set()).join("\n\n").trim();
}

function extractAssistantReasoning(message) {
  return collectReasoningTexts(message, new Set()).join("\n\n").trim();
}

function extractAssistantError(message) {
  const error = isRecord(message.error) ? message.error : null;
  const streamingState =
    typeof message.streamingState === "string" ? message.streamingState.toUpperCase() : null;
  return {
    code: typeof error?.code === "string" ? error.code : null,
    message:
      typeof error?.message === "string"
        ? error.message.trim()
        : streamingState === "ERROR" &&
          typeof message.content === "string" &&
          message.content.trim()
          ? message.content.trim()
          : null,
  };
}

function classifyMetaAiError(errorMessage, content) {
  const combined = `${errorMessage || ""}\n${content}`.trim();
  if (!combined) return null;
  if (/authentication required to send messages|login is required|sign in/i.test(combined)) {
    return {
      status: 401,
      message: "Meta AI auth failed — your meta.ai ecto_1_sess cookie may be missing or expired.",
    };
  }
  if (/limit exceeded|rate limit|too many requests/i.test(combined)) {
    return { status: 429, message: "Meta AI rate limited the session. Wait a moment and retry." };
  }
  if (/blocked by our security system|security system/i.test(combined)) {
    return {
      status: 403,
      message:
        "Meta AI blocked the request through its web security checks. Refresh the session cookie and retry.",
    };
  }
  return null;
}

// Parse the full text response into incremental content/reasoning deltas plus any error.
function parseMetaAiResponseText(text, isThinkingModel) {
  let lastContent = "";
  const deltas = [];
  let lastReasoning = "";
  const reasoningDeltas = [];
  let errorCode = null;
  let errorMessage = null;

  for (const payload of readMetaJsonPayloads(text)) {
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const firstError = payload.errors.find(
        (item) => isRecord(item) && typeof item.message === "string"
      );
      if (isRecord(firstError) && typeof firstError.message === "string") {
        errorMessage = firstError.message.trim();
      }
    }

    const data = isRecord(payload.data) ? payload.data : null;
    const sendMessageStream = isRecord(data?.sendMessageStream) ? data?.sendMessageStream : null;
    if (!sendMessageStream || sendMessageStream.__typename !== "AssistantMessage") continue;

    const content = extractAssistantContent(sendMessageStream);
    if (content && content !== lastContent) {
      deltas.push(content.startsWith(lastContent) ? content.slice(lastContent.length) : content);
      lastContent = content;
    }

    if (isThinkingModel) {
      const reasoning = extractAssistantReasoning(sendMessageStream);
      if (reasoning && reasoning !== content && reasoning !== lastReasoning) {
        reasoningDeltas.push(
          reasoning.startsWith(lastReasoning) ? reasoning.slice(lastReasoning.length) : reasoning
        );
        lastReasoning = reasoning;
      }
    }

    const upstreamError = extractAssistantError(sendMessageStream);
    if (upstreamError.message) {
      errorMessage = upstreamError.message;
      errorCode = upstreamError.code;
    }
  }

  const classifiedError = classifyMetaAiError(errorMessage, lastContent);
  if (classifiedError) {
    return {
      content: lastContent, deltas,
      reasoningContent: lastReasoning, reasoningDeltas,
      errorCode, errorMessage: classifiedError.message, status: classifiedError.status,
    };
  }
  if (errorMessage) {
    return {
      content: lastContent, deltas,
      reasoningContent: lastReasoning, reasoningDeltas,
      errorCode, errorMessage: `Meta AI returned an error: ${errorMessage}`, status: 502,
    };
  }
  if (!lastContent) {
    return {
      content: "", deltas: [],
      reasoningContent: lastReasoning, reasoningDeltas,
      errorCode: null, errorMessage: "Meta AI returned no assistant content", status: 502,
    };
  }
  return {
    content: lastContent,
    deltas: deltas.filter((d) => d.length > 0),
    reasoningContent: lastReasoning,
    reasoningDeltas: reasoningDeltas.filter((d) => d.length > 0),
    errorCode: null, errorMessage: null, status: 200,
  };
}

// ─── Response builders ───────────────────────────────────────────────────────

function buildStreamingResponse(deltas, reasoningDeltas, model, id, created) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const push = (delta) =>
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta, finish_reason: null, logprobs: null }],
            })
          )
        );

      push({ role: "assistant" });
      for (const delta of reasoningDeltas) if (delta) push({ reasoning_content: delta });
      for (const delta of deltas) if (delta) push({ content: delta });
      controller.enqueue(
        encoder.encode(
          sseChunk({
            id, object: "chat.completion.chunk", created, model, system_fingerprint: null,
            choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
          })
        )
      );
      controller.enqueue(encoder.encode(SSE_DONE));
      controller.close();
    },
  });
}

function buildNonStreamingResponse(content, reasoningContent, model, id, created) {
  const completionTokens = estimateTokens(content);
  const message = { role: "assistant", content };
  if (reasoningContent) message.reasoning_content = reasoningContent;
  return new Response(
    JSON.stringify({
      id, object: "chat.completion", created, model, system_fingerprint: null,
      choices: [{ index: 0, message, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: completionTokens, completion_tokens: completionTokens, total_tokens: completionTokens * 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function buildErrorResponse(status, message, code) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", ...(code ? { code } : {}) } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

async function readTextResponse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class MuseSparkWebExecutor extends BaseExecutor {
  constructor() {
    super("muse-spark-web", PROVIDERS["muse-spark-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        response: buildErrorResponse(400, "Missing or empty messages array", "invalid_request"),
        url: META_AI_GRAPHQL_API, headers: {}, transformedBody: body,
      };
    }

    const parsedHistory = parseOpenAIMessages(messages);
    if (!parsedHistory.foldedPrompt) {
      return {
        response: buildErrorResponse(400, "Empty query after processing messages", "invalid_request"),
        url: META_AI_GRAPHQL_API, headers: {}, transformedBody: body,
      };
    }

    const cookieHeader = selectMetaAiCookieHeader(credentials);
    if (!cookieHeader) {
      return {
        response: buildErrorResponse(
          401,
          "Meta AI needs your meta.ai ecto_1_sess cookie. Paste it in the connection.",
          "NO_COOKIE"
        ),
        url: META_AI_GRAPHQL_API, headers: {}, transformedBody: body,
      };
    }

    // Continuity lookup: reuse a cached conversation when the caller is continuing an existing
    // chat thread. Requires a non-empty latest user turn and a last-assistant-turn prefix to
    // hash (so a brand-new or assistant-prefill payload always opens a fresh conversation).
    const connectionId = credentials?.connectionId || "";
    const cacheKey =
      parsedHistory.lastAssistantIndex >= 0 &&
      connectionId &&
      parsedHistory.latestUserContent.length > 0
        ? makeConversationCacheKey(
            connectionId,
            model,
            parsedHistory.normalized.slice(0, parsedHistory.lastAssistantIndex + 1)
          )
        : null;
    const cached = cacheKey ? lookupCachedConversation(cacheKey) : null;
    const conversation = cached
      ? { conversationId: cached.conversationId, branchPath: cached.branchPath, isNewConversation: false }
      : { conversationId: generateMetaConversationId(), branchPath: META_AI_ROOT_BRANCH_PATH, isNewConversation: true };

    const prompt = cached ? parsedHistory.latestUserContent : parsedHistory.foldedPrompt;
    const modelInfo = getMuseSparkModelInfo(model);
    const transformedBody = buildMetaAiRequestBody(prompt, model, conversation);
    const headers = buildMetaAiHeaders(cookieHeader);

    log?.info?.(
      "MUSE-SPARK-WEB",
      `Query to ${model} (mode=${modelInfo.mode}, new=${conversation.isNewConversation}), len=${prompt.length}`
    );

    let response;
    try {
      response = await proxyAwareFetch(
        META_AI_GRAPHQL_API,
        { method: "POST", headers, body: JSON.stringify(transformedBody), signal },
        proxyOptions
      );
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      const message = err?.message || String(err);
      log?.error?.("MUSE-SPARK-WEB", `Fetch failed: ${message}`);
      if (cached && cacheKey) conversationCache.delete(cacheKey);
      return {
        response: buildErrorResponse(502, `Meta AI connection failed: ${message}`, "meta_ai_fetch_failed"),
        url: META_AI_GRAPHQL_API, headers, transformedBody,
      };
    }

    if (!response.ok) {
      // A failed continuation is stale: evict so the next turn opens a fresh conversation.
      if (cached && cacheKey) conversationCache.delete(cacheKey);
      let message = `Meta AI returned HTTP ${response.status}`;
      if (response.status === 401 || response.status === 403) {
        message = "Meta AI auth failed — your meta.ai ecto_1_sess cookie may be missing or expired.";
      } else if (response.status === 429) {
        message = "Meta AI rate limited the session. Wait a moment and retry.";
      }
      log?.warn?.("MUSE-SPARK-WEB", message);
      return {
        response: buildErrorResponse(response.status, message, `HTTP_${response.status}`),
        url: META_AI_GRAPHQL_API, headers, transformedBody,
      };
    }

    if (!response.body) {
      return {
        response: buildErrorResponse(502, "Meta AI returned an empty response body", "meta_ai_empty_body"),
        url: META_AI_GRAPHQL_API, headers, transformedBody,
      };
    }

    const responseText = await readTextResponse(response.body, signal);
    const parsed = parseMetaAiResponseText(responseText, modelInfo.isThinking);
    if (parsed.status !== 200 || parsed.errorMessage) {
      if (cached && cacheKey) conversationCache.delete(cacheKey);
      return {
        response: buildErrorResponse(
          parsed.status,
          parsed.errorMessage || "Meta AI returned an unknown error",
          parsed.errorCode || "meta_ai_unknown_error"
        ),
        url: META_AI_GRAPHQL_API, headers, transformedBody,
      };
    }

    // Remember this (history → response) pair so the next turn continues this conversation.
    if (parsed.content && connectionId) {
      rememberConversation(
        makeConversationCacheKey(connectionId, model, [
          ...parsedHistory.normalized,
          { role: "assistant", content: parsed.content },
        ]),
        { conversationId: conversation.conversationId, branchPath: conversation.branchPath }
      );
    }

    const cid = `chatcmpl-meta-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const deltas = parsed.deltas.length > 0 ? parsed.deltas : [parsed.content];

    const finalResponse = stream
      ? new Response(
          buildStreamingResponse(deltas, parsed.reasoningDeltas, model, cid, created),
          { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }
        )
      : buildNonStreamingResponse(parsed.content, parsed.reasoningContent, model, cid, created);

    return { response: finalResponse, url: META_AI_GRAPHQL_API, headers, transformedBody };
  }
}

export default MuseSparkWebExecutor;
