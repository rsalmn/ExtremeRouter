// GeminiWebExecutor — Gemini Web (gemini.google.com) cookie provider.
//
// ── ANTI-BOT REALITY ─────────────────────────────────────────────────────────
// gemini.google.com is Google-protected and rejects programmatic, non-browser requests.
// OmniRoute drives this provider through Playwright (a real headless browser), which satisfies
// Google's fingerprint checks. ExtremeRouter has NO browser and uses plain `proxyAwareFetch`.
// This port faithfully reproduces the StreamGenerate request shape + cookie header, but a
// direct fetch will almost certainly be blocked (403 / "needs a browser" / empty body).
// If it fails: the cookies are likely still VALID — the TLS/JS fingerprint is rejected, not
// the credentials. This is an anti-bot limitation, NOT a code bug.
//
// Port notes:
//   • Playwright automation → replaced with a direct HTTP GET of the StreamGenerate endpoint.
//   • sanitizeErrorMessage → inlined.
//   • Pseudo-streaming preserved (Gemini returns a single complete payload, not deltas).
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { tlsFetch } from "../utils/tlsClient.js";

const GEMINI_URL = PROVIDERS["gemini-web"].baseUrl; // https://gemini.google.com/app
const GEMINI_STREAM_URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function errorResponse(status, message) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error" } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// Avoid leaking internal stack traces / local paths into client-facing errors.
function sanitizeErrorMessage(raw) {
  if (!raw) return "Unknown error";
  return String(raw)
    .replace(/at\s+.*?\(.*?\)/g, "")
    .replace(/\/[^\s:]+\/[\w.-]+/g, "<path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || "Unknown error";
}

// Parse a pasted cookie blob into { name, value } pairs, stripping attributes
// (Path, Domain, Expires, Secure, HttpOnly, SameSite, Max-Age) that aren't real cookies.
function parseCookies(raw) {
  const out = [];
  if (!raw) return out;
  for (const part of String(raw).split(";")) {
    const piece = part.trim();
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    const name = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (!name || !value) continue;
    const lower = name.toLowerCase();
    if (["path", "domain", "expires", "max-age", "secure", "httponly", "samesite"].includes(lower)) {
      continue;
    }
    out.push({ name, value });
  }
  return out;
}

// Extract a named cookie value from a raw blob.
function cookieValue(raw, name) {
  for (const { name: n, value } of parseCookies(raw)) {
    if (n === name) return value;
  }
  return "";
}

// Parse the StreamGenerate response text into the assistant's text.
//
// Format (the XSSI guard prefix + length-prefixed JSON):
//   )]}'
//   <length>
//   [["wrb.fr", null, "<JSON string>"]]
//
// The inner JSON string's nested array inner[4][0][1] holds text chunks; we return the
// concatenation of all string entries from the first wrb.fr line that carries content.
function parseStreamResponse(rawText) {
  for (const line of String(rawText || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === ")]}'" || /^\d+$/.test(trimmed)) continue;
    let arr;
    try {
      arr = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!Array.isArray(arr) || !arr[0] || arr[0][0] !== "wrb.fr") continue;
    const payload = arr[0][2];
    if (typeof payload !== "string") continue;
    let inner;
    try {
      inner = JSON.parse(payload);
    } catch {
      continue;
    }
    const responseArray = inner?.[4]?.[0]?.[1];
    if (!Array.isArray(responseArray)) continue;
    const text = responseArray.filter((c) => typeof c === "string").join("");
    if (text) return text;
  }
  return "";
}

function extractLastUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((c) => (c && typeof c === "object" && typeof c.text === "string" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
    }
  }
  return "";
}

// Build the form-encoded StreamGenerate query string Gemini's web client sends.
// The RPC name + serialized proto-lite request are wrapped in the "f.req" parameter.
function buildStreamRequestBody(prompt, atToken) {
  // Inner request payload: an array whose second element is the user prompt.
  // This mirrors the proto-lite shape the web client POSTs.
  const innerPayload = JSON.stringify([null, [[prompt], null, null]]);
  const params = [
    ["f.req", JSON.stringify([[[innerPayload], null, null]])],
    ["at", atToken || ""],
  ];
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", PROVIDERS["gemini-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const messages = body?.messages || [];

    const cookie = credentials?.apiKey || credentials?.cookie || "";
    if (!cookie) {
      return {
        response: errorResponse(401, "Missing Gemini cookies — paste your gemini.google.com cookies (need __Secure-1PSID + __Secure-1PSIDTS)."),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Require the two cookies Gemini actually needs.
    if (!cookieValue(cookie, "__Secure-1PSID") || !cookieValue(cookie, "__Secure-1PSIDTS")) {
      log?.warn?.("GEMINI-WEB", "Cookie blob missing __Secure-1PSID / __Secure-1PSIDTS — request will likely fail.");
    }

    const prompt = extractLastUserText(messages);
    if (!prompt.trim()) {
      return {
        response: errorResponse(400, "No user message found."),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const headers = {
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      Origin: "https://gemini.google.com",
      Referer: GEMINI_URL + "/",
      "Sec-Ch-Ua": '"Chromium";v="149", "Not-A.Brand";v="24", "Google Chrome";v="149"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Linux"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": GEMINI_USER_AGENT,
      Cookie: cookie,
    };

    const requestBody = buildStreamRequestBody(prompt, "");
    log?.info?.("GEMINI-WEB", `Direct StreamGenerate fetch (prompt len=${prompt.length}) — ⚠️ likely blocked by Google anti-bot without a browser fingerprint.`);

    let response;
    try {
      response = await tlsFetch(
        GEMINI_STREAM_URL,
        { method: "POST", headers, body: requestBody, signal },
        proxyOptions
      );
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      log?.error?.("GEMINI-WEB", `Fetch failed: ${err?.message || String(err)}`);
      return {
        response: errorResponse(502, `Gemini connection failed: ${sanitizeErrorMessage(err?.message || String(err))}`),
        url: GEMINI_STREAM_URL,
        headers,
        transformedBody: body,
      };
    }

    if (response.status === 403 || response.status === 401) {
      // Most common outcome: Google refuses the request because the TLS/JS fingerprint isn't a browser's.
      let detail = "";
      try { detail = (await response.text()).slice(0, 300); } catch { /* ignore */ }
      log?.warn?.("GEMINI-WEB", `HTTP ${response.status} (anti-bot likely). detail=${detail.replace(/\s+/g, " ").slice(0, 200)}`);
      return {
        response: errorResponse(
          response.status,
          "Gemini blocked the request (HTTP " + response.status + "). This is almost always Google's anti-bot rejecting the non-browser TLS fingerprint — your cookies are probably still valid. " +
            "ExtremeRouter cannot impersonate a browser, so this provider is unlikely to work without a browser-backed bridge."
        ),
        url: GEMINI_STREAM_URL,
        headers,
        transformedBody: body,
      };
    }

    if (!response.ok) {
      let detail = "";
      try { detail = (await response.text()).slice(0, 300); } catch { /* ignore */ }
      log?.warn?.("GEMINI-WEB", `HTTP ${response.status}. detail=${detail.replace(/\s+/g, " ").slice(0, 200)}`);
      return {
        response: errorResponse(response.status, `Gemini returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`),
        url: GEMINI_STREAM_URL,
        headers,
        transformedBody: body,
      };
    }

    const rawText = await response.text().catch(() => "");
    const responseText = parseStreamResponse(rawText);

    if (!responseText) {
      // Google often returns a 200 with an empty/garbled body when the fingerprint is rejected.
      log?.warn?.("GEMINI-WEB", "StreamGenerate returned 200 but no parseable text (anti-bot likely returned an empty/garbled body).");
      return {
        response: errorResponse(502, "No response text from Gemini. The request likely returned an empty/anti-bot body even though the HTTP status was 200 — this provider needs a real browser to work."),
        url: GEMINI_STREAM_URL,
        headers,
        transformedBody: body,
      };
    }

    const modelId = model || "gemini-2.5-pro";
    const cid = `chatcmpl-gemini-web-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      // Pseudo-streaming: Gemini's StreamGenerate returns a complete payload, not deltas.
      // Emit it as a single content chunk + stop + [DONE].
      const encoder = new TextEncoder();
      const sseStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid, object: "chat.completion.chunk", created, model: modelId, system_fingerprint: null,
                choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
              })
            )
          );
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid, object: "chat.completion.chunk", created, model: modelId, system_fingerprint: null,
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null, logprobs: null }],
              })
            )
          );
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid, object: "chat.completion.chunk", created, model: modelId, system_fingerprint: null,
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
        url: GEMINI_STREAM_URL,
        headers,
        transformedBody: body,
      };
    }

    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = Math.ceil(responseText.length / 4);
    return {
      response: new Response(
        JSON.stringify({
          id: cid, object: "chat.completion", created, model: modelId, system_fingerprint: null,
          choices: [{ index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop", logprobs: null }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      url: GEMINI_STREAM_URL,
      headers,
      transformedBody: body,
    };
  }
}

export default GeminiWebExecutor;
