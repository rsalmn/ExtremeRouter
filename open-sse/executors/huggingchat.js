import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
// NOTE: tlsFetch is intentionally NOT imported here. HuggingFace sits behind
// CloudFront + AWS WAF which fingerprints TLS — the wreq-js impersonation
// signature triggers the WAF (causing HTML login redirects). Use native fetch.

// HuggingChatExecutor — HuggingChat (huggingface.co/chat) Web Provider.
//
// Routes chat requests through HuggingChat's SvelteKit-based API. Requires a valid
// `hf-chat` session cookie from huggingface.co/chat. Self-contained: no imports
// from OmniRoute shared infra — everything needed is inlined here.
//
// API flow:
//   1. POST /chat/conversation  { model, preprompt? } -> { conversationId }
//   2. GET  /chat/api/v2/conversations/{id} -> { rootMessageId }
//   3. POST /chat/conversation/{id}  (multipart: data = JSON{inputs,...}, optional files)
//      -> JSONL stream of MessageUpdate objects.
//
// Streaming format (JSONL, not SSE):
//   - { type: "stream", token: "..." }        text tokens (padded with \0, stripped here)
//   - { type: "status", status: "started" }   generation started
//   - { type: "status", status: "keepAlive" } heartbeat
//   - { type: "finalAnswer", text: "..." }    complete response
//   - { type: "reasoning", subtype: "stream", token: "..." } thinking tokens
//   - { type: "status", status: "error", message: "..." } error

// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at PROVIDERS["huggingchat"].baseUrl (not .transport.baseUrl). See grok-web /
// chatglm-cn executors for the same pattern.
const HUGGINGFACE_BASE = PROVIDERS["huggingchat"].baseUrl; // https://huggingface.co
const CONVERSATION_URL = `${HUGGINGFACE_BASE}/chat/conversation`;
const API_CONVERSATIONS_URL = `${HUGGINGFACE_BASE}/chat/api/v2/conversations`;

const DEFAULT_COOKIE_NAME = "hf-chat";
// Default to "omni" — HF's auto-router. Individual model ids get retired by
// HuggingFace without notice, which causes /chat/conversation to fall back to
// serving the HTML SPA shell instead of the JSON API response (200+HTML, no
// conversationId). The omni router is stable and always available.
const DEFAULT_MODEL = "omni";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// -- Cookie helpers ----------------------------------------------------------

// Strip a leading "Cookie:" / "bearer " label that users sometimes paste.
function stripCookieInputPrefix(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return "";
  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

// Build the `Cookie` header value from whatever the user pasted.
// HuggingFace sits behind AWS WAF (CloudFront) which requires `aws-waf-token` and
// `token` cookies alongside `hf-chat`. Forward the FULL cookie jar when the user
// pastes it; only wrap bare values as `hf-chat=<value>` (which won't pass WAF but
// is better than nothing).
function normalizeHuggingChatCookieHeader(apiKey) {
  const normalized = stripCookieInputPrefix(apiKey);
  if (!normalized) return "";
  // Full cookie blob (contains "=" and likely multiple cookies) → forward as-is.
  // This preserves aws-waf-token, token, hf-chat, and other required cookies.
  if (normalized.includes("=")) return normalized;
  // Bare value → wrap as hf-chat (will work only if WAF is not active).
  return `${DEFAULT_COOKIE_NAME}=${normalized}`;
}

// Detect an OmniRoute-style encrypted credential blob (decryption infra lives
// server-side and isn't available in ExtremeRouter). Surface a clear error.
function isEncryptedCredentialBlob(value) {
  return typeof value === "string" && value.trim().startsWith("enc:v1:");
}

// -- Message helpers ---------------------------------------------------------

function extractTextFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "input_text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter((p) => String(p).trim().length > 0)
    .join("\n")
    .trim();
}

// Flatten OpenAI messages into HuggingChat's { inputs, preprompt } shape.
//   - system/developer messages → preprompt
//   - user/assistant messages → conversation transcript labelled by role
//   - single user turn is passed through untouched
function buildConversationPrompt(messages) {
  const systemParts = [];
  const conversationParts = [];

  for (const msg of messages) {
    const role = String(msg.role || "user");
    const text = extractTextFromContent(msg.content);
    if (!text) continue;

    if (role === "system" || role === "developer") {
      systemParts.push(text);
    } else if (role === "user" || role === "assistant") {
      conversationParts.push({ role, content: text });
    }
  }

  if (conversationParts.length === 0) {
    return { inputs: systemParts.join("\n\n"), systemPrompt: null };
  }

  if (conversationParts.length === 1 && conversationParts[0].role === "user") {
    return {
      inputs: conversationParts[0].content,
      systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : null,
    };
  }

  const lines = [];
  for (const part of conversationParts) {
    const label = part.role === "user" ? "User" : "Assistant";
    lines.push(`${label}: ${part.content}`);
  }
  lines.push("Assistant:");

  return {
    inputs: lines.join("\n\n"),
    systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : null,
  };
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function getLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// -- Upstream error parsing --------------------------------------------------

async function readUpstreamErrorDetails(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  const text = await response.text().catch(() => "");
  if (!text) return { message: null, details: null };

  if (contentType.includes("json")) {
    try {
      const parsed = JSON.parse(text);
      const message =
        typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.error === "string"
            ? parsed.error
            : parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string"
              ? String(parsed.error.message)
              : null;
      return { message: message || null, details: parsed };
    } catch {
      // Fall through to text handling.
    }
  }

  return { message: text, details: { body: text } };
}

function errorResponse(status, message, code = "HUGGINGCHAT_ERROR", details = null) {
  const body = { error: { message, type: status === 401 ? "auth_error" : "upstream_error", code } };
  if (details) body.error.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// -- Conversation bootstrap helpers -----------------------------------------

// HuggingChat wraps the GET /conversations/{id} payload in a SuperJSON envelope
// ({ json: { ... } }). Unwrap it before looking for rootMessageId.
function unwrapSuperjsonPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return value.json && typeof value.json === "object" ? value.json : value;
}

function extractInitialParentMessageId(value) {
  const payload = unwrapSuperjsonPayload(value);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  if (typeof payload.rootMessageId === "string" && payload.rootMessageId.trim()) {
    return payload.rootMessageId;
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && typeof lastMessage === "object") {
    const id = lastMessage.id;
    if (typeof id === "string" && id.trim()) return id;
  }

  return null;
}

async function fetchInitialParentMessageId(conversationId, headers, proxyOptions, signal) {
  // Use proxyAwareFetch (native Node fetch) — NOT tlsFetch. HuggingFace sits
  // behind CloudFront + AWS WAF which fingerprints the TLS layer; the wreq-js
  // impersonation signature actually TRIGGERS the WAF (it doesn't match the
  // real navigator/UA behaviour), causing HF to redirect to the HTML login SPA
  // instead of returning JSON. Native fetch passes cleanly. Mirrors OmniRoute.
  const res = await proxyAwareFetch(
    `${API_CONVERSATIONS_URL}/${conversationId}`,
    { method: "GET", headers, signal },
    proxyOptions
  );
  if (!res.ok) return null;

  const text = await res.text().catch(() => "");
  if (!text) return null;

  try {
    return extractInitialParentMessageId(JSON.parse(text));
  } catch {
    return null;
  }
}

// -- Set-Cookie handling (forward cookies minted by the create-conversation call) --

function splitCombinedSetCookieHeader(header) {
  return header
    .split(/,(?=\s*[^;,=\s]+=)/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getSetCookieHeaders(headers) {
  const maybeGetSetCookie = headers?.getSetCookie;
  if (typeof maybeGetSetCookie === "function") {
    return maybeGetSetCookie.call(headers).filter(Boolean);
  }
  const combined = headers?.get?.("set-cookie");
  return combined ? splitCombinedSetCookieHeader(combined) : [];
}

function parseSetCookiePair(setCookie) {
  const pair = setCookie.split(";", 1)[0]?.trim() || "";
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1) };
}

// Merge the current Cookie header with any Set-Cookie values so subsequent
// requests in the same flow carry freshly minted cookies.
function mergeCookieHeaderWithSetCookie(cookieHeader, setCookieHeaders) {
  const cookieMap = new Map();

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    cookieMap.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1));
  }

  for (const setCookie of setCookieHeaders) {
    const parsed = parseSetCookiePair(setCookie);
    if (!parsed || !parsed.value) continue;
    cookieMap.set(parsed.name, parsed.value);
  }

  return [...cookieMap.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

// -- JSONL event parsing -----------------------------------------------------
//
// Each line of the POST /chat/conversation/{id} body is a MessageUpdate object.
// We reduce them to a small { token, text, done, error } vocabulary.

function parseJsonlLine(line) {
  try {
    const event = JSON.parse(line);

    if (event.type === "stream" && typeof event.token === "string") {
      // Tokens are padded with NUL bytes to a fixed width; strip them.
      const token = event.token.replace(/\0/g, "");
      if (token) return { token };
    }

    if (event.type === "finalAnswer" && typeof event.text === "string") {
      return { text: event.text, done: true };
    }

    if (event.type === "status") {
      if (event.status === "error") {
        return { error: event.message || "HuggingChat generation error" };
      }
      if (event.status === "finished") {
        return { done: true };
      }
    }
  } catch {
    // Skip non-JSON / partial lines.
  }

  return {};
}

// Async generator that emits OpenAI chat.completion.chunk SSE frames as strings,
// then a terminal [DONE]. Streams text deltas only (reasoning/tool support skipped).
async function* streamJsonlToOpenAi(body, model, id, created, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedRole = false;
  let fullText = "";
  let finished = false;

  const emitRole = () => {
    if (emittedRole) return null;
    emittedRole = true;
    return sseChunk({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
  };

  try {
    while (true) {
      if (signal?.aborted) break;

      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parsed = parseJsonlLine(trimmed);

        if (parsed.error) {
          yield sseChunk({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
          yield SSE_DONE;
          finished = true;
          return;
        }

        if (parsed.token) {
          const roleFrame = emitRole();
          if (roleFrame) yield roleFrame;
          fullText += parsed.token;
          yield sseChunk({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: parsed.token }, finish_reason: null }],
          });
        }

        if (parsed.text) {
          // finalAnswer carries the complete text — emit only the unseen suffix.
          const remaining = parsed.text.slice(fullText.length);
          if (remaining) {
            const roleFrame = emitRole();
            if (roleFrame) yield roleFrame;
            yield sseChunk({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: { content: remaining }, finish_reason: null }],
            });
          }
          finished = true;
          break;
        }

        if (parsed.done) {
          finished = true;
          break;
        }
      }

      if (finished) break;
    }

    // Flush any trailing content left in the buffer.
    if (!finished && buffer.trim()) {
      const parsed = parseJsonlLine(buffer.trim());
      if (parsed.token && !signal?.aborted) {
        const roleFrame = emitRole();
        if (roleFrame) yield roleFrame;
        yield sseChunk({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: parsed.token }, finish_reason: null }],
        });
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!signal?.aborted) {
    yield sseChunk({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    yield SSE_DONE;
  }
}

// Aggregate the JSONL stream into a single text response (non-streaming).
async function readJsonlResponse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      if (signal?.aborted) break;

      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parsed = parseJsonlLine(trimmed);
        if (parsed.token) fullText += parsed.token;
        if (parsed.text) return parsed.text; // finalAnswer — definitive
        if (parsed.error) throw new Error(parsed.error);
      }
    }

    if (buffer.trim()) {
      const parsed = parseJsonlLine(buffer.trim());
      if (parsed.text) return parsed.text;
      if (parsed.token) fullText += parsed.token;
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

// -- Executor ----------------------------------------------------------------

export class HuggingChatExecutor extends BaseExecutor {
  constructor() {
    super("huggingchat", PROVIDERS["huggingchat"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const proxy = proxyOptions ?? null;
    const messages = body?.messages;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array", "INVALID_REQUEST"),
        url: CONVERSATION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    if (isEncryptedCredentialBlob(credentials?.apiKey)) {
      return {
        response: errorResponse(
          401,
          "HuggingChat credentials are encrypted but no decryption key is loaded. Re-save the HuggingChat cookie as a plain value.",
          "ENCRYPTED_CREDENTIALS"
        ),
        url: CONVERSATION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    let cookieHeader = normalizeHuggingChatCookieHeader(credentials?.apiKey || "");
    if (!cookieHeader) {
      return {
        response: errorResponse(
          401,
          "HuggingChat requires a session cookie. Log in to huggingface.co/chat, open DevTools > Application > Cookies, and copy the hf-chat cookie value (or paste the full cookie string).",
          "NO_COOKIE"
        ),
        url: CONVERSATION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const resolvedModel = model || DEFAULT_MODEL;
    const { inputs, systemPrompt } = buildConversationPrompt(messages);

    if (!inputs.trim()) {
      return {
        response: errorResponse(400, "Empty prompt after processing messages", "INVALID_REQUEST"),
        url: CONVERSATION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const baseHeaders = {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
      Origin: HUGGINGFACE_BASE,
      Referer: `${HUGGINGFACE_BASE}/chat/`,
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua": '"Chromium";v="149", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Linux"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Priority": "u=1, i",
    };

    // -- Step 1: Create conversation ----------------------------------------
    let conversationId;
    try {
      // Build the create-conversation body. HuggingFace's SPA always sends
      // `preprompt` (even as "") — omitting it has been observed to make the
      // upstream fall back to serving the HTML SPA shell instead of the JSON
      // API response. Always include the field.
      const createBody = {
        model: resolvedModel,
        preprompt: systemPrompt || "",
      };

      // Use proxyAwareFetch (native Node fetch) — see fetchInitialParentMessageId
      // note above. tlsFetch triggers CloudFront WAF → HTML login redirect.
      const createRes = await proxyAwareFetch(
        CONVERSATION_URL,
        {
          method: "POST",
          headers: { ...baseHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(createBody),
          signal,
        },
        proxy
      );

      if (!createRes.ok) {
        const status = createRes.status;
        const upstreamError = await readUpstreamErrorDetails(createRes);
        let message = `HuggingChat conversation creation failed (HTTP ${status})`;
        if (status === 401 || status === 403) {
          message =
            "HuggingChat auth failed — your hf-chat session cookie may be missing or expired. Log in to huggingface.co/chat and re-paste your cookie.";
        } else if (status === 429) {
          message = "HuggingChat rate limited. Wait a moment and retry.";
        }
        if (upstreamError.message) message = `${message}: ${upstreamError.message}`;
        log?.warn?.("HUGGINGCHAT", message);
        return {
          response: errorResponse(status, message, `HTTP_${status}`, upstreamError.details),
          url: CONVERSATION_URL,
          headers: baseHeaders,
          transformedBody: body,
        };
      }

      // Read body as text first, then parse manually — HF may return the response
      // with a non-JSON content-type (e.g. text/html), which causes .json() to throw.
      // The .catch(()=>({})) was silently swallowing the parse failure.
      const rawBody = await createRes.text().catch(() => "");
      let createData = {};
      try { createData = rawBody ? JSON.parse(rawBody) : {}; } catch { /* not JSON */ }

      // Resolve conversationId from several places HF may return it:
      //   1. body.conversationId (confirmed working format)
      //   2. body.id (fallback)
      //   3. Location response header tail
      conversationId = createData.conversationId || createData.id;
      if (!conversationId) {
        const loc = createRes.headers.get("location") || createRes.headers.get("Location") || "";
        const fromLoc = String(loc).split("?")[0].split("/").filter(Boolean).pop();
        if (fromLoc && /^[a-zA-Z0-9_-]{6,}$/.test(fromLoc)) conversationId = fromLoc;
      }
      // Carry forward any cookies minted by the create call.
      cookieHeader = mergeCookieHeaderWithSetCookie(cookieHeader, getSetCookieHeaders(createRes.headers));
      baseHeaders.Cookie = cookieHeader;

      if (!conversationId) {
        return {
          response: errorResponse(502, `HuggingChat did not return a conversationId (status ${createRes.status}, body: ${rawBody.slice(0, 200)})`, "NO_CONVERSATION_ID"),
          url: CONVERSATION_URL,
          headers: baseHeaders,
          transformedBody: body,
        };
      }
    } catch (err) {
      const message = err?.message || String(err);
      log?.error?.("HUGGINGCHAT", `Conversation creation failed: ${message}`);
      return {
        response: errorResponse(502, `HuggingChat connection failed: ${message}`, "CREATE_FAILED"),
        url: CONVERSATION_URL,
        headers: baseHeaders,
        transformedBody: body,
      };
    }

    // -- Step 2: Resolve parent message id ----------------------------------
    const parentMessageId = await fetchInitialParentMessageId(conversationId, baseHeaders, proxy, signal);
    if (!parentMessageId) {
      return {
        response: errorResponse(
          502,
          "HuggingChat did not return an initial parent message id",
          "NO_PARENT_MESSAGE"
        ),
        url: `${API_CONVERSATIONS_URL}/${conversationId}`,
        headers: baseHeaders,
        transformedBody: body,
      };
    }

    // -- Step 3: Send message (multipart) -----------------------------------
    const messageUrl = `${CONVERSATION_URL}/${conversationId}`;
    const sendDataPayload = {
      inputs,
      is_retry: false,
      is_continue: false,
      generationId: crypto.randomUUID(),
      selectedMcpServerNames: [],
      selectedMcpServers: [],
      timezone: getLocalTimezone(),
      id: parentMessageId,
    };

    const formData = new FormData();
    formData.append("data", JSON.stringify(sendDataPayload));

    log?.info?.("HUGGINGCHAT", `Query to ${resolvedModel}, len=${inputs.length}`);

    let upstreamResponse;
    try {
      // Use proxyAwareFetch (native Node fetch) — see note above. tlsFetch
      // triggers CloudFront WAF → HTML login redirect.
      upstreamResponse = await proxyAwareFetch(
        messageUrl,
        {
          method: "POST",
          headers: baseHeaders, // FormData sets its own Content-Type boundary
          body: formData,
          signal,
        },
        proxy
      );
    } catch (err) {
      const message = err?.message || String(err);
      log?.error?.("HUGGINGCHAT", `Message send failed: ${message}`);
      return {
        response: errorResponse(502, `HuggingChat connection failed: ${message}`, "SEND_FAILED"),
        url: messageUrl,
        headers: baseHeaders,
        transformedBody: sendDataPayload,
      };
    }

    if (!upstreamResponse.ok) {
      const status = upstreamResponse.status;
      const upstreamError = await readUpstreamErrorDetails(upstreamResponse);
      let message = `HuggingChat returned HTTP ${status}`;
      if (status === 401 || status === 403) {
        message = "HuggingChat auth failed — session cookie may be expired.";
      } else if (status === 429) {
        message = "HuggingChat rate limited. Wait a moment and retry.";
      } else if (status === 404) {
        message = `HuggingChat model not found: ${resolvedModel}. Check the model ID.`;
      }
      if (upstreamError.message) message = `${message}: ${upstreamError.message}`;
      log?.warn?.("HUGGINGCHAT", message);
      return {
        response: errorResponse(status, message, `HTTP_${status}`, upstreamError.details),
        url: messageUrl,
        headers: baseHeaders,
        transformedBody: sendDataPayload,
      };
    }

    if (!upstreamResponse.body) {
      return {
        response: errorResponse(502, "HuggingChat returned empty response body", "EMPTY_BODY"),
        url: messageUrl,
        headers: baseHeaders,
        transformedBody: sendDataPayload,
      };
    }

    // -- Step 4: Build response ---------------------------------------------
    const id = `chatcmpl-huggingchat-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      const encoder = new TextEncoder();
      const jsonlStream = streamJsonlToOpenAi(
        upstreamResponse.body,
        resolvedModel,
        id,
        created,
        signal
      );

      const sseStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of jsonlStream) {
              controller.enqueue(encoder.encode(chunk));
            }
          } catch (err) {
            log?.error?.("HUGGINGCHAT", `Stream error: ${err?.message || String(err)}`);
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model: resolvedModel,
                  choices: [
                    {
                      index: 0,
                      delta: { content: `\n[HuggingChat stream error: ${err?.message || String(err)}]` },
                      finish_reason: "stop",
                    },
                  ],
                })
              )
            );
            controller.enqueue(encoder.encode(SSE_DONE));
          } finally {
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        },
      });

      return {
        response: new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
        url: messageUrl,
        headers: baseHeaders,
        transformedBody: sendDataPayload,
      };
    }

    // Non-streaming: aggregate the JSONL stream into one chat.completion.
    const fullText = await readJsonlResponse(upstreamResponse.body, signal);
    const promptTokens = estimateTokens(inputs);
    const completionTokens = estimateTokens(fullText);

    return {
      response: new Response(
        JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model: resolvedModel,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: fullText },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      url: messageUrl,
      headers: baseHeaders,
      transformedBody: sendDataPayload,
    };
  }
}

export default HuggingChatExecutor;
