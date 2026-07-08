// ChatGptWebExecutor — ChatGPT Web (chatgpt.com) cookie provider.
//
// ── ANTI-BOT REALITY ─────────────────────────────────────────────────────────
// chatgpt.com runs an aggressive Sentinel anti-bot stack: proof-of-work, Turnstile, device-id +
// TLS-fingerprint scoring. OmniRoute defeats it with native TLS impersonation (chatgptTlsClient).
// ExtremeRouter uses plain Node `proxyAwareFetch`, so even though this port solves the PoW and
// posts the exact browser headers, requests will USUALLY be blocked (403 / "needs a browser" /
// cf-mitigated). If it fails, your __Secure-next-auth.session-token cookie is likely still valid
// — the TLS fingerprint is rejected, not your login. This is an anti-bot limitation, NOT a code bug.
// For reliable access use the official 'openai' provider.
//
// ── CORE CHAT FLOW PORTED (faithful to OmniRoute) ────────────────────────────
//   1. exchangeSession()        GET  /api/auth/session       cookie → JWT accessToken (cached 5min)
//   2. fetchDpl()               GET  /                       scrape data-build + script src for PoW config
//   3. prepareChatRequirements()POST /backend-api/sentinel/chat-requirements(/prepare) → { token, proofofwork, ... }
//   4. solveProofOfWork()       SHA3-512 hash loop           → "gAAAAAB…" sentinel proof token
//   5. POST /backend-api/f/conversation                      Bearer + sentinel tokens + browser UA → SSE
//   6. parse SSE (CUMULATIVE parts[0]) → OpenAI chat.completion(.chunk) frames
//
// ── SIMPLIFIED / SKIPPED vs OmniRoute (documented) ───────────────────────────
//   • TLS impersonation (tlsFetchChatGpt) → plain proxyAwareFetch (will likely 403)
//   • Tool/function-calling emulation (prepareToolMessages, buildToolModeResponse) → SKIPPED (text only)
//   • Image generation / async image polling / image caching → SKIPPED (text only)
//   • GPT-5.5 Pro stream_handoff → final-answer polling → SKIPPED (text only; Pro may truncate)
//   • Session warmup (GET /me, /conversations, /models) → SKIPPED (best-effort, not load-bearing)
//   • Thinking-effort PATCH (user_last_used_model_config) → SKIPPED (server-side default applies)
//   • Rotated-cookie persistence (onCredentialsRefreshed) → SKIPPED (token still cached in-process)
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { tlsFetch } from "../utils/tlsClient.js";

const CHATGPT_BASE = "https://chatgpt.com";
const SESSION_URL = `${CHATGPT_BASE}/api/auth/session`;
const SENTINEL_PREPARE_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements/prepare`;
const SENTINEL_CR_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements`;
const CONV_URL = PROVIDERS["chatgpt-web"].baseUrl; // https://chatgpt.com/backend-api/f/conversation

const CHATGPT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";
// Captured from a real chatgpt.com session.
const OAI_CLIENT_VERSION = "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029";
const OAI_CLIENT_BUILD_NUMBER = "6128297";

function errorResponse(status, message, code) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", ...(code ? { code } : {}) } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// User-facing HTTP error messages (ported from chatgptWebErrors.ts).
function describeChatGptWebHttpError(status) {
  const map = {
    401: "ChatGPT auth failed — session may have expired. Re-paste your __Secure-next-auth.session-token.",
    403: "ChatGPT auth failed — session may have expired, or Sentinel blocked the request. Re-paste your __Secure-next-auth.session-token.",
    404: "ChatGPT returned 404 — usually the model is no longer available on this account or the chat-requirements-token expired. Retry starts a fresh conversation.",
    413: "ChatGPT returned 413 — the request payload is too large. Reduce the context or trim the conversation.",
    429: "ChatGPT rate limited. Wait a moment and retry.",
  };
  return map[status] ?? `ChatGPT returned HTTP ${status}`;
}

// ─── Cookie → device id ─────────────────────────────────────────────────────
// Stable per-cookie device id (mirrors OmniRoute): derive a UUID-v4-shaped string from a SHA-256
// of the cookie so each connection gets its own device id that doesn't change between requests.
const deviceIdCache = new Map();
function cookieKey(cookie) {
  return createHash("sha256").update(cookie).digest("hex").slice(0, 16); // cache key only
}
function deviceIdFor(cookie) {
  const key = cookieKey(cookie);
  let id = deviceIdCache.get(key);
  if (!id) {
    const h = createHash("sha256").update(cookie).digest("hex");
    id =
      `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-` +
      `${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-` +
      h.slice(20, 32);
    if (deviceIdCache.size >= 200) {
      const first = deviceIdCache.keys().next().value;
      if (first) deviceIdCache.delete(first);
    }
    deviceIdCache.set(key, id);
  }
  return id;
}

// ─── Model id → chatgpt.com slug ────────────────────────────────────────────
const MODEL_MAP = {
  // chatgpt.com backend slugs (also accepted directly).
  "gpt-5-5-pro": "gpt-5-5-pro",
  "gpt-5-5-pro-extended": "gpt-5-5-pro",
  "gpt-5-5-thinking": "gpt-5-5-thinking",
  "gpt-5-5": "gpt-5-5",
  "gpt-5-4-pro": "gpt-5-4-pro",
  "gpt-5-4-thinking": "gpt-5-4-thinking",
  "gpt-5-4-t-mini": "gpt-5-4-t-mini",
  "gpt-5-3": "gpt-5-3",
  "gpt-5-3-mini": "gpt-5-3-mini",
  // Public dot-form ids exposed by the provider catalog.
  "gpt-5.5-pro": "gpt-5-5-pro",
  "gpt-5.5-pro-extended": "gpt-5-5-pro",
  "gpt-5.5-thinking": "gpt-5-5-thinking",
  "gpt-5.5": "gpt-5-5",
  "gpt-5.4-pro": "gpt-5-4-pro",
  "gpt-5.4-thinking": "gpt-5-4-thinking",
  "gpt-5.4-thinking-mini": "gpt-5-4-t-mini",
  "gpt-5.3-instant": "gpt-5-3-instant",
  "gpt-5.3": "gpt-5-3",
  "gpt-5.3-mini": "gpt-5-3-mini",
  o3: "o3",
};

// ─── Browser-like default headers ───────────────────────────────────────────
function browserHeaders() {
  return {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Origin: CHATGPT_BASE,
    Pragma: "no-cache",
    Referer: `${CHATGPT_BASE}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": CHATGPT_USER_AGENT,
  };
}
function oaiHeaders(sessionId, deviceId) {
  return {
    "OAI-Language": "en-US",
    "OAI-Device-Id": deviceId,
    "OAI-Client-Version": OAI_CLIENT_VERSION,
    "OAI-Client-Build-Number": OAI_CLIENT_BUILD_NUMBER,
    "OAI-Session-Id": sessionId,
  };
}

// Build the Cookie header value from whatever the user pasted (bare value, unchunked, chunked,
// or the full "Cookie: ..." DevTools line).
function buildSessionCookieHeader(rawInput) {
  let s = String(rawInput || "").trim();
  s = s.replace(/^cookie\s*:\s*/i, "");
  if (/__Secure-next-auth\.session-token(?:\.\d+)?\s*=/.test(s)) return s;
  return `__Secure-next-auth.session-token=${s}`;
}

function randomHex(n) {
  return randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
}

// ─── /api/auth/session — exchange cookie for JWT (cached ~5min) ──────────────
const TOKEN_TTL_MS = 5 * 60 * 1000;
const tokenCache = new Map(); // cookieKey → { accessToken, accountId, expiresAt }
function tokenLookup(cookie) {
  const entry = tokenCache.get(cookieKey(cookie));
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    tokenCache.delete(cookieKey(cookie));
    return null;
  }
  return entry;
}
function tokenStore(cookie, entry) {
  if (tokenCache.size >= 200 && !tokenCache.has(cookieKey(cookie))) {
    const first = tokenCache.keys().next().value;
    if (first) tokenCache.delete(first);
  }
  tokenCache.set(cookieKey(cookie), entry);
}

class SessionAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionAuthError";
  }
}
class SentinelBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "SentinelBlockedError";
  }
}

async function exchangeSession(cookie, signal, proxyOptions) {
  const cached = tokenLookup(cookie);
  if (cached) return cached;

  const headers = {
    ...browserHeaders(),
    Accept: "application/json",
    Cookie: buildSessionCookieHeader(cookie),
  };
  const response = await tlsFetch(
    SESSION_URL,
    { method: "GET", headers, signal },
    proxyOptions
  );
  if (response.status === 401 || response.status === 403) {
    throw new SessionAuthError("Invalid session cookie");
  }
  if (response.status >= 400) {
    throw new Error(`Session exchange failed (HTTP ${response.status})`);
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* empty body or non-JSON */
  }
  if (!data.accessToken) {
    throw new SessionAuthError("Session response missing accessToken — cookie likely expired");
  }
  const expiresAt = data.expires ? new Date(data.expires).getTime() : Date.now() + TOKEN_TTL_MS;
  const entry = {
    accessToken: data.accessToken,
    accountId: data.user?.id ?? null,
    expiresAt: Math.min(expiresAt, Date.now() + TOKEN_TTL_MS),
  };
  tokenStore(cookie, entry);
  return entry;
}

// ─── DPL / script-src scrape (warmup) ───────────────────────────────────────
// Sentinel's prekey check inspects whether config[5]/config[6] reference a real chatgpt.com
// deployment (DPL hash + a script URL from the HTML). GET / once to scrape these.
let dplCache = null;
const DPL_TTL_MS = 60 * 60 * 1000;
async function fetchDpl(cookie, signal, proxyOptions) {
  if (dplCache && Date.now() < dplCache.expiresAt) {
    return { dpl: dplCache.dpl, scriptSrc: dplCache.scriptSrc };
  }
  const headers = {
    ...browserHeaders(),
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    Cookie: buildSessionCookieHeader(cookie),
  };
  const response = await tlsFetch(`${CHATGPT_BASE}/`, { method: "GET", headers, signal }, proxyOptions);
  const html = await response.text().catch(() => "");
  const dplMatch = html.match(/data-build="([^"]+)"/);
  const dpl = dplMatch ? `dpl=${dplMatch[1]}` : `dpl=${OAI_CLIENT_VERSION.replace(/^prod-/, "")}`;
  const scriptMatch = html.match(/<script[^>]+src="(https?:\/\/[^"]*\.js[^"]*)"/);
  const scriptSrc = scriptMatch?.[1] ?? `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomHex(16)}.js`;
  dplCache = { dpl, scriptSrc, expiresAt: Date.now() + DPL_TTL_MS };
  return { dpl, scriptSrc };
}

// ─── Browser fingerprint key lists (prekey config[10..12]) ──────────────────
// Chosen to look like real navigator/document/window inspection. The unicode MINUS SIGN (U+2212)
// matches what Object.toString() produces in real browsers — Sentinel checks for it.
const NAVIGATOR_KEYS = ["webdriver−false", "geolocation", "languages", "language", "platform", "userAgent", "vendor", "hardwareConcurrency", "deviceMemory", "permissions", "plugins", "mediaDevices"];
const DOCUMENT_KEYS = ["_reactListeningkfj3eavmks", "_reactListeningo743lnnpvdg", "location", "scrollingElement", "documentElement"];
const WINDOW_KEYS = ["webpackChunk_N_E", "__NEXT_DATA__", "chrome", "history", "screen", "navigation", "scrollX", "scrollY"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPrekeyConfig(userAgent, dpl, scriptSrc) {
  const screenSizes = [3000, 4000, 3120, 4160];
  const cores = [8, 16, 24, 32];
  const dateStr = new Date().toString();
  const perfNow = (typeof performance !== "undefined" && performance.now) ? performance.now() : Math.floor(Math.random() * 1000);
  const epochOffset = Date.now() - perfNow;
  return [
    pick(screenSizes), dateStr, 4294705152, 0 /* mutated by solver */, userAgent, scriptSrc, dpl,
    "en-US", "en-US,en", 0 /* mutated by solver */, pick(NAVIGATOR_KEYS), pick(DOCUMENT_KEYS), pick(WINDOW_KEYS),
    perfNow, randomUUID(), "", pick(cores), epochOffset,
  ];
}

// ─── Proof-of-work solver ───────────────────────────────────────────────────
// Mimics openai-sentinel / chat2api: base64-encode a JSON config, mutate config[3] in a SHA3-512
// hash loop until the hex-prefix is ≤ the difficulty target. Returns "<prefix>" + base64(config).
// Yields to the event loop periodically so a busy server isn't blocked.
const POW_YIELD_EVERY = 1000;
const yieldToEventLoop = () => new Promise((r) => setImmediate(r));

async function solvePow({ config, seed, target, prefix, maxIter, label, log }) {
  const cfg = [...config];
  for (let i = 0; i < maxIter; i++) {
    if (i > 0 && i % POW_YIELD_EVERY === 0) await yieldToEventLoop();
    cfg[3] = i;
    const b64 = Buffer.from(JSON.stringify(cfg)).toString("base64");
    // Node's crypto supports sha3-512 natively (verified), so no pure-JS fallback is needed here.
    const hash = createHash("sha3-512").update(seed + b64).digest("hex");
    if (target && hash.slice(0, target.length) <= target) {
      return `${prefix}${b64}`;
    }
  }
  log?.warn?.("CGPT-WEB", `PoW (${label}) exhausted ${maxIter} iterations vs target=${target || "<empty>"}; submitting unsolved token (Sentinel may reject).`);
  const b64 = Buffer.from(JSON.stringify(cfg)).toString("base64");
  return `${prefix}${b64}`;
}

function buildPrepareToken(config, log) {
  return solvePow({ config, seed: "", target: "0fffff", prefix: "gAAAAAC", maxIter: 100_000, label: "prepare", log });
}
function solveProofOfWork(seed, difficulty, config, log) {
  return solvePow({ config, seed, target: (difficulty || "").toLowerCase(), prefix: "gAAAAAB", maxIter: 500_000, label: "conversation", log });
}

// ─── /backend-api/sentinel/chat-requirements ────────────────────────────────
async function prepareChatRequirements(accessToken, accountId, sessionId, deviceId, cookie, dplInfo, signal, log, proxyOptions) {
  const config = buildPrekeyConfig(CHATGPT_USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
  const prekey = await buildPrepareToken(config, log);

  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(sessionId, deviceId),
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Cookie: buildSessionCookieHeader(cookie),
    Priority: "u=1, i",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;

  // Stage 1: POST /chat-requirements/prepare → { prepare_token, ... }
  const prepResp = await tlsFetch(
    SENTINEL_PREPARE_URL,
    { method: "POST", headers, body: JSON.stringify({ p: prekey }), signal },
    proxyOptions
  );
  if (prepResp.status === 401 || prepResp.status === 403) {
    throw new SentinelBlockedError(`Sentinel /prepare blocked (HTTP ${prepResp.status})`);
  }
  if (prepResp.status >= 400) {
    throw new Error(`Sentinel /prepare failed (HTTP ${prepResp.status})`);
  }
  let prepData = {};
  try { prepData = await prepResp.json(); } catch { /* keep empty */ }
  if (!prepData.prepare_token) return prepData; // pass through; caller handles missing fields

  // Stage 2: POST /chat-requirements with the prepare_token → real chat-requirements token.
  const crBody = { p: prekey, prepare_token: prepData.prepare_token };
  const crResp = await tlsFetch(
    SENTINEL_CR_URL,
    { method: "POST", headers, body: JSON.stringify(crBody), signal },
    proxyOptions
  );
  if (crResp.status === 401 || crResp.status === 403) {
    throw new SentinelBlockedError(`Sentinel /chat-requirements blocked (HTTP ${crResp.status})`);
  }
  if (crResp.status >= 400) return prepData; // some accounts may not need stage 2
  try {
    const crData = await crResp.json();
    return { ...crData, prepare_token: prepData.prepare_token };
  } catch {
    return prepData;
  }
}

// ─── OpenAI → ChatGPT message translation ───────────────────────────────────
function parseOpenAIMessages(messages) {
  let systemMsg = "";
  const history = [];
  for (const msg of (Array.isArray(messages) ? messages : [])) {
    let role = String(msg?.role || "user");
    if (role === "developer") role = "system";
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.filter((c) => c?.type === "text").map((c) => String(c.text || "")).join(" ");
    }
    content = String(content || "").trim();
    if (!content) continue;
    if (role === "system") {
      systemMsg += (systemMsg ? "\n" : "") + content;
    } else if (role === "user" || role === "assistant") {
      history.push({ role, content });
    }
  }
  let currentMsg = "";
  if (history.length > 0 && history[history.length - 1].role === "user") {
    currentMsg = history.pop().content;
  }
  return { systemMsg, history, currentMsg };
}

// Build the conversation body. CRITICAL: do NOT send prior turns as separate assistant/user
// messages — ChatGPT's "action: next" would treat them as in-progress and CONTINUE the prior
// assistant turn. Fold history into the system message; send only the new user turn.
function buildConversationBody(parsed, modelSlug, parentMessageId, thinkingEffort) {
  const systemParts = [];
  if (parsed.systemMsg.trim()) systemParts.push(parsed.systemMsg.trim());
  if (parsed.history.length > 0) {
    const formatted = parsed.history
      .map((h) => `${h.role === "assistant" ? "Assistant" : "User"}: ${h.content}`)
      .join("\n\n");
    systemParts.push(`Prior conversation (for context — answer only the new user message below):\n\n${formatted}`);
  }
  const messages = [];
  if (systemParts.length > 0) {
    messages.push({
      id: randomUUID(),
      author: { role: "system" },
      content: { content_type: "text", parts: [systemParts.join("\n\n")] },
    });
  }
  messages.push({
    id: randomUUID(),
    author: { role: "user" },
    content: { content_type: "text", parts: [parsed.currentMsg || ""] },
  });
  return {
    action: "next",
    messages,
    model: modelSlug,
    conversation_id: null,
    parent_message_id: parentMessageId,
    timezone_offset_min: -new Date().getTimezoneOffset(),
    // Temporary Chat keeps API-style text requests out of the user's chatgpt.com history.
    history_and_training_disabled: true,
    suggestions: [],
    websocket_request_id: randomUUID(),
    conversation_mode: { kind: "primary_assistant" },
    supports_buffering: true,
    force_parallel_switch: "auto",
    paragen_cot_summary_display_override: "allow",
    ...(thinkingEffort ? { thinking_effort: thinkingEffort } : {}),
  };
}

// ─── ChatGPT SSE parsing ────────────────────────────────────────────────────
// Read a standard SSE byte stream into discrete event objects. Handles multi-line data: payloads
// and event: names. Yields null for empty/parse-failed frames.
async function* readChatGptSseEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  let eventName = null;

  const flush = () => {
    if (dataLines.length === 0) { eventName = null; return null; }
    const payload = dataLines.join("\n");
    dataLines = [];
    const sseEventName = eventName;
    eventName = null;
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return "done";
    try {
      const parsed = JSON.parse(trimmed);
      if (sseEventName && !parsed.type) parsed.type = sseEventName;
      return parsed;
    } catch {
      return null;
    }
  };

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line === "") {
          const parsed = flush();
          if (parsed === "done") return;
          if (parsed) yield parsed;
          continue;
        }
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().startsWith("data:")) {
      dataLines.push(buffer.trim().slice(5).trimStart());
    }
    const tail = flush();
    if (tail && tail !== "done") yield tail;
  } finally {
    reader.releaseLock();
  }
}

// Content extraction. ChatGPT SSE chunks carry CUMULATIVE content (full text so far in parts[0]),
// not deltas. Diff against emitted length to produce incremental tokens. Suppress echoed prior
// assistant turns by only emitting after status === "in_progress" (with an end-of-stream fallback).
async function* extractContent(eventStream, signal) {
  let conversationId = null;
  let currentId = null;
  let currentParts = "";
  let emittedLen = 0;
  let isLive = false;

  for await (const event of readChatGptSseEvents(eventStream, signal)) {
    if (event.error) {
      const msg = typeof event.error === "string" ? event.error : (event.error.message || "ChatGPT stream error");
      yield { error: msg, done: true };
      return;
    }
    if (event.conversation_id) conversationId = event.conversation_id;

    const m = event.message;
    if (!m) continue;
    if (m.author?.role !== "assistant") continue;

    const id = m.id ?? null;
    const status = m.status ?? "";
    if (id && id !== currentId) {
      currentId = id;
      currentParts = "";
      emittedLen = 0;
      isLive = false;
    }
    if (status === "in_progress") isLive = true;

    const parts = m.content?.parts ?? [];
    if (parts.length === 0) continue;
    const cumulative = parts.map((p) => (typeof p === "string" ? p : "")).join("");
    if (cumulative.length > currentParts.length) currentParts = cumulative;

    if (isLive && currentParts.length > emittedLen) {
      const delta = currentParts.slice(emittedLen);
      emittedLen = currentParts.length;
      yield { delta, answer: currentParts, conversationId: conversationId ?? undefined, messageId: currentId ?? undefined };
    }
  }

  // Fallback: single-event reply (cached/instant) never goes through in_progress — emit now.
  if (!isLive && currentParts.length > emittedLen) {
    yield { delta: currentParts.slice(emittedLen), answer: currentParts, conversationId: conversationId ?? undefined, messageId: currentId ?? undefined };
  }
  yield { delta: "", answer: currentParts, conversationId: conversationId ?? undefined, messageId: currentId ?? undefined, done: true };
}

// Strip ChatGPT internal entity markup. The browser renders these via JS; for plain text we want
// the human-readable form: entity["city","Paris","capital of France"] → Paris
const ENTITY_RE = /entity\["[^"]*","([^"]*)"[^\]]*\]/g;
function cleanChatGptText(text) {
  return text.replace(ENTITY_RE, "$1");
}

// Streaming: ChatGPT cumulative SSE → OpenAI chat.completion.chunk SSE.
function buildStreamingResponse(eventStream, model, cid, created, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
            })
          )
        );
        for await (const chunk of extractContent(eventStream, signal)) {
          if (chunk.error) {
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                  choices: [{ index: 0, delta: { content: `[Error: ${chunk.error}]` }, finish_reason: null, logprobs: null }],
                })
              )
            );
            break;
          }
          if (chunk.done) break;
          if (chunk.delta) {
            const cleaned = cleanChatGptText(chunk.delta);
            if (cleaned) {
              controller.enqueue(
                encoder.encode(
                  sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                    choices: [{ index: 0, delta: { content: cleaned }, finish_reason: null, logprobs: null }],
                  })
                )
              );
            }
          }
        }
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: `[Stream error: ${err?.message || String(err)}]` }, finish_reason: "stop", logprobs: null }],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        try { controller.close(); } catch { /* ok */ }
      }
    },
  });
}

// Non-streaming: aggregate the cumulative SSE into one chat.completion JSON.
async function buildNonStreamingResponse(eventStream, model, cid, created, signal) {
  let fullContent = "";
  let lastAnswer = "";
  for await (const chunk of extractContent(eventStream, signal)) {
    if (chunk.error) {
      return errorResponse(502, chunk.error, "CGPT_ERROR");
    }
    if (chunk.done) break;
    if (chunk.answer) lastAnswer = chunk.answer;
    if (chunk.delta) fullContent += cleanChatGptText(chunk.delta);
  }
  // Prefer the final cumulative answer when available (guards against any delta-cleaning mismatch).
  const content = lastAnswer ? cleanChatGptText(lastAnswer) : fullContent;
  const completionTokens = Math.ceil(content.length / 4);
  return new Response(
    JSON.stringify({
      id: cid, object: "chat.completion", created, model, system_fingerprint: null,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 0, completion_tokens: completionTokens, total_tokens: completionTokens },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export class ChatGptWebExecutor extends BaseExecutor {
  constructor() {
    super("chatgpt-web", PROVIDERS["chatgpt-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { response: errorResponse(400, "Missing or empty messages array"), url: CONV_URL, headers: {}, transformedBody: body };
    }
    if (!credentials?.apiKey) {
      return {
        response: errorResponse(401, "ChatGPT auth failed — paste your __Secure-next-auth.session-token cookie value.", "AUTH"),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }
    const cookie = credentials.apiKey;

    // 1. Token exchange (cookie → JWT, cached).
    let tokenEntry;
    try {
      tokenEntry = await exchangeSession(cookie, signal, proxyOptions);
    } catch (err) {
      if (err instanceof SessionAuthError) {
        log?.warn?.("CGPT-WEB", err.message);
        return {
          response: errorResponse(401, "ChatGPT auth failed — re-paste your __Secure-next-auth.session-token cookie from chatgpt.com.", "HTTP_401"),
          url: SESSION_URL, headers: {}, transformedBody: body,
        };
      }
      log?.error?.("CGPT-WEB", `Session exchange failed: ${err?.message || String(err)}`);
      return {
        response: errorResponse(502, `ChatGPT session exchange failed: ${err?.message || String(err)}`),
        url: SESSION_URL, headers: {}, transformedBody: body,
      };
    }

    // 2a. DPL warmup — scrape data-build + script src so the prekey config looks legit.
    let dplInfo;
    try {
      dplInfo = await fetchDpl(cookie, signal, proxyOptions);
    } catch (err) {
      log?.warn?.("CGPT-WEB", `DPL warmup failed (continuing with fallback): ${err?.message || String(err)}`);
      dplInfo = {
        dpl: `dpl=${OAI_CLIENT_VERSION.replace(/^prod-/, "")}`,
        scriptSrc: `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomHex(16)}.js`,
      };
    }

    const sessionId = randomUUID();
    const deviceId = deviceIdFor(cookie);
    const modelSlug = MODEL_MAP[model] ?? model;

    // 2b. Sentinel chat-requirements (prepare + cr).
    let reqs;
    try {
      reqs = await prepareChatRequirements(
        tokenEntry.accessToken, tokenEntry.accountId, sessionId, deviceId,
        cookie, dplInfo, signal, log, proxyOptions
      );
    } catch (err) {
      if (err instanceof SentinelBlockedError) {
        log?.warn?.("CGPT-WEB", err.message);
        return {
          response: errorResponse(403, "ChatGPT blocked the request (Sentinel/Turnstile required). Without TLS impersonation ExtremeRouter cannot pass this — use the official 'openai' provider.", "SENTINEL_BLOCKED"),
          url: SENTINEL_PREPARE_URL, headers: {}, transformedBody: body,
        };
      }
      log?.error?.("CGPT-WEB", `Sentinel failed: ${err?.message || String(err)}`);
      return {
        response: errorResponse(502, `ChatGPT sentinel failed: ${err?.message || String(err)}`),
        url: SENTINEL_PREPARE_URL, headers: {}, transformedBody: body,
      };
    }
    log?.debug?.("CGPT-WEB", `sentinel: token=${reqs.token ? "y" : "n"} pow=${reqs.proofofwork?.required ? "y" : "n"} turnstile=${reqs.turnstile?.required ? "y" : "n"}`);

    // 3. Solve PoW (if required) with the server-provided seed + difficulty.
    let proofToken = null;
    if (reqs.proofofwork?.required && reqs.proofofwork.seed && reqs.proofofwork.difficulty) {
      const powConfig = buildPrekeyConfig(CHATGPT_USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
      proofToken = await solveProofOfWork(reqs.proofofwork.seed, reqs.proofofwork.difficulty, powConfig, log);
    }

    // 4. Build conversation request.
    const parsed = parseOpenAIMessages(messages);
    if (!parsed.currentMsg.trim() && parsed.history.length === 0) {
      return { response: errorResponse(400, "Empty user message"), url: CONV_URL, headers: {}, transformedBody: body };
    }
    const parentMessageId = randomUUID();
    const cgptBody = buildConversationBody(parsed, modelSlug, parentMessageId, null);

    const headers = {
      ...browserHeaders(),
      ...oaiHeaders(sessionId, deviceId),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${tokenEntry.accessToken}`,
      Cookie: buildSessionCookieHeader(cookie),
    };
    if (tokenEntry.accountId) headers["chatgpt-account-id"] = tokenEntry.accountId;
    if (reqs.token) headers["openai-sentinel-chat-requirements-token"] = reqs.token;
    if (reqs.prepare_token) headers["openai-sentinel-chat-requirements-prepare-token"] = reqs.prepare_token;
    if (proofToken) headers["openai-sentinel-proof-token"] = proofToken;

    log?.info?.("CGPT-WEB", `Conversation request → ${modelSlug} (pow=${!!proofToken}) — ⚠️ likely 403 without TLS impersonation.`);

    let response;
    try {
      response = await tlsFetch(
        CONV_URL,
        { method: "POST", headers, body: JSON.stringify(cgptBody), signal },
        proxyOptions
      );
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      log?.error?.("CGPT-WEB", `Fetch failed: ${err?.message || String(err)}`);
      return {
        response: errorResponse(502, `ChatGPT connection failed: ${err?.message || String(err)}`),
        url: CONV_URL, headers, transformedBody: cgptBody,
      };
    }

    if (response.status >= 400) {
      const status = response.status;
      let detail = "";
      try { detail = (await response.text()).slice(0, 400); } catch { /* ignore */ }
      log?.warn?.("CGPT-WEB", `conv ${status}: ${detail.replace(/\s+/g, " ")}`);
      if (status === 401 || status === 403) tokenCache.delete(cookieKey(cookie));
      return {
        response: errorResponse(status, describeChatGptWebHttpError(status), `HTTP_${status}`),
        url: CONV_URL, headers, transformedBody: cgptBody,
      };
    }

    if (!response.body) {
      return { response: errorResponse(502, "ChatGPT returned empty response body"), url: CONV_URL, headers, transformedBody: cgptBody };
    }

    const cid = `chatcmpl-cgpt-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, signal);
    }
    return { response: finalResponse, url: CONV_URL, headers, transformedBody: cgptBody };
  }
}

export default ChatGptWebExecutor;
