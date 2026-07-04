import pkg from "../../package.json" with { type: "json" };

const APP_VERSION = pkg.version || "0.0.0";

/**
 * Detect whether a token is an API key (not an account OAuth token).
 *
 * Cline issues two kinds of credentials:
 *  - API keys: created at app.cline.bot Settings > API Keys. Format varies
 *    but they are long opaque strings, NOT WorkOS session tokens.
 *  - Account tokens: issued by the VS Code extension OAuth flow. These are
 *    WorkOS access tokens that the Cline backend expects prefixed with
 *    `workos:`.
 *
 * Heuristics for API key detection:
 *  - Contains a dash-separated segment that looks like a key prefix
 *    (cline-, sk-, cp-, clinepass-, cl-).
 *  - Is very long (>= 40 chars) and does NOT look like a JWT
 *    (account tokens are JWTs: header.payload.signature).
 */
function isApiKey(token) {
  if (typeof token !== "string") return false;
  const t = token.trim();
  if (!t) return false;
  // Explicit API key prefixes.
  if (/^(cline-|sk-|cp-|clinepass-|cl-)/i.test(t)) return true;
  // JWTs (account tokens) have exactly 2 dots and base64 segments.
  if (t.split(".").length === 3) return false;
  // Long opaque strings without dots are likely API keys.
  if (t.length >= 40 && !t.includes(".")) return true;
  return false;
}

/**
 * Normalize a Cline token for the Authorization header.
 *
 * Account auth tokens issued by the Cline extension must carry the WorkOS
 * `workos:` prefix; plain API keys must NOT. We only add the prefix when the
 * token is clearly an account (JWT) token that isn't already prefixed.
 */
export function getClineAccessToken(token) {
  if (typeof token !== "string") return "";
  const trimmed = token.trim();
  if (!trimmed) return "";
  // Already prefixed — leave as-is.
  if (trimmed.startsWith("workos:")) return trimmed;
  // API keys are sent as-is, no prefix.
  if (isApiKey(trimmed)) return trimmed;
  // Account token without prefix — add WorkOS prefix expected by Cline backend.
  return `workos:${trimmed}`;
}

export function getClineAuthorizationHeader(token) {
  const accessToken = getClineAccessToken(token);
  return accessToken ? `Bearer ${accessToken}` : "";
}

/**
 * Build request headers for the Cline API.
 *
 * Only headers documented at https://docs.cline.bot/api/authentication are sent:
 *   - HTTP-Referer  (app URL, for usage tracking)
 *   - X-Title       (app name, appears in usage logs)
 *   - Authorization (Bearer token)
 *
 * Previously this sent X-CLIENT-TYPE / X-CLIENT-VERSION / X-CORE-VERSION /
 * X-PLATFORM / X-IS-MULTIROOT and a `ExtremeRouter/<ver>` User-Agent. Those are not
 * part of the documented API and the Cline backend rejects unknown client
 * types with `401 Unauthorized: Please make sure you're using the latest
 * version of Cline and re-authenticate your Cline account.` Keeping the
 * request surface minimal and documented avoids that rejection.
 */
export function buildClineHeaders(token, extraHeaders = {}) {
  const authorization = getClineAuthorizationHeader(token);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    ...extraHeaders,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}
