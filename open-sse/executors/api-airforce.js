import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// api.airforce — OpenAI-compatible gateway with session-cookie → API-key exchange.
//
// The user pastes a web session cookie (`airforce_session` JWT). That JWT is NOT
// accepted as a Bearer token by /v1/* (returns 401 "Invalid API key"). The web
// playground works by calling /api/me with the session cookie, which returns the
// account JSON — including the real API key (`sk-air-...`). The playground then
// uses that api_key as a Bearer token for /v1/chat/completions.
//
// This executor replicates that flow:
//   1. Resolve the session cookie from the credential (bare JWT, `airforce_session=`,
//      or full Cookie header).
//   2. Exchange it for an api_key via GET /api/me (cached 10 min per credential to
//      avoid re-fetching on every request; the key is long-lived, but the session
//      cookie can expire, so we re-fetch periodically).
//   3. Forward the OpenAI-format request body verbatim to /v1/chat/completions
//      with `Authorization: Bearer <api_key>`. api.airforce is fully OpenAI-
//      compatible, so no body translation is needed — we only rebrand the auth.
//
// Reference: github.com/diegosouzapw/OmniRoute (api-airforce registry, MIT) — but
// OmniRoute treats this as an API-key provider. ExtremeRouter adds the session-
// exchange layer so users paste a cookie instead of manually copying their api_key.

const CFG = PROVIDERS["api-airforce"];
// NOTE: buildTransport() in providers/index.js flattens `transport` to the top level, so the
// baseUrl lives at CFG.baseUrl (not CFG.transport.baseUrl). Same pattern as zenmux-free,
// chatglm-cn, grok-web.
const CHAT_URL = CFG?.baseUrl || "https://api.airforce/v1/chat/completions";
const ME_URL = "https://api.airforce/api/me";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

// In-process api_key cache keyed by session JWT. The api_key itself is long-lived
// (rotated only when the user regenerates it in the dashboard), but the session
// cookie can expire, so a 10-min TTL keeps us from trusting a stale key after the
// session dies. Survives hot-reload via global.
const KEY_CACHE = (global._airforceKeyCache ??= new Map()); // sessionJwt → { apiKey, expiresAt }
const KEY_TTL_MS = 10 * 60 * 1000; // 10 min

function normalizeSessionCookie(raw) {
  let v = String(raw || "").trim();
  if (v.toLowerCase().startsWith("cookie:")) v = v.slice(7).trim();
  // Bare JWT (starts with eyJ) — wrap as airforce_session=<jwt>
  if (v.startsWith("eyJ") && !v.includes("=")) {
    return `airforce_session=${v}`;
  }
  // Full cookie string — extract the airforce_session value if present
  const m = v.match(/airforce_session=([^;]+)/);
  if (m) return `airforce_session=${m[1]}`;
  // Otherwise assume the whole thing is the cookie value
  if (!v.includes("=")) return `airforce_session=${v}`;
  return v;
}

function extractSessionJwt(raw) {
  const v = String(raw || "").trim();
  if (v.toLowerCase().startsWith("cookie:")) {
    const m = v.slice(7).trim().match(/airforce_session=([^;]+)/);
    return m ? m[1] : v.slice(7).trim();
  }
  if (v.startsWith("eyJ") && !v.includes("=")) return v;
  const m = v.match(/airforce_session=([^;]+)/);
  return m ? m[1] : v;
}

function errorResponse(status, message, code = "AIRFORCE_ERROR") {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

// Exchange the session cookie for the account's api_key. Cached per-sessionJwt.
async function resolveApiKey(sessionCookie, sessionJwt, proxyOptions, log) {
  const cached = KEY_CACHE.get(sessionJwt);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.apiKey;
  }

  let res;
  try {
    res = await proxyAwareFetch(
      ME_URL,
      {
        method: "GET",
        headers: {
          Cookie: sessionCookie,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          Referer: "https://api.airforce/playground/",
        },
      },
      proxyOptions,
    );
  } catch (err) {
    throw new Error(`api.airforce session exchange failed: ${err?.message || err}`);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("api.airforce session cookie is invalid or expired — re-copy airforce_session from api.airforce DevTools");
    }
    const txt = await res.text().catch(() => "");
    throw new Error(`api.airforce /api/me returned ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => null);
  const apiKey = data?.api_key;
  if (!apiKey || !String(apiKey).startsWith("sk-air-")) {
    throw new Error("api.airforce /api/me did not return a valid api_key — session may be limited");
  }

  KEY_CACHE.set(sessionJwt, { apiKey, expiresAt: Date.now() + KEY_TTL_MS });
  log?.debug?.("AIRFORCE", `resolved api_key ${apiKey.slice(0, 12)}... (cached 10m)`);
  return apiKey;
}

export class ApiAirforceExecutor extends BaseExecutor {
  constructor() {
    super("api-airforce", CFG);
  }

  // Override buildUrl so BaseExecutor's fallback logic (which reads this.config.baseUrl)
  // resolves to the chat endpoint. Already true via the flattened transport, but explicit
  // is better than implicit for a non-standard auth flow.
  buildUrl() {
    return CHAT_URL;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const rawCredential = credentials?.apiKey || "";
    if (!rawCredential) {
      return {
        response: errorResponse(401, "api.airforce: no airforce_session cookie provided. Log in at api.airforce/playground/ and copy the airforce_session cookie value."),
        url: CHAT_URL, headers: {}, transformedBody: body,
      };
    }

    const sessionCookie = normalizeSessionCookie(rawCredential);
    const sessionJwt = extractSessionJwt(rawCredential);

    let apiKey;
    try {
      apiKey = await resolveApiKey(sessionCookie, sessionJwt, proxyOptions, log);
    } catch (err) {
      return {
        response: errorResponse(401, err.message),
        url: CHAT_URL, headers: {}, transformedBody: body,
      };
    }

    // api.airforce is fully OpenAI-compatible — forward the body verbatim, only
    // ensuring model + stream are set. Drop max_tokens if the model is a free-tier
    // one that ignores it (harmless, but avoids a 400 on some quirky models).
    const upstreamBody = { ...body };
    if (model) upstreamBody.model = model;
    else if (!upstreamBody.model) upstreamBody.model = "gpt-4o-mini";
    upstreamBody.stream = !!stream;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": USER_AGENT,
      Accept: stream ? "text/event-stream" : "application/json",
    };

    log?.info?.("AIRFORCE", `model=${upstreamBody.model} stream=${stream} len=${JSON.stringify(upstreamBody).length}`);

    let upstream;
    try {
      upstream = await proxyAwareFetch(
        CHAT_URL,
        {
          method: "POST",
          headers,
          body: JSON.stringify(upstreamBody),
          signal,
        },
        proxyOptions,
      );
    } catch (err) {
      if (err.name === "AbortError") throw err;
      return {
        response: errorResponse(502, `api.airforce fetch failed: ${err?.message || err}`),
        url: CHAT_URL, headers, transformedBody: upstreamBody,
      };
    }

    // 401 here means the cached api_key went stale (user rotated it). Invalidate
    // the cache and surface a clear error so the next request re-exchanges.
    if (upstream.status === 401) {
      KEY_CACHE.delete(sessionJwt);
      const errText = await upstream.text().catch(() => "");
      return {
        response: errorResponse(401, `api.airforce: api_key rejected (${errText.slice(0, 120) || "Invalid API key"}). Re-test the connection to refresh the key.`),
        url: CHAT_URL, headers, transformedBody: upstreamBody,
      };
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      // 402 = paid model without balance — pass through the upstream message verbatim
      // (it already explains how to top up).
      if (upstream.status === 402) {
        return {
          response: new Response(errText || JSON.stringify({ error: { message: "Paid model requires a positive balance. Top up at https://api.airforce/dashboard", code: "402" } }), {
            status: 402, headers: { "Content-Type": "application/json" },
          }),
          url: CHAT_URL, headers, transformedBody: upstreamBody,
        };
      }
      // 429 = global rate limit — pass through (the upstream message includes retry hint)
      if (upstream.status === 429) {
        return {
          response: new Response(errText, { status: 429, headers: { "Content-Type": "application/json" } }),
          url: CHAT_URL, headers, transformedBody: upstreamBody,
        };
      }
      return {
        response: errorResponse(upstream.status, `api.airforce error: ${errText.slice(0, 300)}`),
        url: CHAT_URL, headers, transformedBody: upstreamBody,
      };
    }

    // Success — pass the upstream response through untouched. api.airforce already
    // returns OpenAI-format SSE (streaming) or JSON (non-streaming), so no
    // translation is needed.
    return { response: upstream, url: CHAT_URL, headers, transformedBody: upstreamBody };
  }
}

export default ApiAirforceExecutor;
