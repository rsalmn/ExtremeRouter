import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Trae (ByteDance coding IDE) — SOLO remote agent via a session-based API.
//
// Wire protocol (reverse-engineered from solo.trae.ai web client):
//   1. POST {base}/chat_sessions  → { data: { chat_session_id, message_id } }
//   2. GET  {base}/chat_sessions/{id}/events?reply_to_message_id={id}
//        → text/event-stream. Assistant text streams in `plan_item` events under
//          the `thought` field (cumulative per plan-item id). `token_usage` carries
//          usage; `done` ends the turn; `error` carries upstream errors.
//
// Auth: header `Authorization: Cloud-IDE-JWT <JWT>` (RS256, ~14-day lifetime).
// The JWT is stored as credentials.apiKey (fallback accessToken). Identity fields
// (web_id, biz_user_id, user_unique_id, scope, tenant, region) live in
// providerSpecificData — all optional with sensible defaults so a bare JWT works.
//
// Reference: github.com/diegosouzapw/OmniRoute (TraeExecutor, MIT).

const STREAM_TIMEOUT_MS = parseInt(process.env.TRAE_STREAM_TIMEOUT_MS || "300000", 10);

function flattenQuery(messages) {
  const parts = [];
  for (const m of messages || []) {
    let content = "";
    if (typeof m.content === "string") content = m.content;
    else if (Array.isArray(m.content)) {
      content = m.content
        .map((p) => {
          if (typeof p === "string") return p;
          if (p && typeof p === "object") return String(p.text ?? "");
          return "";
        })
        .join("");
    }
    if (m.role === "system") parts.push(`[System]\n${content}`);
    else if (m.role === "assistant") parts.push(`[Assistant]\n${content}`);
    else parts.push(content);
  }
  // Trae expects query as a JSON-encoded string of typed content blocks.
  return JSON.stringify([{ type: "text", data: { content: parts.join("\n\n") } }]);
}

export class TraeExecutor extends BaseExecutor {
  constructor() {
    super("trae", PROVIDERS["trae"]);
  }

  base() {
    return (this.config.baseUrl || "https://core-normal.trae.ai/api/remote/v1").replace(/\/$/, "");
  }

  buildHeaders(credentials, proxyOptions) {
    const token = (credentials.apiKey || credentials.accessToken || "").trim();
    const psd = credentials.providerSpecificData || {};
    return {
      Authorization: `Cloud-IDE-JWT ${token}`,
      "Content-Type": "application/json",
      "X-Trae-Client-Type": "web",
      "X-Preferenced-Language": psd.appLanguage || "en",
      "x-user-region": psd.userRegion || "US",
      Referer: "https://solo.trae.ai/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    };
  }

  // SOLO exposes "code" (full model picker) vs "work" (fast auto). We expose
  // "work" as its own id; anything else runs in "code" mode.
  resolveMode(model) {
    const m = (model || "").trim().toLowerCase();
    if (m === "work" || m === "auto-work" || m === "solo-work") {
      return { mode: "work", strategy: "auto", modelName: "" };
    }
    const auto = !m || m === "auto";
    return { mode: "code", strategy: auto ? "auto" : "manual", modelName: auto ? "" : model };
  }

  commonParams(psd, mode, sessionId) {
    const cp = {
      language: "en-us",
      app_language: psd.appLanguage || "en",
      quality: "stable",
      app_version: psd.appVersion || "1.0.0.1229",
      web_id: psd.webId || "",
      user_identity: psd.userIdentity || "Free",
      is_freshman: "0",
      biz_user_id: psd.bizUserId || "",
      user_unique_id: psd.userUniqueId || "",
      scope: psd.scope || "marscode-us",
      tenant: psd.tenant || "marscode",
      region: psd.region || "US-East",
      aiRegion: psd.aiRegion || psd.region || "US-East",
      is_privacy_mode: 0,
      privacy_mode: "off",
      solo_chat_mode: mode,
    };
    if (sessionId) cp.biz_session_id = sessionId;
    return JSON.stringify(cp);
  }

  // POST /chat_sessions — creates a session and submits the first turn.
  async createSession(headers, query, model, psd, signal, proxyOptions) {
    const { mode, strategy, modelName } = this.resolveMode(model);
    const body = {
      mode,
      environment_id: "default",
      initial_message: {
        chat_session_id: "",
        content: [],
        query,
        model_name: modelName,
        agent_type: "solo_agent_remote",
        model_selection_strategy: strategy,
        common_params: this.commonParams(psd, mode),
      },
      env: "remote",
      auto_create_project: false,
      origin: "web",
    };
    const res = await proxyAwareFetch(
      `${this.base()}/chat_sessions`,
      { method: "POST", headers, body: JSON.stringify(body), signal },
      proxyOptions
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`[${res.status}] ${text.slice(0, 300)}`);
    const json = JSON.parse(text);
    if (json?.code !== 0) throw new Error(`Trae create_session: ${JSON.stringify(json).slice(0, 300)}`);
    return { sessionId: json.data.chat_session_id, messageId: json.data.message_id };
  }

  // GET /events SSE → onEvent(eventType, dataObj) per frame. Resolves on done/error.
  async streamEvents(headers, sessionId, replyTo, onEvent, signal, proxyOptions) {
    const url = `${this.base()}/chat_sessions/${sessionId}/events?reply_to_message_id=${encodeURIComponent(replyTo)}`;
    const ctrl = new AbortController();
    if (signal?.aborted) ctrl.abort();
    const timer = setTimeout(() => ctrl.abort(new Error("trae stream timeout")), STREAM_TIMEOUT_MS);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await proxyAwareFetch(url, { method: "GET", headers, signal: ctrl.signal }, proxyOptions);
      if (!res.ok || !res.body) throw new Error(`[${res.status}] events stream failed`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let ev = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            let data;
            try { data = JSON.parse(payload); } catch { data = { _raw: payload }; }
            if (onEvent(ev, data)) {
              await reader.cancel().catch(() => {});
              return;
            }
          } else if (line === "") ev = null;
        }
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const headers = this.buildHeaders(credentials, proxyOptions);
    const psd = credentials.providerSpecificData || {};
    const messages = (body && body.messages) || [];
    if (messages.length === 0) {
      return { response: errorResponse(400, "Missing or empty messages array."), url: this.base(), headers, transformedBody: body };
    }
    const token = (credentials.apiKey || credentials.accessToken || "").trim();
    if (!token) {
      return { response: errorResponse(401, "Trae needs a Cloud-IDE-JWT token. Sign in at solo.trae.ai and copy the JWT."), url: this.base(), headers, transformedBody: body };
    }
    const query = flattenQuery(messages);
    const responseId = `chatcmpl-trae-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let session;
    try {
      session = await this.createSession(headers, query, model, psd, signal, proxyOptions);
    } catch (err) {
      return { response: errorResponse(502, err.message || String(err)), url: this.base(), headers, transformedBody: body };
    }

    // Shared per-turn state: plan_item thoughts (cumulative, longest wins).
    const order = [];
    const thoughts = {};
    let sent = 0;
    let usage = null;
    let errorEvent = null;
    const renderNewText = (data) => {
      const pid = data.id;
      if (!pid) return "";
      if (!(pid in thoughts)) order.push(pid);
      const t = data.thought || "";
      if (t.length >= (thoughts[pid] || "").length) thoughts[pid] = t;
      const full = order.map((i) => thoughts[i]).join("");
      const piece = full.slice(sent);
      sent = full.length;
      return piece;
    };

    if (stream !== false) {
      const encoder = new TextEncoder();
      // Bind `this` for the streamEvents call inside start() — the method-style
      // start() would otherwise lose the class binding.
      const self = this;
      const sse = new ReadableStream({
        async start(controller) {
          const emit = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          try {
            emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
            await self.streamEvents(headers, session.sessionId, session.messageId, (ev, data) => {
              if (ev === "error") { errorEvent = data; return true; }
              if (ev === "token_usage") usage = data;
              if (ev === "plan_item") {
                const piece = renderNewText(data);
                if (piece) emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
              }
              return ev === "done";
            }, signal, proxyOptions);
            if (errorEvent) {
              emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [], error: { message: `trae ${errorEvent.code}: ${errorEvent.message}`, type: "api_error" } });
            } else {
              emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });
      return {
        response: new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
        url: this.base(),
        headers,
        transformedBody: body,
      };
    }

    // Non-streaming: drive to completion, return chat.completion JSON.
    try {
      await this.streamEvents(headers, session.sessionId, session.messageId, (ev, data) => {
        if (ev === "error") { errorEvent = data; return true; }
        if (ev === "token_usage") usage = data;
        if (ev === "plan_item") renderNewText(data);
        return ev === "done";
      }, signal, proxyOptions);
    } catch (err) {
      return { response: errorResponse(502, err.message || String(err)), url: this.base(), headers, transformedBody: body };
    }
    if (errorEvent) {
      return { response: errorResponse(502, `trae ${errorEvent.code}: ${errorEvent.message}`), url: this.base(), headers, transformedBody: body };
    }
    const content = order.map((i) => thoughts[i]).join("");
    const out = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    };
    if (usage) out.usage = { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 };
    return { response: new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } }), url: this.base(), headers, transformedBody: body };
  }
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: { message, type: "api_error", code: "" } }), { status, headers: { "Content-Type": "application/json" } });
}

export default TraeExecutor;
