// ClaudeWebExecutor — Claude Web (claude.ai) cookie provider.
//
// ── ANTI-BOT REALITY ─────────────────────────────────────────────────────────
// claude.ai is fronted by Cloudflare bot management. OmniRoute bypasses it with native TLS
// impersonation (curl-impersonate via claudeTlsClient) + a Turnstile cf_clearance solver and an
// optional Playwright browser bridge. ExtremeRouter has NONE of those — it uses plain
// `proxyAwareFetch` — so requests will almost always hit a Cloudflare challenge (HTTP 403,
// "Just a moment", cf-mitigated: challenge). When that happens the sessionKey cookie is very
// likely still VALID: the request is rejected for its TLS fingerprint, not bad credentials.
// This is an anti-bot limitation, NOT a code bug. For reliable access use the official 'claude' provider.
//
// Port notes (faithful to OmniRoute logic):
//   • tlsFetchClaude → plain proxyAwareFetch
//   • Turnstile cf_clearance solver → skipped (we pass whatever cf_clearance the user pasted)
//   • browserBackedChat (Playwright) → skipped entirely
//   • normalizeSessionCookieHeader → inlined
//   • sanitizeErrorMessage → inlined
//   • Tool/function-calling → not exposed (plain text chat)
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const CLAUDE_WEB_API_BASE = PROVIDERS["claude-web"].baseUrl; // https://claude.ai/api
const CLAUDE_WEB_ORGS_URL = `${CLAUDE_WEB_API_BASE}/organizations`;
const CLAUDE_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

function errorResponse(status, message, code) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", ...(code ? { code } : {}) } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function sanitizeErrorMessage(raw) {
  if (!raw) return "Unknown error";
  return String(raw)
    .replace(/at\s+.*?\(.*?\)/g, "")
    .replace(/\/[^\s:]+\/[\w.-]+/g, "<path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || "Unknown error";
}

// Read the Claude Web session cookie from credentials. Lookup order (mirrors OmniRoute):
//   1. credentials.cookie  2. credentials.apiKey  3. credentials.providerSpecificData.cookie
function readClaudeWebCookie(credentials) {
  if (!credentials || typeof credentials !== "object") return "";
  const direct = typeof credentials.cookie === "string" ? credentials.cookie : "";
  if (direct.trim()) return direct;
  const apiKey = typeof credentials.apiKey === "string" ? credentials.apiKey : "";
  if (apiKey.trim()) return apiKey;
  const psd = credentials.providerSpecificData;
  if (psd && typeof psd === "object" && typeof psd.cookie === "string" && psd.cookie.trim()) {
    return psd.cookie;
  }
  return "";
}

function readClaudeWebDeviceId(credentials) {
  if (!credentials || typeof credentials !== "object") return undefined;
  if (typeof credentials.deviceId === "string" && credentials.deviceId.trim()) return credentials.deviceId;
  const psd = credentials.providerSpecificData;
  if (psd && typeof psd === "object" && typeof psd.deviceId === "string" && psd.deviceId.trim()) {
    return psd.deviceId;
  }
  return undefined;
}

// Browser-like headers the Claude.ai web client sends.
function getBrowserHeaders(deviceId) {
  const headers = {
    Accept: "text/event-stream",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    Origin: "https://claude.ai",
    Pragma: "no-cache",
    Priority: "u=1, i",
    Referer: "https://claude.ai/new",
    "Sec-Ch-Ua": '"Chromium";v="149", "Not-A.Brand";v="24", "Google Chrome";v="149"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Linux"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": CLAUDE_USER_AGENT,
    "anthropic-client-platform": "web_claude_ai",
  };
  if (deviceId) headers["anthropic-device-id"] = deviceId;
  return headers;
}

// Normalize whatever the user pasted into a usable Cookie header value.
// Accepts a full "Cookie: ..." line, a bare "sessionKey=..." pair, or a bare token value.
function normalizeClaudeSessionCookie(rawValue) {
  let s = String(rawValue || "").trim();
  // Strip a leading "Cookie:" label if present.
  s = s.replace(/^cookie\s*:\s*/i, "");
  // If it already contains a sessionKey pair, pass through verbatim.
  if (/sessionKey\s*=/.test(s)) return s;
  // Bare value (no '=') → wrap as a sessionKey cookie.
  if (!s.includes("=")) return `sessionKey=${s}`;
  return s;
}

function generateMessageUUIDs() {
  return { human_message_uuid: crypto.randomUUID(), assistant_message_uuid: crypto.randomUUID() };
}

function getDefaultTools() {
  return [
    { name: "show_widget", description: "Display interactive widgets and visualizations", input_schema: { type: "object", properties: { widget_type: { type: "string", description: "Type of widget to display" } } }, integration_name: "visualize", is_mcp_app: true },
    { name: "read_me", description: "Read and reference documents", input_schema: { type: "object", properties: { file_path: { type: "string", description: "Path to the file to read" } } }, integration_name: "visualize", is_mcp_app: false },
    { type: "web_search_v0", name: "web_search" },
    { type: "artifacts_v0", name: "artifacts" },
    { type: "repl_v0", name: "repl" },
    { type: "widget", name: "weather_fetch" },
    { type: "widget", name: "recipe_display_v0" },
    { type: "widget", name: "places_map_display_v0" },
    { type: "widget", name: "message_compose_v1" },
    { type: "widget", name: "ask_user_input_v0" },
    { type: "widget", name: "recommend_claude_apps" },
    { type: "widget", name: "places_search" },
    { type: "widget", name: "fetch_sports_data" },
  ];
}

function getDefaultPersonalizedStyle() {
  return [{
    type: "default", key: "Default", name: "Normal", nameKey: "normal_style_name",
    prompt: "Normal\n", summary: "Default responses from Claude", summaryKey: "normal_style_summary", isDefault: true,
  }];
}

// Transform OpenAI messages → the Claude.ai completion payload. Only the last user message is
// used as the prompt (the web UI is single-turn per request).
function transformToClaude(body, model) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  let prompt = "";
  for (const msg of messages) {
    if (msg && typeof msg === "object" && msg.role === "user") {
      prompt = String(msg.content || "");
    }
  }
  if (!prompt.trim()) throw new Error("No user message found in request");
  return {
    prompt,
    model: model || DEFAULT_CLAUDE_MODEL,
    timezone: "Asia/Jakarta",
    personalized_styles: getDefaultPersonalizedStyle(),
    locale: "en-US",
    tools: getDefaultTools(),
    turn_message_uuids: generateMessageUUIDs(),
    attachments: [],
    effort: "low",
    files: [],
    sync_sources: [],
    rendering_mode: "messages",
    thinking_mode: "off",
    create_conversation_params: {
      name: "",
      model: model || DEFAULT_CLAUDE_MODEL,
      include_conversation_preferences: true,
      paprika_mode: null,
      compass_mode: null,
      is_temporary: false,
      enabled_imagine: true,
      tool_search_mode: "auto",
    },
  };
}

// GET /api/organizations → first org's uuid/id. Used to build the completion URL.
async function getOrganizationId(cookieHeader, deviceId, proxyOptions, signal) {
  try {
    const response = await proxyAwareFetch(
      CLAUDE_WEB_ORGS_URL,
      { method: "GET", headers: { ...getBrowserHeaders(deviceId), Cookie: cookieHeader }, signal },
      proxyOptions
    );
    if (response.status !== 200) return null;
    const data = await response.json().catch(() => []);
    return data?.[0]?.uuid || data?.[0]?.id || null;
  } catch {
    return null;
  }
}

// Read Claude Web SSE (Anthropic-style events) and yield incremental text deltas.
// Events of interest: content_block_delta (text), message_delta (stop_reason), message_stop.
async function* extractClaudeContent(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines; process complete lines, keep the tail.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        let parsed;
        try {
          parsed = JSON.parse(trimmed.slice(6));
        } catch {
          continue; // metadata / ping / non-JSON
        }
        if (parsed.type === "content_block_delta") {
          const text = parsed.delta?.text;
          if (text) yield { delta: text };
        } else if (parsed.type === "message_delta") {
          if (parsed.delta?.stop_reason) yield { stopReason: parsed.delta.stop_reason };
        } else if (parsed.type === "message_stop") {
          yield { stopReason: "end_turn", done: true };
          return;
        }
      }
    }
    // Flush trailing buffer.
    const tail = buffer.trim();
    if (tail.startsWith("data: ")) {
      try {
        const parsed = JSON.parse(tail.slice(6));
        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
          yield { delta: parsed.delta.text };
        }
      } catch { /* skip */ }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ok */ }
  }
  yield { done: true };
}

// Streaming: translate Claude SSE → OpenAI chat.completion.chunk SSE.
function buildStreamingResponse(body, model, cid, created, signal) {
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
        let stopReason = null;
        for await (const chunk of extractClaudeContent(body, signal)) {
          if (chunk.delta) {
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                  choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null, logprobs: null }],
                })
              )
            );
          }
          if (chunk.stopReason) stopReason = chunk.stopReason;
          if (chunk.done) break;
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

// Non-streaming: aggregate the Claude SSE into one chat.completion JSON.
async function buildNonStreamingResponse(body, model, cid, created, promptLen, signal) {
  let fullContent = "";
  let stopReason = null;
  for await (const chunk of extractClaudeContent(body, signal)) {
    if (chunk.delta) fullContent += chunk.delta;
    if (chunk.stopReason) stopReason = chunk.stopReason;
    if (chunk.done) break;
  }
  const promptTokens = Math.ceil(promptLen / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);
  return new Response(
    JSON.stringify({
      id: cid, object: "chat.completion", created, model, system_fingerprint: null,
      choices: [{ index: 0, message: { role: "assistant", content: fullContent }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export class ClaudeWebExecutor extends BaseExecutor {
  constructor() {
    super("claude-web", PROVIDERS["claude-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};

    if (!credentials || typeof credentials !== "object") {
      return { response: errorResponse(400, "Invalid credentials", "INVALID_REQUEST"), url: "", headers: {}, transformedBody: bodyObj };
    }

    const rawCookie = readClaudeWebCookie(credentials);
    if (!rawCookie.trim()) {
      return {
        response: errorResponse(401, "Missing session cookie — paste your claude.ai cookies (need sessionKey=).", "AUTH"),
        url: "",
        headers: {},
        transformedBody: bodyObj,
      };
    }
    const cookieHeader = normalizeClaudeSessionCookie(rawCookie);
    const deviceId = readClaudeWebDeviceId(credentials);

    let claudePayload;
    try {
      claudePayload = transformToClaude(bodyObj, model);
    } catch (transformError) {
      return {
        response: errorResponse(400, transformError?.message || "Invalid request format", "INVALID_REQUEST"),
        url: "",
        headers: {},
        transformedBody: bodyObj,
      };
    }

    // Resolve org id (optional — fall back to the /chat_conversations/new/completion endpoint).
    let orgId = credentials.orgId;
    if (!orgId) {
      orgId = await getOrganizationId(cookieHeader, deviceId, proxyOptions, signal);
      if (!orgId) log?.warn?.("CLAUDE-WEB", "Could not retrieve organization ID — using the new-conversation endpoint.");
    }

    const completionUrl = orgId
      ? `${CLAUDE_WEB_API_BASE}/organizations/${orgId}/chat_conversations/new/completion`
      : `${CLAUDE_WEB_API_BASE}/chat_conversations/new/completion`;

    const headers = { ...getBrowserHeaders(deviceId), Cookie: cookieHeader };
    log?.debug?.("CLAUDE-WEB", `POST ${completionUrl} — ⚠️ Cloudflare will likely challenge a plain Node fetch.`);

    let response;
    try {
      response = await proxyAwareFetch(
        completionUrl,
        { method: "POST", headers, body: JSON.stringify(claudePayload), signal },
        proxyOptions
      );
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      log?.error?.("CLAUDE-WEB", `Fetch failed: ${err?.message || String(err)}`);
      return {
        response: errorResponse(502, `Claude Web connection failed: ${sanitizeErrorMessage(err?.message || String(err))}`),
        url: completionUrl,
        headers,
        transformedBody: claudePayload,
      };
    }

    if (response.status < 200 || response.status >= 300) {
      const status = response.status;
      // Drain a small prefix of the body to classify Cloudflare challenges vs real Claude errors.
      let errorText = "";
      try { errorText = (await response.text()).slice(0, 2048); } catch { errorText = ""; }
      const cfMitigated = response.headers.get?.("cf-mitigated");
      const isCloudflareChallenge =
        status === 403 &&
        (cfMitigated === "challenge" || /<title>\s*Just a moment/i.test(errorText) || /<title>\s*Attention Required/i.test(errorText));

      let errorMessage;
      let code;
      if (isCloudflareChallenge) {
        errorMessage =
          "Claude Web returned a Cloudflare bot-management challenge (cf-mitigated=" +
          (cfMitigated ?? "challenge") +
          "). The sandbox/VPS IP appears flagged; the cf_clearance cookie pasted from a residential IP won't pass, and ExtremeRouter has no TLS impersonation to satisfy it. Use the official Anthropic API (provider 'claude') instead.";
        code = "cf_mitigated_challenge";
      } else if (status === 401) {
        errorMessage = "Session expired or invalid — re-paste your claude.ai sessionKey cookie.";
        code = "AUTH";
      } else if (status === 429) {
        errorMessage = "Rate limited by Claude Web API.";
        code = "RATE_LIMIT";
      } else {
        const trimmed = errorText.trim().slice(0, 500);
        errorMessage = trimmed ? `Claude Web API error (${status}): ${trimmed}` : `Claude Web API error (${status}) with no response body`;
        code = `HTTP_${status}`;
      }
      log?.warn?.("CLAUDE-WEB", `HTTP ${status}${isCloudflareChallenge ? " (Cloudflare challenge)" : ""}`);
      return {
        response: errorResponse(status, errorMessage, code),
        url: completionUrl,
        headers,
        transformedBody: claudePayload,
      };
    }

    if (!response.body) {
      return {
        response: errorResponse(502, "Claude Web returned empty response body"),
        url: completionUrl,
        headers,
        transformedBody: claudePayload,
      };
    }

    const cid = `chatcmpl-claude-web-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const promptLen = String(claudePayload.prompt || "").length;

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model || DEFAULT_CLAUDE_MODEL, cid, created, signal);
      finalResponse = new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model || DEFAULT_CLAUDE_MODEL, cid, created, promptLen, signal);
    }
    return { response: finalResponse, url: completionUrl, headers, transformedBody: claudePayload };
  }
}

export default ClaudeWebExecutor;
