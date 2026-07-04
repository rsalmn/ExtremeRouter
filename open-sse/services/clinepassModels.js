import { buildClineHeaders } from "../shared/clineAuth.js";

const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Build request headers for the ClinePass /models endpoint (Cline's upstream API).
 *
 * ClinePass is a paid subscription that authenticates via API keys (created at
 * app.cline.bot). API keys are sent as plain Bearer tokens WITHOUT the `workos:`
 * prefix. Account OAuth tokens (from the Cline extension) DO need the prefix —
 * buildClineHeaders handles this distinction internally via getClineAccessToken.
 */
function buildModelListHeaders(token, isApiKey) {
  if (isApiKey) {
    // API keys: send as plain Bearer, no workos: prefix, no extra Cline headers.
    return {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    };
  }
  // Account token: buildClineHeaders adds workos: prefix as needed.
  return buildClineHeaders(token, { Accept: "application/json" });
}

/**
 * Fetch ClinePass live model catalog from Cline's /models endpoint.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClinepassModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = buildModelListHeaders(token, isApiKey);

    const response = await fetch(CLINEPASS_MODELS_ENDPOINT, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json();
    const rawList = Array.isArray(json) ? json : json?.data;
    if (!Array.isArray(rawList)) return null;

    const models = rawList
      .filter((m) => typeof m?.id === "string" && m.id.startsWith("cline-pass/"))
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
      }));

    return models.length ? { models } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
