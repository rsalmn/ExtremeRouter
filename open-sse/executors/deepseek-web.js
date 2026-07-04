import { createHash } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// DeepSeek Web (chat.deepseek.com) reverse adapter.
//
// chat.deepseek.com's consumer web API only accepts {prompt, ref_file_ids,
// thinking_enabled, search_enabled} — no OpenAI messages array, no native tools. This executor:
//   1. Exchanges the user's `userToken` (localStorage) for a short-lived access token via
//      /api/v0/users/current.
//   2. Creates a fresh chat session per request.
//   3. Solves a proof-of-work (DeepSeekHashV1 = SHA3-256) challenge and POSTs to
//      /api/v0/chat/completion.
//   4. Translates the DeepSeek delta SSE into OpenAI chat.completion.chunk frames.
//   5. Deletes the chat session afterwards.
//
// Ported from OmniRoute open-sse/executors/deepseek-web.ts. Tool/function-calling is intentionally
// skipped (ExtremeRouter web-cookie providers don't need tools) — plain text chat only.
//
// Proof-of-work: DeepSeek uses "DeepSeekHashV1" which is plain SHA3-256. The original OmniRoute
// impl shipped a WASM solver (~50-100ms) with a slow JS fallback (~5-6s). Here we use node:crypto's
// native sha3-256, which is fast and available server-side. Verified the copy().update() chain
// produces the same digest as hashing prefix+nonce directly.

const CFG = PROVIDERS["deepseek-web"];
// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at CFG.baseUrl (not CFG.transport.baseUrl). See grok-web / chatglm-cn executors.
const DEEPSEEK_WEB_BASE = CFG.baseUrl; // https://chat.deepseek.com
const DEEPSEEK_API_BASE = `${DEEPSEEK_WEB_BASE}/api`;
const COMPLETION_URL = `${DEEPSEEK_API_BASE}/v0/chat/completion`;
const USERS_CURRENT_URL = `${DEEPSEEK_API_BASE}/v0/users/current`;
const CHAT_SESSION_CREATE_URL = `${DEEPSEEK_API_BASE}/v0/chat_session/create`;
const CHAT_SESSION_DELETE_URL = `${DEEPSEEK_API_BASE}/v0/chat_session/delete`;
const POW_CHALLENGE_URL = `${DEEPSEEK_API_BASE}/v0/chat/create_pow_challenge`;

const FAKE_HEADERS = {
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: DEEPSEEK_WEB_BASE,
  Referer: `${DEEPSEEK_WEB_BASE}/`,
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "X-App-Version": "20241129.1",
  "X-Client-Locale": "en-US",
  "X-Client-Platform": "web",
  "X-Client-Version": "1.8.0",
};

// In-process caches (survive hot-reload via global). Keyed by userToken.
const TOKEN_CACHE = (global._deepseekWebTokenCache ??= new Map()); // userToken → { accessToken, expiresAt }
const CACHE_MAX_SIZE = 100;

function evictOldest(cache) {
  if (cache.size >= CACHE_MAX_SIZE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

// ── Credential helper ───────────────────────────────────────────────────

// Extract the userToken from whatever the user pasted. Handles JSON-wrapped tokens
// (DeepSeek stores the token as {"value":"..."}) and bare values.
export function extractUserToken(credentials) {
  const raw = credentials?.apiKey || credentials?.accessToken;
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.value === "string") return parsed.value;
  } catch {
    // not JSON, use raw
  }
  return raw;
}

function errorResponse(status, message, dsCode) {
  return new Response(
    JSON.stringify({
      error: { message, type: "upstream_error", code: dsCode ?? `HTTP_${status}` },
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// ── Fake cookie (anti-bot) ──────────────────────────────────────────────

function generateFakeCookie() {
  const ts = Date.now();
  const hex = (n) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const uid = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  return `intercom-HWWAFSESTIME=${ts}; HWWAFSESID=${hex(18)}; Hm_lvt_${uid()}=${Math.floor(
    ts / 1000
  )}; _frid=${uid()}`;
}

// ── Model options ───────────────────────────────────────────────────────

function resolveModelOptions(model, bodyObj) {
  const m = String(model || "").toLowerCase();
  const modelType = m.includes("pro") || m.includes("expert") ? "expert" : "default";
  const thinkingEnabled =
    m.includes("r1") ||
    m.includes("think") ||
    m.includes("reason") ||
    bodyObj?.thinking_enabled === true ||
    bodyObj?.thinking === true ||
    !!bodyObj?.reasoning_effort;
  const searchEnabled =
    m.includes("search") ||
    bodyObj?.search_enabled === true ||
    bodyObj?.search === true ||
    bodyObj?.web_search === true;
  return { modelType, thinkingEnabled, searchEnabled };
}

// ── PoW solver (DeepSeekHashV1 = SHA3-256) ──────────────────────────────
//
// Algorithm: find nonce in [0, difficulty) such that
//   sha3-256(prefix + String(nonce)) === challenge
// where prefix = `${salt}_${expireAt}_`.
//
// Uses node:crypto's native sha3-256 (fast). Mirrors the OmniRoute JS solver: keep a base hash of
// the prefix and `.copy().update(nonce)` per attempt to avoid re-hashing the prefix each iteration.

function solvePowWithNodeCrypto(challenge, prefix, difficulty) {
  const baseHash = createHash("sha3-256").update(prefix);
  for (let nonce = 0; nonce < difficulty; nonce++) {
    if (baseHash.copy().update(String(nonce)).digest("hex") === challenge) {
      return nonce;
    }
  }
  return -1;
}

async function solvePow(challenge, signal) {
  // algorithm is always "DeepSeekHashV1" (validated server-side); we don't branch on it here.
  const prefix = `${challenge.salt}_${challenge.expire_at}_`;
  let answer = solvePowWithNodeCrypto(challenge.challenge, prefix, challenge.difficulty);
  if (answer < 0) throw new Error("PoW solver failed (no answer found within difficulty)");
  if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
  return Buffer.from(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: challenge.target_path,
    })
  ).toString("base64");
}

// ── DeepSeek API calls ──────────────────────────────────────────────────

async function acquireAccessToken(userToken, proxyOptions, signal, log) {
  const cached = TOKEN_CACHE.get(userToken);
  if (cached && cached.expiresAt > Math.floor(Date.now() / 1000)) {
    return cached.accessToken;
  }

  log?.info?.("DEEPSEEK-WEB", "Acquiring access token from /users/current...");
  const resp = await proxyAwareFetch(
    USERS_CURRENT_URL,
    {
      headers: { Authorization: `Bearer ${userToken}`, ...FAKE_HEADERS },
      signal,
    },
    proxyOptions
  );

  if (resp.status === 401 || resp.status === 403) {
    throw new Error(
      "Token invalid or expired — get a new userToken from DeepSeek localStorage"
    );
  }
  if (!resp.ok) {
    throw new Error(`users/current HTTP ${resp.status}`);
  }

  const json = await resp.json();
  if (json?.code && json.code !== 0) {
    const errMsg = json.msg || json?.data?.biz_msg || `error code ${json.code}`;
    TOKEN_CACHE.delete(userToken);
    throw new Error(`DeepSeek rejected token: ${errMsg}`);
  }
  const bizData = json?.data?.biz_data || json?.biz_data;
  if (!bizData?.token) {
    const errMsg = json?.msg || json?.data?.biz_msg || "Unknown error";
    throw new Error(`Failed to acquire token: ${errMsg}`);
  }

  const accessToken = bizData.token;
  evictOldest(TOKEN_CACHE);
  TOKEN_CACHE.set(userToken, {
    accessToken,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  log?.info?.("DEEPSEEK-WEB", `Access token acquired (${accessToken.length} chars)`);
  return accessToken;
}

function parseDeepSeekErrorPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const codeRaw = payload.code;
  const code = typeof codeRaw === "number" ? codeRaw : undefined;
  const msg = payload.msg;
  const data = payload.data;
  const bizMsg = data?.biz_msg;
  const messageRaw =
    typeof msg === "string" ? msg : typeof bizMsg === "string" ? bizMsg : "";
  if (code !== undefined && code !== 0) {
    return { code, message: messageRaw || `DeepSeek error ${code}` };
  }
  return null;
}

async function createSession(accessToken, proxyOptions, signal) {
  const resp = await proxyAwareFetch(
    CHAT_SESSION_CREATE_URL,
    {
      method: "POST",
      headers: {
        ...FAKE_HEADERS,
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        Cookie: generateFakeCookie(),
      },
      body: JSON.stringify({}),
      signal,
    },
    proxyOptions
  );

  if (!resp.ok) throw new Error(`chat_session/create HTTP ${resp.status}`);
  const json = await resp.json();
  const bizData = json?.data?.biz_data || json?.biz_data;
  const id = bizData?.chat_session?.id;
  if (!id) throw new Error(`No session id: code=${json?.code}`);
  return id;
}

async function deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions) {
  try {
    await proxyAwareFetch(
      CHAT_SESSION_DELETE_URL,
      {
        method: "POST",
        headers: {
          ...FAKE_HEADERS,
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ chat_session_id: sessionId }),
      },
      proxyOptions
    );
  } catch {
    // best-effort cleanup
  }
}

async function getPowChallenge(accessToken, proxyOptions, signal) {
  const resp = await proxyAwareFetch(
    POW_CHALLENGE_URL,
    {
      method: "POST",
      headers: {
        ...FAKE_HEADERS,
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ target_path: "/api/v0/chat/completion" }),
      signal,
    },
    proxyOptions
  );
  if (!resp.ok) throw new Error(`create_pow_challenge HTTP ${resp.status}`);
  const json = await resp.json();
  const bizData = json?.data?.biz_data || json?.biz_data;
  if (!bizData?.challenge?.challenge)
    throw new Error(`No PoW challenge: code=${json?.code}`);
  return bizData.challenge;
}

// Wrap a stream so the chat session is deleted after it closes.
function wrapStreamWithCleanup(responseStream, cleanup) {
  const reader = responseStream.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        cleanup().catch(() => {});
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel();
      cleanup().catch(() => {});
    },
  });
}

// ── Prompt builder (DeepSeek native single-prompt format) ───────────────

function extractMessageText(content) {
  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
  }
  return String(content || "");
}

// Build the single prompt string the DeepSeek web API accepts. With historyWindow <= 0 (default)
// we keep the legacy behavior — system prompt(s) + the last user message only.
function messagesToPrompt(messages, historyWindow = 0) {
  if (messages.length === 0) return "";

  const systemParts = [];
  const conversation = [];
  let lastUserContent = "";
  for (const m of messages) {
    const text = extractMessageText(m.content).trim();
    if (m.role === "system") {
      if (text) systemParts.push(text);
    } else if (m.role === "user" || m.role === "assistant") {
      if (text) conversation.push({ role: m.role, text });
      if (m.role === "user") lastUserContent = text;
    }
    // tool/function messages have no native slot in the single-prompt format — skipped (no tools here).
  }

  const parts = [];
  if (systemParts.length > 0) parts.push(systemParts.join("\n\n"));

  if (historyWindow > 0 && conversation.length > 1) {
    const recent = conversation.slice(-historyWindow);
    const transcript = recent
      .map((turn) =>
        turn.role === "assistant" ? `Assistant: ${turn.text}` : `User: ${turn.text}`
      )
      .join("\n\n");
    parts.push(transcript);
  } else if (lastUserContent) {
    parts.push(lastUserContent);
  }

  return parts.join("\n\n").replace(/!\[.*?\]\(.*?\)/g, "");
}

// ── SSE text helpers ────────────────────────────────────────────────────

function isThinkingModel(model) {
  const m = model.toLowerCase();
  return m.includes("think") || m.includes("r1") || m.includes("reason");
}

function isSearchModel(model) {
  const m = model.toLowerCase();
  return m.includes("search") || m.includes("fold");
}

function cleanDeepSeekToken(text) {
  return text
    .replace(/FINISHED/g, "")
    .replace(/^(SEARCH|WEB_SEARCH|SEARCHING)\s*/i, "");
}

function formatStreamContent(raw, model) {
  let text = cleanDeepSeekToken(raw);
  if (!isSearchModel(model)) return text;
  if (model.toLowerCase().includes("search-silent")) {
    return text.replace(/\[citation:(\d+)\]/g, "");
  }
  return text.replace(/\[citation:(\d+)\]/g, "[$1]");
}

function appendSearchCitations(searchResults, model) {
  if (searchResults.length === 0 || model.toLowerCase().includes("search-silent")) {
    return "";
  }
  return searchResults
    .filter((r) => r.cite_index)
    .sort((a, b) => (a.cite_index || 0) - (b.cite_index || 0))
    .map((r) => `[${r.cite_index}]: [${r.title}](${r.url})`)
    .join("\n");
}

// ── Fragment handling (shared by stream + collect) ──────────────────────
//
// DeepSeek SSE frames carry { p, o, v } where p is a path, o an operation, v a value. Fragments
// under "response/fragments" have a type ("THINK" / "ANSWER" / "RESPONSE") and a content string.

function applyFragmentType(frag, currentPathRef) {
  const type = String(frag?.type || "").toUpperCase();
  if (type === "THINK") currentPathRef.value = "thinking";
  else if (type === "ANSWER" || type === "RESPONSE") currentPathRef.value = "content";
}

function makeFragmentHandler(currentPathRef, onText, model) {
  const handleFragment = (frag, setPathFromType = false) => {
    if (setPathFromType) applyFragmentType(frag, currentPathRef);
    if (typeof frag?.content !== "string" || frag.content.length === 0) return;
    if (!setPathFromType) {
      const type = String(frag?.type || "").toUpperCase();
      if (type === "THINK") currentPathRef.value = "thinking";
      else if (type === "ANSWER" || type === "RESPONSE") currentPathRef.value = "content";
    }
    const text = formatStreamContent(frag.content, model);
    if (text) onText(text, currentPathRef.value);
  };
  return handleFragment;
}

// ── SSE → OpenAI streaming transform ────────────────────────────────────

function transformSSE(deepseekStream, model, cleanup, signal) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const streamModel = model || "deepseek-web";
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let emittedRole = false;
  const currentPathRef = { value: "" };
  const thinkingModel = isThinkingModel(streamModel);
  const searchResults = [];
  let finished = false;

  const push = (deltaObj, finishReason = null) =>
    encoder.encode(
      sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model: streamModel,
        choices: [{ index: 0, delta: deltaObj, finish_reason: finishReason }],
      })
    );

  const emitText = (text, path) => {
    if (!text) return;
    if (!emittedRole) {
      emittedRole = true;
      controller.enqueue(push({ role: "assistant", content: "" }));
    }
    let p = path;
    if (!p && thinkingModel) p = "thinking";
    else if (!p && isSearchModel(streamModel)) p = "content";
    if (p === "thinking") {
      controller.enqueue(push({ reasoning_content: text }));
    } else {
      controller.enqueue(push({ content: text }));
    }
  };

  const handleFragment = makeFragmentHandler(
    currentPathRef,
    (text, path) => emitText(text, path),
    streamModel
  );

  let controller;

  const finishStream = () => {
    if (finished) return;
    finished = true;
    const citations = appendSearchCitations(searchResults, streamModel);
    if (citations) {
      if (!emittedRole) {
        emittedRole = true;
        controller.enqueue(push({ role: "assistant", content: "" }));
      }
      controller.enqueue(push({ content: `\n\n${citations}` }));
    }
    if (!emittedRole) {
      emittedRole = true;
      controller.enqueue(push({ role: "assistant", content: "" }));
    }
    controller.enqueue(push({}, "stop"));
    controller.enqueue(encoder.encode(SSE_DONE));
  };

  return new ReadableStream(
    {
      async start(ctrl) {
        controller = ctrl;
        const reader = deepseekStream.getReader();
        let buffer = "";
        try {
          while (true) {
            if (signal?.aborted) {
              finishStream();
              break;
            }
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ") && !line.startsWith("data:")) continue;
              const payload = line.replace(/^data:\s*/, "").trim();

              if (payload === "[DONE]") {
                finishStream();
                break;
              }

              let data;
              try {
                data = JSON.parse(payload);
              } catch {
                continue;
              }

              const p = data?.p;
              const o = data?.o;
              const v = data?.v;

              if (v && typeof v === "object" && v.response) {
                if (v.response.thinking_enabled === true) currentPathRef.value = "thinking";
                else if (v.response.thinking_enabled === false) currentPathRef.value = "content";
                const fragments = v.response.fragments;
                if (Array.isArray(fragments)) {
                  for (const frag of fragments) handleFragment(frag, false);
                }
              }

              if (p === "response/fragments") {
                if (Array.isArray(v)) {
                  for (const frag of v) handleFragment(frag, true);
                } else if (v && typeof v === "object") {
                  handleFragment(v, true);
                }
              }

              if (p === "response" && Array.isArray(v)) {
                for (const entry of v) {
                  if (entry?.p === "response" && entry?.v?.thinking_enabled === true) {
                    currentPathRef.value = "thinking";
                  }
                }
              }

              if (p === "response/search_status") continue;

              if (p === "response/search_results" && Array.isArray(v)) {
                if (o !== "BATCH") {
                  searchResults.length = 0;
                  searchResults.push(...v);
                } else {
                  for (const op of v) {
                    const match = String(op?.p || "").match(/^(\d+)\/cite_index$/);
                    if (match) {
                      const index = parseInt(match[1], 10);
                      if (searchResults[index]) searchResults[index].cite_index = op.v;
                    }
                  }
                }
                continue;
              }

              if (typeof v === "string") {
                emitText(formatStreamContent(v, streamModel), currentPathRef.value);
              } else if (Array.isArray(v) && p === "response") {
                for (const entry of v) {
                  if (Array.isArray(entry?.v)) {
                    const joined = entry.v.map((item) => item?.content || "").join("");
                    if (joined) emitText(formatStreamContent(joined, streamModel), currentPathRef.value);
                  }
                }
              }

              // Do not close on FINISHED — DeepSeek may still send search_results afterward.
              if (p === "response/status" && v === "FINISHED") continue;
            }
          }
          finishStream();
        } catch (err) {
          if (!signal?.aborted) {
            try {
              controller.enqueue(push({ content: `\n[DeepSeek stream error: ${err?.message || String(err)}]` }, "stop"));
              controller.enqueue(encoder.encode(SSE_DONE));
            } catch {
              /* controller already closed */
            }
          } else {
            finishStream();
          }
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          cleanup().catch(() => {});
        }
      },
    },
    { highWaterMark: 16384 }
  );
}

// ── Non-streaming SSE aggregator ────────────────────────────────────────

async function collectSSEContent(deepseekStream, model, signal) {
  const decoder = new TextDecoder();
  const reader = deepseekStream.getReader();
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  const currentPathRef = { value: "" };
  const streamModel = model || "deepseek-web";
  const thinkingModel = isThinkingModel(streamModel);
  const searchResults = [];

  const appendByPath = (text, path) => {
    if (!text) return;
    let p = path;
    if (!p && thinkingModel) p = "thinking";
    else if (!p && isSearchModel(streamModel)) p = "content";
    if (p === "thinking") reasoningContent += text;
    else content += text;
  };

  const handleFragment = makeFragmentHandler(currentPathRef, appendByPath, streamModel);

  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ") && !line.startsWith("data:")) continue;
      const payload = line.replace(/^data:\s*/, "").trim();
      try {
        const data = JSON.parse(payload);
        const p = data?.p;
        const o = data?.o;
        const v = data?.v;

        if (v && typeof v === "object" && v.response) {
          if (v.response.thinking_enabled === true) currentPathRef.value = "thinking";
          else if (v.response.thinking_enabled === false) currentPathRef.value = "content";
          if (Array.isArray(v.response.fragments)) {
            for (const frag of v.response.fragments) handleFragment(frag, false);
          }
        }

        if (p === "response/fragments") {
          if (Array.isArray(v)) {
            for (const frag of v) handleFragment(frag, true);
          } else if (v && typeof v === "object") {
            handleFragment(v, true);
          }
        }

        if (p === "response" && Array.isArray(v)) {
          for (const entry of v) {
            if (entry?.p === "response" && entry?.v?.thinking_enabled === true) {
              currentPathRef.value = "thinking";
            }
          }
        }

        if (p === "response/search_status") continue;

        if (p === "response/search_results" && Array.isArray(v)) {
          if (o !== "BATCH") {
            searchResults.length = 0;
            searchResults.push(...v);
          } else {
            for (const op of v) {
              const match = String(op?.p || "").match(/^(\d+)\/cite_index$/);
              if (match) {
                const index = parseInt(match[1], 10);
                if (searchResults[index]) searchResults[index].cite_index = op.v;
              }
            }
          }
          continue;
        }

        if (typeof v === "string") {
          appendByPath(formatStreamContent(v, streamModel), currentPathRef.value);
        } else if (Array.isArray(v) && p === "response") {
          for (const entry of v) {
            if (Array.isArray(entry?.v)) {
              const joined = entry.v.map((item) => item?.content || "").join("");
              if (joined) appendByPath(formatStreamContent(joined, streamModel), currentPathRef.value);
            }
          }
        }
      } catch {
        // skip
      }
    }
  }

  const citations = appendSearchCitations(searchResults, streamModel);
  if (citations) content += `\n\n${citations}`;

  return { content, reasoningContent };
}

// ── Executor ────────────────────────────────────────────────────────────

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor() {
    super("deepseek-web", CFG);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};

    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    if (messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array."),
        url: COMPLETION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const userToken = extractUserToken(credentials);
    if (!userToken) {
      return {
        response: errorResponse(
          400,
          "Invalid credentials: paste your userToken from DeepSeek localStorage " +
            "(DevTools → Application → Local Storage → chat.deepseek.com → userToken)"
        ),
        url: COMPLETION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const { modelType, thinkingEnabled, searchEnabled } = resolveModelOptions(model, bodyObj);

    const psd = credentials?.providerSpecificData || {};
    const historyWindow =
      typeof psd.historyWindow === "number" && psd.historyWindow > 0 ? psd.historyWindow : 0;

    const clientModel =
      typeof model === "string" && model.trim() ? model.trim() : "deepseek-web";

    try {
      let t0 = Date.now();
      const accessToken = await acquireAccessToken(userToken, proxyOptions, signal, log);
      log?.info?.("DEEPSEEK-WEB", `Token acquired in ${Date.now() - t0}ms`);

      const prompt = messagesToPrompt(messages, historyWindow);
      const refFileIds = Array.isArray(bodyObj.ref_file_ids) ? bodyObj.ref_file_ids : [];
      log?.info?.(
        "DEEPSEEK-WEB",
        `model_type=${modelType}, thinking=${thinkingEnabled}, search=${searchEnabled}, files=${refFileIds.length}, stream=${stream !== false}, window=${historyWindow}`
      );

      // One completion attempt against a given session id (fresh PoW per attempt).
      const performCompletion = async (sid) => {
        const powChallenge = await getPowChallenge(accessToken, proxyOptions, signal);
        const powAnswer = await solvePow(powChallenge, signal);
        const reqHeaders = {
          ...FAKE_HEADERS,
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Ds-Pow-Response": powAnswer,
          "X-Client-Timezone-Offset": String(new Date().getTimezoneOffset() * -60),
          Cookie: generateFakeCookie(),
        };
        const requestPayload = {
          chat_session_id: sid,
          parent_message_id: null,
          model_type: modelType,
          prompt,
          ref_file_ids: refFileIds,
          thinking_enabled: thinkingEnabled,
          search_enabled: searchEnabled,
          preempt: false,
        };
        const resp = await proxyAwareFetch(
          COMPLETION_URL,
          {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify(requestPayload),
            signal,
          },
          proxyOptions
        );
        return { resp, reqHeaders, requestPayload };
      };

      t0 = Date.now();
      const sessionId = await createSession(accessToken, proxyOptions, signal);
      log?.info?.("DEEPSEEK-WEB", `Session created in ${Date.now() - t0}ms`);

      t0 = Date.now();
      log?.info?.("DEEPSEEK-WEB", `POST ${COMPLETION_URL}`);
      let { resp, reqHeaders, requestPayload } = await performCompletion(sessionId);
      log?.info?.(
        "DEEPSEEK-WEB",
        `Completion response in ${Date.now() - t0}ms, status=${resp.status}`
      );

      if (!resp.ok) {
        const status = resp.status;
        let errMsg = `DeepSeek API error (${status})`;
        if (status === 401 || status === 403) {
          TOKEN_CACHE.delete(userToken);
          errMsg = "DeepSeek token expired — get a fresh userToken from localStorage.";
        } else if (status === 429) {
          errMsg = "DeepSeek rate limited. Wait and retry.";
        }
        log?.warn?.("DEEPSEEK-WEB", errMsg);

        try {
          const errBody = await resp.json();
          if (errBody?.code && errBody.code !== 0) {
            errMsg = `DeepSeek error ${errBody.code}: ${errBody.msg}`;
          }
        } catch {
          /* ignore */
        }

        deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions).catch(() => {});
        return {
          response: errorResponse(status, errMsg),
          url: COMPLETION_URL,
          headers: reqHeaders,
          transformedBody: requestPayload,
        };
      }

      // Check for HTTP 200 with DeepSeek error JSON.
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        try {
          const json = await resp.json();
          const parsed = parseDeepSeekErrorPayload(json);
          if (parsed) {
            const errMsg = `DeepSeek error ${parsed.code}: ${parsed.message}`;
            log?.warn?.("DEEPSEEK-WEB", errMsg);
            const status =
              parsed.code === 40003 ? 401 : parsed.code === 40002 ? 429 : 502;
            if (parsed.code === 40003) {
              TOKEN_CACHE.delete(userToken);
            }
            deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions).catch(() => {});
            return {
              response: errorResponse(status, errMsg, parsed.code),
              url: COMPLETION_URL,
              headers: reqHeaders,
              transformedBody: requestPayload,
            };
          }
          // Not a DeepSeek error — unexpected JSON body; pass through.
          deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions).catch(() => {});
          return {
            response: new Response(JSON.stringify(json), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
            url: COMPLETION_URL,
            headers: reqHeaders,
            transformedBody: requestPayload,
          };
        } catch {
          /* not JSON, continue */
        }
      }

      // Cleanup the session once the stream is consumed.
      const cleanupFn = () => deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions);

      if (stream !== false) {
        const openaiStream = transformSSE(resp.body, clientModel, cleanupFn, signal);
        const wrappedStream = wrapStreamWithCleanup(openaiStream, () => Promise.resolve());
        return {
          response: new Response(wrappedStream, {
            status: 200,
            headers: { ...SSE_HEADERS_NO_BUFFER },
          }),
          url: COMPLETION_URL,
          headers: reqHeaders,
          transformedBody: requestPayload,
        };
      }

      const { content, reasoningContent } = await collectSSEContent(resp.body, clientModel, signal);
      await cleanupFn();
      const message = { role: "assistant", content };
      if (reasoningContent) message.reasoning_content = reasoningContent;
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model || modelType,
        choices: [{ index: 0, message, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return {
        response: new Response(JSON.stringify(openaiResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url: COMPLETION_URL,
        headers: reqHeaders,
        transformedBody: requestPayload,
      };
    } catch (err) {
      const aborted = err?.name === "AbortError";
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("DEEPSEEK-WEB", `Execute failed: ${msg}`);

      if (aborted) {
        return {
          response: errorResponse(499, "Request cancelled"),
          url: COMPLETION_URL,
          headers: {},
          transformedBody: body,
        };
      }

      return {
        response: errorResponse(502, `DeepSeek error: ${msg}`),
        url: COMPLETION_URL,
        headers: {},
        transformedBody: body,
      };
    }
  }
}

export default DeepSeekWebExecutor;
