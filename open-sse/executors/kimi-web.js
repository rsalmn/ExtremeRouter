import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Kimi Web — Moonshot AI consumer chat via www.kimi.com (international).
//
// The international consumer chat uses a Connect-RPC protocol:
//   - Endpoint:  POST /apiv2/kimi.gateway.chat.v1.ChatService/Chat
//   - Protocol:  Connect unary envelope framing (5-byte header + JSON)
//   - Auth:      Authorization: Bearer <JWT> + Cookie: kimi-auth=<JWT>
//   - Body:      Connect-framed {scenario, message:{role,blocks:[{text:{content}}]},
//                options:{thinking,enable_plugin}}
//   - Response:  Connect-framed stream of events carrying deltas with one of
//                mask "block.text.content" (answer) or "block.think.content" (reasoning),
//                emitted via op "set" (initial) and op "append" (incremental).
//
// Cookie handling: the user pastes their full Cookie header from www.kimi.com. We extract the
// `kimi-auth` JWT from it (the only cookie the upstream consults) and use it both as the Bearer
// token and as the Cookie we send back, so we don't leak the user's analytics cookies.
//
// Ported from OmniRoute open-sse/executors/kimi-web.ts. Tool/function-calling is intentionally
// skipped — plain text chat only.

const CFG = PROVIDERS["kimi-web"];
// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at CFG.baseUrl (not CFG.transport.baseUrl). See grok-web / chatglm-cn executors.
const BASE_URL = CFG.baseUrl; // https://www.kimi.com
const CHAT_URL = `${BASE_URL}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const DEFAULT_SCENARIO = "SCENARIO_K2D5";

// ── Connect envelope framing ────────────────────────────────────────────

/** Wrap a JSON message in the 5-byte Connect streaming envelope (flags + length). */
export function frameConnectMessage(json) {
  const payload = new TextEncoder().encode(json);
  const framed = new Uint8Array(5 + payload.length);
  framed[0] = 0; // flags: 0 = uncompressed
  const len = payload.length;
  framed[1] = (len >>> 24) & 0xff;
  framed[2] = (len >>> 16) & 0xff;
  framed[3] = (len >>> 8) & 0xff;
  framed[4] = len & 0xff;
  framed.set(payload, 5);
  return framed;
}

// Cap a single Connect frame at 8 MiB. Kimi's largest legitimate event is well under 1 KiB; anything
// bigger means the upstream is misbehaving or an attacker controls the response and is trying to OOM
// the proxy by sending a header claiming a huge length.
const MAX_FRAME_LEN = 8 * 1024 * 1024;

/**
 * Decode one Connect frame from a stream buffer.
 * Returns:
 *   - consumed: 0  if there isn't enough data yet (need more bytes)
 *   - consumed: -1 if the frame header claims a length above MAX_FRAME_LEN (stream-fatal)
 *   - consumed: N  + the parsed frame otherwise
 */
export function decodeConnectFrame(buf, byteOffset) {
  if (byteOffset + 5 > buf.length) return { consumed: 0, frame: null };
  const flags = buf[byteOffset];
  const len =
    (buf[byteOffset + 1] << 24) |
    (buf[byteOffset + 2] << 16) |
    (buf[byteOffset + 3] << 8) |
    buf[byteOffset + 4];
  // Sign-extend the high bit back to negative when len was read as signed.
  const msgLen = len < 0 ? len + 0x100000000 : len;
  if (msgLen > MAX_FRAME_LEN) return { consumed: -1, frame: null };
  if (byteOffset + 5 + msgLen > buf.length) return { consumed: 0, frame: null };

  const payload = buf.subarray(byteOffset + 5, byteOffset + 5 + msgLen);
  let message = null;
  if (msgLen > 0) {
    try {
      message = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      message = null;
    }
  }
  return { consumed: 5 + msgLen, frame: { flags, message } };
}

/**
 * Extract a content delta + kind from a Connect frame message.
 *
 * The chat stream uses two ops against two masks:
 *   - op "set"    on mask "block.text" / "block.think"            → first chunk
 *   - op "append" on mask "block.text.content" / "...think..."    → subsequent chunks
 *
 * Anything else (heartbeats, chat/message metadata, stage transitions) is suppressed; we only
 * surface text to the client.
 */
export function extractDelta(msg) {
  if (!msg) return null;
  const op = String(msg.op ?? "");
  const mask = String(msg.mask ?? "");
  const block = msg.block ?? {};

  // op "append" carries a delta string under block.<text|think>.content.
  if (op === "append") {
    if (mask === "block.text.content") {
      const text = String(block?.text?.content ?? "");
      return text ? { kind: "text", text } : null;
    }
    if (mask === "block.think.content") {
      const text = String(block?.think?.content ?? "");
      return text ? { kind: "think", text } : null;
    }
    return null;
  }

  // op "set" on block.text / block.think carries the initial content.
  if (op === "set") {
    if (mask === "block.text") {
      const text = String(block?.text?.content ?? "");
      return text ? { kind: "text", text } : null;
    }
    if (mask === "block.think") {
      const text = String(block?.think?.content ?? "");
      return text ? { kind: "think", text } : null;
    }
  }
  return null;
}

export function isEndOfStream(msg) {
  if (!msg) return false;
  // Assistant message flipped to COMPLETED.
  const message = msg.message ?? null;
  if (
    message &&
    String(message.status ?? "") === "MESSAGE_STATUS_COMPLETED" &&
    String(message.role ?? "") === "assistant"
  ) {
    return true;
  }
  return false;
}

// ── Credential helper (inlined from OmniRoute webCookieAuth) ────────────

function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";
  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

/**
 * Pull the `kimi-auth` JWT out of whatever the user pasted.
 *   - bare JWT                  eyJhbGci...sig
 *   - full Cookie header        _ga=...; kimi-auth=eyJ...; theme=dark
 *   - Cookie: / Authorization: Bearer prefixed forms
 *   - stray "Bearer eyJ..." without a header label
 * Returns "" if no JWT can be located.
 */
export function extractKimiJwt(rawValue) {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";

  // Bare JWT — three base64url segments separated by dots.
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }

  // Cookie-style pair: pull kimi-auth=<value> out of the blob.
  const match = trimmed.match(/(?:^|[\s;])kimi-auth=([^;\s]+)/);
  if (match) return match[1];

  // Last resort: a "Bearer <jwt>" pasted without the header label.
  const bearer = trimmed.match(
    /bearer\s+(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i
  );
  if (bearer) return bearer[1];

  return "";
}

function errorResponse(status, message, code = `HTTP_${status}`) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// ── Prompt builder (Kimi web is single-turn) ────────────────────────────

function extractMessageText(content) {
  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text")
      .map((item) => String(item.text || ""))
      .join("\n");
  }
  return String(content ?? "");
}

// Fold a multi-turn OpenAI messages array into a single Kimi user turn.
function foldMessages(messages) {
  let system = "";
  let user = "";
  for (const m of messages) {
    const text = extractMessageText(m.content);
    if (!text) continue;
    if (m.role === "system") {
      system += (system ? "\n\n" : "") + text;
    } else if (m.role === "user") {
      // Kimi's web chat is single-turn; keep only the latest user content but preserve prior
      // assistant text for continuity when present.
      user = user ? `${user}\n\n${text}` : text;
    } else if (m.role === "assistant") {
      user = user ? `${user}\n\nAssistant: ${text}` : `Assistant: ${text}`;
    }
  }
  return system ? `${system}\n\n${user}` : user;
}

// ── Streaming transform ─────────────────────────────────────────────────

function buildClientStream(upstreamBody, modelId, cid, created, signal) {
  const encoder = new TextEncoder();

  const push = (controller, deltaObj, finishReason = null) =>
    controller.enqueue(
      encoder.encode(
        sseChunk({
          id: cid,
          object: "chat.completion.chunk",
          created,
          model: modelId,
          choices: [{ index: 0, delta: deltaObj, finish_reason: finishReason }],
        })
      )
    );

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      let buffer = new Uint8Array(0);
      let emittedRole = false;
      try {
        while (true) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const merged = new Uint8Array(buffer.length + value.length);
            merged.set(buffer, 0);
            merged.set(value, buffer.length);
            buffer = merged;

            let offset = 0;
            while (offset < buffer.length) {
              const { consumed, frame } = decodeConnectFrame(buffer, offset);
              if (consumed === -1) {
                // Frame header claims a length above MAX_FRAME_LEN — stream-fatal.
                try { controller.error(new Error("Kimi Connect frame exceeded MAX_FRAME_LEN")); } catch { /* */ }
                return;
              }
              if (consumed === 0) break; // need more bytes
              offset += consumed;
              if (!frame?.message) continue;

              const delta = extractDelta(frame.message);
              if (delta) {
                if (!emittedRole) {
                  emittedRole = true;
                  push(controller, { role: "assistant", content: "" });
                }
                if (delta.kind === "think") {
                  push(controller, { reasoning_content: delta.text });
                } else {
                  push(controller, { content: delta.text });
                }
              }
              if (isEndOfStream(frame.message)) {
                push(controller, {}, "stop");
                controller.enqueue(encoder.encode(SSE_DONE));
                try { controller.close(); } catch { /* */ }
                return;
              }
            }
            // Compact the buffer.
            buffer = buffer.subarray(offset);
          }
        }
        // Stream ended without an explicit COMPLETED marker — flush a stop.
        if (!emittedRole) push(controller, { role: "assistant", content: "" });
        push(controller, {}, "stop");
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        if (!signal?.aborted) {
          try { controller.error(err); return; } catch { /* controller already closed */ }
        }
        if (!emittedRole) {
          try { push(controller, { role: "assistant", content: "" }); } catch { /* */ }
        }
        try {
          push(controller, {}, "stop");
          controller.enqueue(encoder.encode(SSE_DONE));
        } catch { /* */ }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
}

// ── Executor ────────────────────────────────────────────────────────────

export class KimiWebExecutor extends BaseExecutor {
  constructor() {
    super("kimi-web", CFG);
  }

  buildKimiHeaders(jwt) {
    const headers = {
      "Content-Type": "application/connect+json",
      Accept: "*/*",
      "User-Agent": USER_AGENT,
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      "connect-protocol-version": "1",
    };
    if (jwt) {
      headers["Authorization"] = `Bearer ${jwt}`;
      headers["Cookie"] = `kimi-auth=${jwt}`;
    }
    return headers;
  }

  buildRequestBody(prompt, wantThinking) {
    return JSON.stringify({
      scenario: DEFAULT_SCENARIO,
      tools: [{ type: "TOOL_TYPE_SEARCH", search: {} }, { type: "TOOL_TYPE_CRON_JOB" }],
      message: {
        role: "user",
        blocks: [{ message_id: "", text: { content: prompt } }],
        scenario: DEFAULT_SCENARIO,
      },
      options: { thinking: wantThinking, enable_plugin: true },
    });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};

    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    if (messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array."),
        url: CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const rawCredential = String(credentials?.apiKey ?? "").trim();
    const jwt = extractKimiJwt(rawCredential);
    if (!jwt) {
      return {
        response: errorResponse(
          400,
          "Missing Kimi session — paste the full Cookie header from www.kimi.com (must contain " +
            "kimi-auth=<JWT>) or just the JWT itself.",
          "NO_KIMI_AUTH"
        ),
        url: CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const modelId = bodyObj.model || "kimi-default";
    // Decide thinking intent. A user sending reasoning_effort: "none" is explicit — honour it even
    // when the model id suggests a thinking variant. Otherwise thinking models default to thinking on.
    const modelWantsThinking = /k2\.6|k2-6|think/i.test(modelId);
    const wantThinking = bodyObj.reasoning_effort === "none" ? false : modelWantsThinking;

    const prompt = foldMessages(messages);
    const reqBody = this.buildRequestBody(prompt, wantThinking);
    const reqHeaders = this.buildKimiHeaders(jwt);

    // Connect framing wraps the JSON body in a 5-byte envelope. Without it the upstream returns
    // invalid_argument for every request.
    const framedBody = frameConnectMessage(reqBody);

    let upstream;
    try {
      upstream = await proxyAwareFetch(
        CHAT_URL,
        {
          method: "POST",
          headers: reqHeaders,
          body: framedBody,
          signal,
        },
        proxyOptions
      );
    } catch (err) {
      const aborted = err?.name === "AbortError";
      if (aborted) throw err;
      const msg = err instanceof Error ? err.message : "unknown";
      return {
        response: errorResponse(502, `Kimi fetch failed: ${msg}`),
        url: CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      const msg =
        upstream.status === 401 || upstream.status === 403
          ? "Kimi auth failed — your kimi-auth token may be expired. Re-login at www.kimi.com and re-paste."
          : `Kimi error (HTTP ${upstream.status})${errText ? `: ${errText.slice(0, 300)}` : ""}`;
      return {
        response: errorResponse(upstream.status, msg),
        url: CHAT_URL,
        headers: reqHeaders,
        transformedBody: body,
      };
    }

    const cid = `chatcmpl-kimi-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    // The upstream is a Connect-framed stream regardless of whether the client asked for SSE —
    // Kimi always streams. For non-streaming clients we buffer the full response below.
    const sourceStream = upstream.body ?? new ReadableStream({ start: (c) => c.close() });

    if (stream) {
      const outStream = buildClientStream(sourceStream, modelId, cid, created, signal);
      return {
        response: new Response(outStream, {
          status: 200,
          headers: { ...SSE_HEADERS_NO_BUFFER },
        }),
        url: CHAT_URL,
        headers: reqHeaders,
        transformedBody: JSON.parse(reqBody),
      };
    }

    // Non-streaming: collect all deltas into a single chat.completion JSON.
    let answer = "";
    let reasoning = "";
    const reader = sourceStream.getReader();
    let buffer = new Uint8Array(0);
    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer, 0);
        merged.set(value, buffer.length);
        buffer = merged;

        let offset = 0;
        while (offset < buffer.length) {
          const { consumed, frame } = decodeConnectFrame(buffer, offset);
          if (consumed === -1) break; // oversized frame — abort, return what we have
          if (consumed === 0) break;
          offset += consumed;
          if (!frame?.message) continue;
          const delta = extractDelta(frame.message);
          if (delta) {
            if (delta.kind === "think") reasoning += delta.text;
            else answer += delta.text;
          }
          if (isEndOfStream(frame.message)) {
            offset = buffer.length; // drain
            break;
          }
        }
        buffer = buffer.subarray(offset);
      }
    } catch {
      /* best-effort — return what we have */
    }

    const message = { role: "assistant", content: answer || "" };
    if (reasoning) message.reasoning_content = reasoning;
    const completion = {
      id: cid,
      object: "chat.completion",
      created,
      model: modelId,
      choices: [{ index: 0, message, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    return {
      response: new Response(JSON.stringify(completion), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      url: CHAT_URL,
      headers: reqHeaders,
      transformedBody: JSON.parse(reqBody),
    };
  }
}

export default KimiWebExecutor;
