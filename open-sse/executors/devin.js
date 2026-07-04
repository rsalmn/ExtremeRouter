import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Devin (by Cognition) is a session-based AI software engineer — it does NOT expose an
// OpenAI-style /chat/completions endpoint. This executor bridges that gap:
//
//   OpenAI chat request  ─┐
//                         ▼
//   POST /v1/sessions      (create session with the full prompt)
//                         │
//   GET  /v1/session/{id}  (poll until status ∈ {completed, stopped, blocked})
//                         │
//   agent messages         →  synthesized SSE stream / JSON completion back to client
//
// Because Devin runs a full agentic loop (it can take 30s–several minutes), this adapter:
//   • emits periodic "heartbeat" progress chunks so the SSE connection stays alive and
//     the client sees that work is in progress,
//   • streams agent output messages as they appear across polls,
//   • caps total wait time at MAX_SESSION_MS to avoid unbounded hangs.
//
// Auth: API key only — `Authorization: Bearer cog_...`. No OAuth.
// "Models" map to Devin agent modes (normal/fast/lite/ultra).
//
// API contract (v1, stable):
//   POST https://api.devin.ai/v1/sessions            { prompt, mode?, idempotency_id? }
//     → { session_id, url, status: "created" }
//   GET  https://api.devin.ai/v1/session/{session_id}
//     → { session_id, status, messages: [{ message, type, timestamp, ... }], ... }
//   POST https://api.devin.ai/v1/session/{id}/message { message }   (multi-turn; unused here)

const DEVIN_BASE = PROVIDERS.devin.baseUrl; // https://api.devin.ai
const SESSIONS_URL = `${DEVIN_BASE}/v1/sessions`;
const sessionUrl = (id) => `${DEVIN_BASE}/v1/session/${encodeURIComponent(id)}`;

// Polling cadence. Devin sessions are long-running; we don't want to hammer the API.
const POLL_INTERVAL_MS = 3000;
// Upper bound on how long we'll wait for a single session to reach a terminal state.
const MAX_SESSION_MS = 10 * 60 * 1000; // 10 minutes
// Heartbeat cadence — emit a benign keep-alive chunk so clients/proxies don't time out.
const HEARTBEAT_INTERVAL_MS = 8000;

// Statuses that mean "done, no more polling".
const TERMINAL_STATUSES = new Set(["completed", "stopped", "blocked"]);

// Map our model id → Devin agent mode. The registry encodes this in upstreamModelId; we read
// it via PROVIDER_MODELS (the flattened config in PROVIDERS doesn't carry models).
import { PROVIDER_MODELS } from "../config/providerModels.js";
function resolveMode(model) {
  const models = PROVIDER_MODELS["devin"];
  const entry = models?.find((m) => m.id === model);
  if (entry?.upstreamModelId) return entry.upstreamModelId;
  // Direct pass-through for any mode string we didn't catalog.
  if (typeof model === "string" && model.startsWith("devin-")) return model.slice("devin-".length);
  return "normal";
}

// Flatten an OpenAI messages array into a single Devin prompt string.
// Devin sessions take one upfront prompt; conversation history is concatenated.
function flattenMessages(messages) {
  if (!Array.isArray(messages)) return "";
  const parts = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c) => c && (c.type === "text" || typeof c === "string"))
        .map((c) => (typeof c === "string" ? c : String(c.text || "")))
        .join("\n");
    }
    content = String(content || "").trim();
    if (!content) continue;
    // System/assistant turns are labeled so Devin has context; user turns sent as-is.
    if (role === "user") parts.push(content);
    else parts.push(`[${role}]\n${content}`);
  }
  return parts.join("\n\n").trim();
}

// Extract Devin's textual output from a session payload across polls.
// Returns { text, isNew, full }. We track what we've already emitted so the caller can
// stream only deltas, but we also return the full concatenated message so non-streaming
// callers (and the final streaming frame) get the complete answer.
function extractAgentOutput(payload, lastEmittedLen = 0) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  // Devin emits several message types; the agent's final answer is typically the last
  // user-facing message. We concatenate trailing agent output messages for robustness.
  const agentTexts = [];
  for (const m of messages) {
    const text = m?.message ?? m?.text ?? "";
    if (!text) continue;
    // type may be "user_message", "assistant_message", "action", etc.
    // Prefer assistant/agent output; skip pure user echoes.
    const type = String(m?.type || m?.message_type || "").toLowerCase();
    if (type.includes("user") && !type.includes("assistant")) continue;
    agentTexts.push(String(text));
  }
  const full = agentTexts.join("\n\n").trim();
  // Delta = portion of `full` we haven't reported yet.
  const delta = full.length > lastEmittedLen ? full.slice(lastEmittedLen) : "";
  return { full, delta };
}

function errorResponse(status, message, code = "DEVIN_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// Core session lifecycle: create → poll → return final payload + extracted text.
// `onProgress` is called with { status, delta } after each poll so the streaming path can
// push incremental frames. Aborts cleanly on the provided signal.
async function runSession({ prompt, mode, apiKey, orgId, signal, log, onProgress }) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (orgId) headers["X-Devin-Organization"] = String(orgId);

  // 1. Create session
  const createBody = { prompt, idempotency_id: crypto.randomUUID() };
  if (mode && mode !== "normal") createBody.mode = mode;

  log?.info?.("DEVIN", `create session | mode=${mode} | prompt=${prompt.length} chars`);

  let createRes;
  try {
    createRes = await proxyAwareFetch(
      SESSIONS_URL,
      { method: "POST", headers, body: JSON.stringify(createBody), signal },
      null
    );
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw Object.assign(new Error(`Devin connection failed: ${err?.message || String(err)}`), { code: "CONNECT_FAILED" });
  }

  if (!createRes.ok) {
    let detail = "";
    try { detail = (await createRes.text()) || ""; } catch { /* ignore */ }
    const msg =
      createRes.status === 401 || createRes.status === 403
        ? "Devin auth failed — check that your API key (cog_...) is valid."
        : `Devin session creation failed (HTTP ${createRes.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`;
    throw Object.assign(new Error(msg), { status: createRes.status, code: `HTTP_${createRes.status}` });
  }

  let created;
  try { created = await createRes.json(); }
  catch { throw Object.assign(new Error("Devin returned a malformed session response."), { code: "BAD_RESPONSE" }); }

  const sessionId = created?.session_id;
  if (!sessionId) {
    throw Object.assign(new Error("Devin session creation returned no session_id."), { code: "BAD_RESPONSE" });
  }
  log?.info?.("DEVIN", `session ${sessionId} created`);

  // 2. Poll until terminal
  const deadline = Date.now() + MAX_SESSION_MS;
  let lastEmittedLen = 0;
  let lastStatus = "created";

  while (Date.now() < deadline) {
    if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });

    let pollRes;
    try {
      pollRes = await proxyAwareFetch(
        sessionUrl(sessionId),
        { method: "GET", headers, signal },
        null
      );
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      // Transient poll failures shouldn't kill the whole session — log and retry.
      log?.warn?.("DEVIN", `poll error (will retry): ${err?.message || String(err)}`);
      continue;
    }

    if (!pollRes.ok) {
      if (pollRes.status >= 500) {
        log?.warn?.("DEVIN", `poll HTTP ${pollRes.status}, retrying`);
        continue;
      }
      // Non-retryable client error mid-session — surface it.
      throw Object.assign(new Error(`Devin poll failed (HTTP ${pollRes.status})`), { status: pollRes.status, code: `HTTP_${pollRes.status}` });
    }

    let payload;
    try { payload = await pollRes.json(); }
    catch { payload = {}; }

    lastStatus = String(payload?.status || lastStatus);
    const { full, delta } = extractAgentOutput(payload, lastEmittedLen);
    if (delta) {
      lastEmittedLen = full.length;
      onProgress?.({ status: lastStatus, delta });
    } else {
      onProgress?.({ status: lastStatus, delta: "" });
    }

    if (TERMINAL_STATUSES.has(lastStatus)) {
      log?.info?.("DEVIN", `session ${sessionId} → ${lastStatus} | ${full.length} chars output`);
      return { sessionId, status: lastStatus, full };
    }
  }

  // Timed out waiting for terminal state — return whatever output we have.
  log?.warn?.("DEVIN", `session ${sessionId} timed out (status=${lastStatus}), returning partial output`);
  return { sessionId, status: "timeout", full: "" };
}

// Build a streaming SSE ReadableStream from the session lifecycle.
// Emits: role frame → incremental content deltas (with heartbeats) → stop frame → [DONE].
function buildStreamingSession({ prompt, mode, model, cid, created, apiKey, orgId, signal, log }) {
  const encoder = new TextEncoder();
  let lastEmitted = 0;

  const push = (controller, deltaObj) =>
    controller.enqueue(
      encoder.encode(
        sseChunk({
          id: cid,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: null,
          choices: [{ index: 0, delta: deltaObj, finish_reason: null, logprobs: null }],
        })
      )
    );

  return new ReadableStream({
    async start(controller) {
      // Initial role chunk so clients see an assistant turn immediately.
      push(controller, { role: "assistant" });

      // Heartbeat: keep the connection warm during long agent loops without adding
      // visible content. We emit a zero-content delta which most clients ignore.
      const heartbeat = setInterval(() => {
        try {
          if (!signal?.aborted) push(controller, {});
        } catch { /* controller may be closed */ }
      }, HEARTBEAT_INTERVAL_MS);

      try {
        const result = await runSession({
          prompt,
          mode,
          apiKey,
          orgId,
          signal,
          log,
          onProgress: ({ delta }) => {
            if (delta) {
              lastEmitted += delta.length;
              push(controller, { content: delta });
            }
          },
        });

        // If nothing streamed (e.g. blocked/stopped with no agent output), emit the full text
        // gathered at the end so the client isn't left empty.
        if (lastEmitted === 0 && result.full) {
          push(controller, { content: result.full });
        }
        if (!result.full && (result.status === "blocked" || result.status === "stopped")) {
          push(controller, { content: `[Devin session ended with status: ${result.status}]` });
        }

        // Final stop frame.
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        const aborted = err?.name === "AbortError";
        const msg = aborted ? "Stream aborted." : err?.message || String(err);
        // Emit an in-band error note so the client sees what happened, then close cleanly.
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [{ index: 0, delta: { content: `\n[Devin error: ${msg}]` }, finish_reason: aborted ? "stop" : "stop", logprobs: null }],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
}

// Aggregate the whole session into one non-streaming OpenAI chat.completion JSON.
async function buildNonStreamingSession({ prompt, mode, model, cid, created, apiKey, orgId, signal, log }) {
  const result = await runSession({ prompt, mode, apiKey, orgId, signal, log });
  const content = result.full || `[Devin session ended with status: ${result.status}]`;
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(content.length / 4);
  return new Response(
    JSON.stringify({
      id: cid,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export class DevinExecutor extends BaseExecutor {
  constructor() {
    super("devin", PROVIDERS.devin);
  }

  // Devin ignores the standard transport/auth pipeline entirely — we build our own fetch calls.
  async execute({ model, body, stream, credentials, signal, log }) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { response: errorResponse(400, "Missing or empty messages array.", "INVALID_REQUEST"), url: SESSIONS_URL, headers: {}, transformedBody: body };
    }

    const prompt = flattenMessages(messages);
    if (!prompt) {
      return { response: errorResponse(400, "No text content found in messages.", "INVALID_REQUEST"), url: SESSIONS_URL, headers: {}, transformedBody: body };
    }

    const apiKey = credentials?.apiKey || credentials?.accessToken;
    if (!apiKey) {
      return { response: errorResponse(401, "Devin requires an API key (cog_...). Add one in your connection settings.", "NO_API_KEY"), url: SESSIONS_URL, headers: {}, transformedBody: body };
    }

    const mode = resolveMode(model);
    // orgId is optional; if the user configured it on their connection it routes the session.
    const orgId = credentials?.providerSpecificData?.orgId;

    const cid = `chatcmpl-devin-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const sharedHeaders = { Authorization: "Bearer cog_...", "Content-Type": "application/json" };

    if (stream) {
      const sseStream = buildStreamingSession({ prompt, mode, model, cid, created, apiKey, orgId, signal, log });
      return {
        response: new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
        url: SESSIONS_URL,
        headers: sharedHeaders,
        transformedBody: { prompt, mode },
      };
    }

    const response = await buildNonStreamingSession({ prompt, mode, model, cid, created, apiKey, orgId, signal, log });
    return { response, url: SESSIONS_URL, headers: sharedHeaders, transformedBody: { prompt, mode } };
  }
}

export default DevinExecutor;
