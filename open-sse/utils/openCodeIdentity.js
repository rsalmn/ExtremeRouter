/**
 * OpenCode request identity — request-scoped session/request/client/project
 * resolution for the OpenCode upstream.
 *
 * Identity is resolved ONCE per logical request (the account-fallback loop in
 * chat.js; chatCore as fallback for other callers) and carried through
 * executor.execute({ identity }) — it is never stored on executor singletons,
 * so concurrent requests cannot cross-talk (the 9router _currentSessionId
 * pattern is intentionally NOT reproduced).
 */

import crypto from "crypto";
import { resolveSessionId } from "./sessionManager.js";

const SESSION_MAX_LEN = 64; // tail length of canonical ses_<alnum> ids
const REQUEST_MAX_LEN = 128; // client-provided request ids
const CLIENT_MAX_LEN = 64;
const PROJECT_MAX_LEN = 128;
const USER_AGENT_MAX_LEN = 256;
const PRE_NORMALIZE_MAX_LEN = 512; // input cap before canonicalization

// Strip control chars + CR/LF (header-injection guard) before length checks.
function stripUnsafe(value) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\0-\x1f\x7f]/g, "");
}

// Bounded, header-safe header value: trim, strip control chars, drop when the
// caller's value is absent, whitespace-only, or beyond the cap (unbounded
// client input must never reach the upstream or our logs).
function normalizeValue(value, maxLen) {
  if (typeof value !== "string") return null;
  const v = stripUnsafe(value).trim();
  if (!v) return null;
  if (v.length > maxLen) return null;
  return v;
}

// Case-insensitive header lookup — headers arrive lowercased from Next.js, but
// callers may pass untrusted maps, so never assume casing.
function pickHeader(headers, name) {
  if (!headers || typeof headers !== "object") return null;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" && key.toLowerCase() === lower) return value;
  }
  return null;
}

/** msg_<uuid-no-dashes> — cryptographically unique per logical request. */
export function generateOpenCodeRequestId() {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** ses_<uuid-no-dashes> — unique, never shared across users. */
export function generateOpenCodeSessionId() {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Canonical (pre-truncation) session tail: strip repeated ses_ prefixes and
 * dashes (official ids are dash-less), drop characters outside [A-Za-z0-9_],
 * then strip leading underscores so the tail starts with an alnum char.
 * Returns null when nothing usable remains.
 */
function canonicalSessionTail(value) {
  const v = normalizeValue(value, PRE_NORMALIZE_MAX_LEN);
  if (!v) return null;
  const rest = v
    .replace(/^(?:ses_)+/i, "")
    .replace(/-/g, "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/^_+/, "");
  return rest || null;
}

/**
 * Canonicalize any session candidate into the upstream's ses_<alnum> shape,
 * capping the tail. Returns null when nothing usable remains — callers fall
 * back to a generated id (a garbage client value must never become a
 * shared/upstream session).
 */
export function toOpenCodeSessionId(value) {
  const rest = canonicalSessionTail(value);
  if (!rest) return null;
  return `ses_${rest.slice(0, SESSION_MAX_LEN)}`;
}

// Client conversation identifiers from the body (OpenAI/Responses style).
function bodyConversationId(body) {
  if (!body || typeof body !== "object") return null;
  return (
    body.conversation_id ||
    body.conversationId ||
    body.session_id ||
    body.prompt_cache_key ||
    null
  );
}

/**
 * Strict session validation for providers that MUST receive a real client
 * conversation id (opencode-go). Unlike the permissive path, a malformed value
 * is rejected outright — never stripped, truncated or replaced with a
 * generated id — so the caller can return HTTP 400 before dispatch instead of
 * fabricating/silently colliding a session.
 */
function strictClientSessionId(value) {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  if (/[\r\n\0-\x1f\x7f]/.test(value)) return null;
  const v = value.trim();
  if (!v || v.length > PRE_NORMALIZE_MAX_LEN) return null;
  const tail = canonicalSessionTail(v);
  // Reject instead of truncating: a lossy conversion would map two distinct
  // client sessions to the same upstream session id.
  if (!tail || tail.length > SESSION_MAX_LEN) return null;
  return `ses_${tail}`;
}

/**
 * Resolve the identity of one logical OpenCode request.
 *
 * sessionId priority:
 *   1. client x-opencode-session header (canonicalized, never replaced by a
 *      random id when valid);
 *   2. existing sessionManager chain for real connections (client session →
 *      assistant-text → workspace → per-connection);
 *   3. shared anonymous provider (connectionId "noauth"): the connection
 *      cannot identify a conversation, so a client conversation id from the
 *      body is used when present, else a fresh generated session. Never
 *      derived from the shared connection alone — cross-user collision is
 *      impossible by construction (limitation: without client-provided
 *      identity, anonymous sessions are request-scoped, documented in tests).
 *
 * requestId: client value preserved, else generated once. The caller holds
 * the returned object for the whole logical request, so retries, account
 * fallback, alternate transports and streams all reuse the same requestId.
 * clientId/projectId: forwarded only when present.
 * userAgent: real downstream client UA (bounded, control chars stripped), else
 * null — callers decide on a truthful fallback.
 *
 * requireClientSession: strict mode for opencode-go. A missing/whitespace/
 * oversized/control-character client x-opencode-session yields sessionId:null
 * (callers reject with HTTP 400); no session is ever fabricated or derived from
 * the body/connection.
 *
 * All outputs are bounded and header-safe (no control chars, capped length).
 */
export function resolveOpenCodeIdentity({ headers = {}, body = {}, connectionId = null, requireClientSession = false } = {}) {
  const requestId =
    normalizeValue(pickHeader(headers, "x-opencode-request"), REQUEST_MAX_LEN) ||
    generateOpenCodeRequestId();
  const clientId = normalizeValue(pickHeader(headers, "x-opencode-client"), CLIENT_MAX_LEN);
  const projectId = normalizeValue(pickHeader(headers, "x-opencode-project"), PROJECT_MAX_LEN);
  // A User-Agent carrying control characters is not a real downstream UA —
  // drop it entirely (callers fall back to their truthful wrapper identity)
  // rather than forward a mangled value.
  const rawUserAgent = pickHeader(headers, "user-agent");
  // eslint-disable-next-line no-control-regex
  const userAgent = typeof rawUserAgent === "string" && !/[\r\n\0-\x1f\x7f]/.test(rawUserAgent)
    ? normalizeValue(rawUserAgent, USER_AGENT_MAX_LEN)
    : null;

  const clientSession = normalizeValue(
    pickHeader(headers, "x-opencode-session"),
    PRE_NORMALIZE_MAX_LEN
  );
  let sessionId;
  if (requireClientSession) {
    // Strict: never fabricate a session for a client that must supply one.
    sessionId = strictClientSessionId(pickHeader(headers, "x-opencode-session"));
  } else if (clientSession) {
    sessionId = toOpenCodeSessionId(clientSession) || generateOpenCodeSessionId();
  } else if (connectionId && connectionId !== "noauth") {
    sessionId =
      toOpenCodeSessionId(resolveSessionId({ headers, body, connectionId, scope: "opencode" })) ||
      generateOpenCodeSessionId();
  } else {
    // Shared anonymous provider — never derive from the connection alone.
    const conv = normalizeValue(bodyConversationId(body), PRE_NORMALIZE_MAX_LEN);
    sessionId = conv
      ? toOpenCodeSessionId(conv) || generateOpenCodeSessionId()
      : generateOpenCodeSessionId();
  }

  return { sessionId, requestId, clientId, projectId, userAgent };
}