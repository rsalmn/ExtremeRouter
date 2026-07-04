// PoeWebExecutor — Multi-model chat via poe.com's GraphQL API (web-cookie provider).
//
// Poe exposes a GraphQL endpoint (POST /api/gql_POST) authenticated by the `p-b` cookie.
// We send a `chatWithBot` query addressed to a bot handle derived from the requested model
// id, then translate the JSON result into an OpenAI chat.completion (non-streaming) or a
// single OpenAI chat.completion.chunk frame (streaming — Poe's REST is non-SSE, so we emit
// the whole response as one chunk).
//
// Auth: `p-b` cookie from poe.com (pasted into the apiKey credential field). Accepts either
// the bare p-b value or a full Cookie header; we extract `p-b` from either.
//
// Ported from OmniRoute's open-sse/executors/poe-web.ts (TypeScript), adapted to
// ExtremeRouter's ESM executor pattern (see grok-web.js).
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at PROVIDERS["poe-web"].baseUrl (not .transport.baseUrl).
const GQL_URL = PROVIDERS["poe-web"].baseUrl;
const BASE_URL = "https://www.poe.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// Model id → Poe bot handle. Unknown ids pass through verbatim (passthroughModels=true).
const MODEL_MAP = {
  "gpt-4o": "GPT-4o",
  "gpt-4-turbo": "GPT-4-Turbo",
  "claude-3.5-sonnet": "Claude-3.5-Sonnet",
  "claude-3-opus": "Claude-3-Opus",
  "gemini-2.0-flash": "Gemini-2.0-Flash",
  "llama-3-70b": "Llama-3-70B",
  "mixtral-8x22b": "Mixtral-8x22B",
  "poe-default": "Assistant",
};

// Accept either the bare p-b value or a full Cookie header; extract `p-b`.
function extractPbCookie(raw) {
  if (!raw) return "";
  const v = String(raw).trim().replace(/^Cookie:\s*/i, "");
  const match = v.match(/p-b=([^;]+)/);
  return match ? match[1] : v;
}

function errorResponse(status, message, code = "POE_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function errorResult(status, message, url, transformedBody, code) {
  return { response: errorResponse(status, message, code), url, headers: {}, transformedBody };
}

// Flatten OpenAI messages into the single user prompt Poe expects (last user turn, prefixed
// with any system context). Poe's chatWithBot takes one query string.
function buildPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  const userMsgs = messages.filter((m) => m.role === "user");
  const systemMsgs = messages.filter((m) => m.role === "system" || m.role === "developer");
  const lastUser = userMsgs[userMsgs.length - 1];
  const userText = textOf(lastUser?.content);
  if (!systemMsgs.length) return userText;
  const sysText = systemMsgs.map((m) => textOf(m.content)).filter(Boolean).join("\n");
  return sysText ? `[System Instructions]\n${sysText}\n\n${userText}` : userText;
}

function textOf(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && (c.type === "text" || typeof c === "string"))
      .map((c) => (typeof c === "string" ? c : String(c.text || "")))
      .join("");
  }
  return String(content);
}

export class PoeWebExecutor extends BaseExecutor {
  constructor() {
    super("poe-web", PROVIDERS["poe-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};
    const pbCookie = extractPbCookie(credentials?.apiKey || "");
    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    const requestedModel = bodyObj.model || model || "poe-default";
    const botName = MODEL_MAP[requestedModel] || requestedModel;

    if (messages.length === 0) {
      return errorResult(400, "Missing or empty messages array.", GQL_URL, body, "INVALID_REQUEST");
    }
    if (!pbCookie) {
      return errorResult(
        401,
        "Poe needs your p-b cookie from poe.com. Paste it in the connection.",
        GQL_URL,
        body,
        "NO_COOKIE"
      );
    }

    const prompt = buildPrompt(messages);
    if (!prompt.trim()) {
      return errorResult(400, "Empty query after processing.", GQL_URL, body, "INVALID_REQUEST");
    }

    const wantStream = stream !== false;

    // GraphQL chatWithBot query. Poe returns a single JSON object (no SSE).
    const gqlBody = {
      operationName: "ChatViewQuery",
      query: `query ChatViewQuery($bot: String!, $query: String!) {
        chatWithBot(bot: $bot, query: $query) {
          messageId
          text
          state
        }
      }`,
      variables: { bot: botName, query: prompt },
    };

    const reqHeaders = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
      Cookie: `p-b=${pbCookie}`,
    };

    log?.info?.("POE-WEB", `Query to bot=${botName} (model=${requestedModel}), len=${prompt.length}, stream=${wantStream}`);

    let upstream;
    try {
      upstream = await proxyAwareFetch(
        GQL_URL,
        { method: "POST", headers: reqHeaders, body: JSON.stringify(gqlBody), signal },
        proxyOptions
      );
    } catch (err) {
      log?.error?.("POE-WEB", `Fetch failed: ${err?.message || String(err)}`);
      return errorResult(502, `Poe fetch failed: ${err?.message || String(err)}`, GQL_URL, gqlBody);
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      log?.warn?.("POE-WEB", `HTTP ${upstream.status}: ${errText.slice(0, 200)}`);
      return errorResult(upstream.status, `Poe error: ${errText}`, GQL_URL, gqlBody, `HTTP_${upstream.status}`);
    }

    // Poe returns JSON (not SSE). Parse the chatWithBot payload.
    const data = await upstream.json().catch(() => ({}));
    const inner = data?.data || {};
    const chatData = inner.chatWithBot || {};
    let text = chatData.text || "";

    // Surface upstream GraphQL errors.
    if (Array.isArray(data?.errors) && data.errors.length > 0 && !text) {
      const msg = data.errors.map((e) => e?.message || String(e)).join("; ");
      return errorResult(502, `Poe GraphQL error: ${msg}`, GQL_URL, gqlBody, "GRAPHQL_ERROR");
    }

    const cid = `chatcmpl-poe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const created = Math.floor(Date.now() / 1000);

    if (!wantStream) {
      return {
        response: new Response(
          JSON.stringify({
            id: cid,
            object: "chat.completion",
            created,
            model: requestedModel,
            system_fingerprint: null,
            choices: [
              { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop", logprobs: null },
            ],
            usage: {
              prompt_tokens: Math.ceil(prompt.length / 4),
              completion_tokens: Math.ceil(text.length / 4),
              total_tokens: Math.ceil((prompt.length + text.length) / 4),
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
        url: GQL_URL,
        headers: reqHeaders,
        transformedBody: gqlBody,
      };
    }

    // Streaming: Poe is non-SSE, so emit the full response as one content chunk, then stop.
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream({
      start(controller) {
        // Role frame.
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model: requestedModel,
              system_fingerprint: null,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
            })
          )
        );
        if (text) {
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid,
                object: "chat.completion.chunk",
                created,
                model: requestedModel,
                system_fingerprint: null,
                choices: [{ index: 0, delta: { content: text }, finish_reason: null, logprobs: null }],
              })
            )
          );
        }
        // Stop frame + [DONE].
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model: requestedModel,
              system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
        controller.close();
      },
    });

    return {
      response: new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
      url: GQL_URL,
      headers: reqHeaders,
      transformedBody: gqlBody,
    };
  }
}

export default PoeWebExecutor;
