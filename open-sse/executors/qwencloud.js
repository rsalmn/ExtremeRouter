import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { tlsFetch } from "../utils/tlsClient.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// QwenCloud — Alibaba/Qwen consumer web chat executor.
//
// Multi-step auth flow:
//   1. GET home.qwencloud.com/tool/user/info.json (cookie) → secToken
//   2. POST cs-data.qwencloud.com (cookie + sec_token + bx-ua + bx-umidtoken) → accessToken
//   3. POST cs-stream.qwencloud.com/sse/console4Json/{accessToken} (cookie) → SSE chat
//
// Auth input parsing:
//   User pastes: "cookie=<cookie>; bx-ua=<value>; bx-umidtoken=<value>"
//   Or just the cookie string. Without bx-ua/bx-umidtoken, accessToken
//   generation will fail — the executor retries on each request.

const USER_INFO_URL = "https://home.qwencloud.com/tool/user/info.json";
const TOKEN_URL = "https://cs-data.qwencloud.com/data/api.json";
const CHAT_BASE = "https://cs-stream.qwencloud.com/sse/console4Json";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

// Per-process accessToken cache keyed by cookie hash.
const TOKEN_CACHE = (global._qwencloudTokenCache ??= new Map());
const TOKEN_TTL_MS = 25 * 60 * 1000; // 25 min

function hashKey(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Parse user credential: "cookie=...; bx-ua=...; bx-umidtoken=..." or raw cookie
function parseCredential(raw) {
  const str = String(raw || "").trim();
  let cookie = str;
  let bxUa = "";
  let bxUmidtoken = "";

  // Extract bx-ua
  const uaMatch = str.match(/bx-ua=([^\s;]+)/);
  if (uaMatch) { bxUa = uaMatch[1]; cookie = cookie.replace(/bx-ua=[^\s;]+;?\s*/g, ""); }
  // Extract bx-umidtoken
  const umMatch = str.match(/bx-umidtoken=([^\s;]+)/);
  if (umMatch) { bxUmidtoken = umMatch[1]; cookie = cookie.replace(/bx-umidtoken=[^\s;]+;?\s*/g, ""); }

  // Clean up "cookie=" prefix if present
  if (cookie.toLowerCase().startsWith("cookie:")) cookie = cookie.slice(7).trim();
  cookie = cookie.replace(/^cookie=/i, "").trim();

  return { cookie, bxUa, bxUmidtoken };
}

function errorResponse(status, message, code = "QWENCLOUD_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

// Step 1: Get secToken from user info
async function getSecToken(cookie) {
  const res = await tlsFetch(USER_INFO_URL, {
    method: "GET",
    headers: { Cookie: cookie, "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.data?.secToken || null;
}

// Step 2: Get accessToken via cs-data API (requires bx-ua/bx-umidtoken)
async function getAccessToken(cookie, secToken, bxUa, bxUmidtoken) {
  const params = JSON.stringify({
    Api: "zeldaEasy.cornerstoneStreamGateway.streamGatewayConsoleService.generateAccessToken",
    Data: {
      source: "",
      cornerstoneParam: {
        domain: "www.qwencloud.com",
        consoleSite: "QWENCLOUD",
        console: "ONE_CONSOLE",
        xsp_lang: "en-US",
        protocol: "V2",
        productCode: "p_efm",
        switchAgent: 1195760,
      },
    },
    V: "1.0",
  });

  const formData = new URLSearchParams({
    product: "sfm_bailian",
    action: "IntlBroadScopeAspnGateway",
    sec_token: secToken,
    region: "ap-southeast-1",
    params,
  });

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: cookie,
    "User-Agent": USER_AGENT,
    Origin: "https://www.qwencloud.com",
    Referer: "https://www.qwencloud.com/",
    Accept: "application/json, text/plain, */*",
  };
  if (bxUa) headers["bx-ua"] = bxUa;
  if (bxUmidtoken) headers["bx-umidtoken"] = bxUmidtoken;

  const url = `${TOKEN_URL}?product=sfm_bailian&action=IntlBroadScopeAspnGateway&api=zeldaEasy.cornerstoneStreamGateway.streamGatewayConsoleService.generateAccessToken`;
  const res = await tlsFetch(url, { method: "POST", headers, body: formData.toString() });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.data?.DataV2?.data?.data?.accessToken || null;
}

// Cached token resolution
async function resolveAccessToken(cookie, bxUa, bxUmidtoken) {
  const key = hashKey(cookie);
  const cached = TOKEN_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const secToken = await getSecToken(cookie);
  if (!secToken) return null;

  const accessToken = await getAccessToken(cookie, secToken, bxUa, bxUmidtoken);
  if (!accessToken) return null;

  TOKEN_CACHE.set(key, { token: accessToken, expiresAt: Date.now() + TOKEN_TTL_MS });
  return accessToken;
}

// Extract text from QwenCloud SSE event (accumulated format)
// Each event contains full accumulated text in contentList[].content
// contentList[0].type = "DeepThink" → reasoning, other = response
function extractAccumulated(data) {
  let reasoning = "";
  let content = "";
  let isDone = false;

  const messages = data?.data?.messageList || [];
  for (const msg of messages) {
    if (msg.status === "FINISHED" || msg.status === "COMPLETE") isDone = true;
    const parts = msg.contentList || [];
    for (const part of parts) {
      if (part.jsonPath === "/contentList/0/type" && part.content === "DeepThink") continue;
      if (part.jsonPath === "/contentList/0/content") {
        // Check if this is reasoning (first part type was "DeepThink") or response
        const firstType = parts.find(p => p.jsonPath === "/contentList/0/type");
        if (firstType?.content === "DeepThink") {
          reasoning = part.content;
        } else {
          content = part.content;
        }
      }
    }
  }
  return { content, reasoning, isDone };
}

export class QwenCloudExecutor extends BaseExecutor {
  constructor() {
    super("qwencloud", null);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const { cookie, bxUa, bxUmidtoken } = parseCredential(credentials?.apiKey || "");
    if (!cookie) {
      return {
        response: errorResponse(401, "QwenCloud: no cookie provided. Copy the full Cookie string from qwencloud.com DevTools."),
        url: CHAT_BASE, headers: {}, transformedBody: body,
      };
    }

    // Flatten messages
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

    const modelId = model || "qwen3.7-plus";
    const fetchFn = proxyOptions?.connectionProxyEnabled ? proxyAwareFetch : tlsFetch;

    // Resolve accessToken (cached)
    let accessToken = await resolveAccessToken(cookie, bxUa, bxUmidtoken);
    if (!accessToken) {
      log?.warn?.("QWENCLOUD", "Failed to get accessToken — bx-ua/bx-umidtoken may be required or expired");
      return {
        response: errorResponse(401, "QwenCloud: failed to generate accessToken. Ensure bx-ua and bx-umidtoken are included in your credential. Re-copy from qwencloud.com DevTools → Network → POST to cs-data.qwencloud.com → Request Headers."),
        url: CHAT_BASE, headers: {}, transformedBody: body,
      };
    }

    // Build chat request
    const messageId = randomUUID();
    const sessionId = randomUUID().replace(/-/g, "");
    const tabCode = randomUUID().replace(/-/g, "");

    const predictRequest = {
      modelId,
      sessionId,
      tabCode,
      contentList: [{ type: "text", content: fullText }],
      predictConfig: {
        chatType: "t2t",
        debug: null,
        enableSearch: null,
        extraParam: null,
        featureParam: null,
        frequencyPenalty: null,
        gradioExtraParam: null,
        maxLength: null,
        modelParam: {
          top_p: 0.8,
          enable_thinking: true,
          temperature: 0.7,
          result_format: "message",
          thinking_budget: 4000,
          enable_search: false,
        },
        negativePrompt: null,
        presencePenalty: null,
        recordParam: null,
        recorderMap: null,
        stop: null,
        systemMessage: null,
        temperature: null,
        topK: null,
        topP: null,
      },
      reGenerate: false,
      chatLogCode: messageId,
      modelTypeIds: ["Reasoning", "TG", "VU"],
      isAiCenterRequest: false,
    };

    const innerJson = JSON.stringify({
      Api: "zeldaEasy.bmp.agentPredictRpcService.predict",
      V: "1.0",
      Data: { predictRequest },
    });

    const chatBody = JSON.stringify({
      messageId,
      data: [{ type: "JSON_TEXT", value: innerJson }],
    });

    const chatUrl = `${CHAT_BASE}/${accessToken}`;
    const chatHeaders = {
      "Content-Type": "application/json",
      Cookie: cookie,
      "User-Agent": USER_AGENT,
      Origin: "https://www.qwencloud.com",
      Referer: "https://www.qwencloud.com/",
      Accept: "text/event-stream",
    };

    log?.info?.("QWENCLOUD", `model=${modelId} len=${fullText.length} stream=${stream}`);

    let upstream;
    try {
      upstream = await fetchFn(chatUrl, { method: "POST", headers: chatHeaders, body: chatBody, signal }, proxyOptions);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      // Token might be expired — invalidate cache and retry once
      TOKEN_CACHE.delete(hashKey(cookie));
      return {
        response: errorResponse(502, `QwenCloud fetch failed: ${err?.message || err}`),
        url: chatUrl, headers: chatHeaders, transformedBody: chatBody,
      };
    }

    if (upstream.status === 401 || upstream.status === 403) {
      TOKEN_CACHE.delete(hashKey(cookie));
      return {
        response: errorResponse(401, "QwenCloud: session cookie or accessToken expired — re-copy from qwencloud.com DevTools."),
        url: chatUrl, headers: chatHeaders, transformedBody: chatBody,
      };
    }

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      return {
        response: errorResponse(upstream.status || 502, `QwenCloud error: ${errText.slice(0, 300)}`),
        url: chatUrl, headers: chatHeaders, transformedBody: chatBody,
      };
    }

    const cid = `chatcmpl-qc-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    // Non-streaming: collect all text
    if (!stream) {
      const { content, reasoning } = await collectQwenCloudText(upstream.body, signal);
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
        url: chatUrl, headers: chatHeaders, transformedBody: chatBody,
      };
    }

    // Streaming: translate QwenCloud SSE → OpenAI chat.completion.chunk
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        let buffer = "";
        let lastContent = "";
        let lastReasoning = "";
        let emittedFinish = false;

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model: modelId,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        })));

        try {
          while (true) {
            if (signal?.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const raw = trimmed.slice(5).trim();
              if (raw === "[DONE]") continue;

              try {
                const outer = JSON.parse(raw);
                const innerRaw = outer?.data?.[0]?.value;
                if (!innerRaw) continue;
                const inner = JSON.parse(innerRaw);
                const { content, reasoning, isDone } = extractAccumulated(inner);

                // Emit delta (content is accumulated — send only new chars)
                if (reasoning && reasoning.length > lastReasoning.length) {
                  const delta = reasoning.slice(lastReasoning.length);
                  lastReasoning = reasoning;
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: { reasoning_content: delta }, finish_reason: null }],
                  })));
                }
                if (content && content.length > lastContent.length) {
                  const delta = content.slice(lastContent.length);
                  lastContent = content;
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
                  })));
                }
                if (isDone && !emittedFinish) {
                  emittedFinish = true;
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model: modelId,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                  })));
                }
              } catch { /* skip */ }
            }
          }
        } catch (err) {
          if (!signal?.aborted) controller.error(err);
        } finally {
          if (!emittedFinish && !signal?.aborted) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model: modelId,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })));
          }
          try { reader.releaseLock?.(); } catch {}
          controller.enqueue(encoder.encode(SSE_DONE));
          controller.close();
        }
      },
    });

    return {
      response: new Response(responseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
      url: chatUrl, headers: chatHeaders, transformedBody: chatBody,
    };
  }
}

/** Collect full text from QwenCloud SSE stream (accumulated format). */
async function collectQwenCloudText(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let reasoning = "";
  let lastContent = "";
  let lastReasoning = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const outer = JSON.parse(raw);
          const innerRaw = outer?.data?.[0]?.value;
          if (!innerRaw) continue;
          const inner = JSON.parse(innerRaw);
          const { content: c, reasoning: r } = extractAccumulated(inner);
          if (c.length > lastContent.length) lastContent = c;
          if (r.length > lastReasoning.length) lastReasoning = r;
        } catch { /* skip */ }
      }
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
  return { content: lastContent, reasoning: lastReasoning };
}

export default QwenCloudExecutor;
