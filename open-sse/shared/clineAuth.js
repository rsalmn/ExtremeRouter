import pkg from "../../package.json" with { type: "json" };

const APP_VERSION = pkg.version || "0.0.0";

/**
 * Normalize a Cline token for the Authorization header.
 *
 * Account auth tokens issued by the Cline extension must carry the WorkOS
 * `workos:` prefix; plain API keys created at app.cline.bot Settings > API Keys
 * must NOT. We only add the prefix when the token looks like an account token
 * (no `cline-` / `sk-` / `workos:` prefix already).
 */
export function getClineAccessToken(token) {
  if (typeof token !== "string") return "";
  const trimmed = token.trim();
  if (!trimmed) return "";
  // Already prefixed, or an API key style (cline-... / sk-...) — leave as-is.
  if (/^(workos:|cline-|sk-)/i.test(trimmed)) return trimmed;
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
