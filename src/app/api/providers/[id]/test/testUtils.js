import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { createHash } from "node:crypto";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getDefaultModel } from "open-sse/config/providerModels.js";
import { resolveOllamaLocalHost, PROVIDERS } from "open-sse/config/providers.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "open-sse/services/oauthCredentialManager.js";
import {
  GEMINI_CONFIG,
  ANTIGRAVITY_CONFIG,
  KIRO_CONFIG,
  QWEN_CONFIG,
  CLAUDE_CONFIG,
  CLINE_CONFIG,
  KILOCODE_CONFIG,
  KIMCHI_CONFIG,
} from "@/lib/oauth/constants/oauth";
import { buildClineHeaders } from "@/shared/utils/clineAuth";

// OAuth provider test endpoints
const OAUTH_TEST_CONFIG = {
  claude: { checkExpiry: true, refreshable: true },
  codex: {
    url: "https://chatgpt.com/backend-api/codex/responses",
    method: "POST",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "Content-Type": "application/json", "originator": "codex_cli_rs", "User-Agent": "codex_cli_rs/0.136.0" },
    // Minimal invalid body — triggers fast 400 without consuming quota
    body: JSON.stringify({ model: "gpt-5.3-codex", input: [], stream: false, store: false }),
    // 400 (bad request) means auth succeeded; only 401/403 means token is bad
    acceptStatuses: [400],
    refreshable: true,
  },
  "gemini-cli": {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  antigravity: {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  github: {
    url: "https://api.github.com/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "User-Agent": "ExtremeRouter", "Accept": "application/vnd.github+json" },
  },
  iflow: {
    // iFlow getUserInfo requires accessToken as query param, not header
    buildUrl: (token) => `https://iflow.cn/api/oauth/getUserInfo?accessToken=${encodeURIComponent(token)}`,
    method: "GET",
    noAuth: true,
  },
  qwen: { checkExpiry: true, refreshable: true },
  kiro: { checkExpiry: true, refreshable: true },
  qoder: {
    // Test by hitting Qoder's userinfo endpoint with the device token.
    // refreshable: false because the device-flow refresh endpoint returns
    // 403 for our flow (users re-login when expired). No checkExpiry —
    // we want the actual URL probe to run so revoked tokens surface.
    url: "https://openapi.qoder.sh/api/v1/userinfo",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: false,
  },
  "kimi-coding": { checkExpiry: true, refreshable: false },
  cursor: { tokenExists: true },
  kilocode: {
    url: `${KILOCODE_CONFIG.apiBaseUrl}/api/profile`,
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  cline: { refreshable: true },
  gitlab: {
    // Test by hitting the GitLab user API — requires api or read_user scope
    url: "https://gitlab.com/api/v4/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  "codebuddy-cn": { tokenExists: true },
  kimchi: {
    url: KIMCHI_CONFIG.validationUrl || "https://api.cast.ai/v1/llm/openai/supported-providers",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: {
      Accept: "application/json",
      "User-Agent": "kimchi/0.1.40",
    },
    refreshable: false,
  },
};

async function probeClineAccessToken(accessToken) {
  const res = await fetch("https://api.cline.bot/api/v1/users/me", {
    method: "GET",
    headers: buildClineHeaders(accessToken, {
      Accept: "application/json",
    }),
  });

  return res;
}

const CLOUD_CODE_ASSIST_TEST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const CLOUD_CODE_ASSIST_TEST_BODY = JSON.stringify({
  metadata: {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  },
});

function parseProviderErrorMessage(bodyText, fallback) {
  if (!bodyText) return fallback;
  try {
    const parsed = JSON.parse(bodyText);
    const message = parsed?.error?.message || parsed?.message || parsed?.error;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message) return JSON.stringify(message);
  } catch {
    // fall through
  }
  return bodyText.trim() || fallback;
}

async function probeCloudCodeAssistAccess(connection, accessToken, effectiveProxy = null) {
  const userAgent = connection.provider === "antigravity"
    ? "google-api-nodejs-client/9.15.1 vscode-antigravity/1.107.0"
    : "google-api-nodejs-client/9.15.1 gemini-cli/0.34.0";

  const res = await fetchWithConnectionProxy(CLOUD_CODE_ASSIST_TEST_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: CLOUD_CODE_ASSIST_TEST_BODY,
  }, effectiveProxy);

  if (res.ok) return { valid: true, error: null };

  const bodyText = await res.text().catch(() => "");
  return {
    valid: false,
    error: parseProviderErrorMessage(bodyText, `API returned ${res.status}`),
    status: res.status,
  };
}

async function refreshOAuthToken(connection) {
  const provider = connection.provider;
  const refreshToken = connection.refreshToken;
  if (!refreshToken) return null;

  try {
    if (provider === "gemini-cli" || provider === "antigravity") {
      const config = provider === "gemini-cli" ? GEMINI_CONFIG : ANTIGRAVITY_CONFIG;
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "codex") {
      return await refreshProviderCredentials(provider, connection, console);
    }

    if (provider === "claude") {
      const response = await fetch(CLAUDE_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: CLAUDE_CONFIG.clientId,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "kiro") {
      const psd = connection.providerSpecificData || {};
      const clientId = psd.clientId || connection.clientId;
      const clientSecret = psd.clientSecret || connection.clientSecret;
      const region = psd.region || connection.region;
      if (clientId && clientSecret) {
        const endpoint = `https://oidc.${region || "us-east-1"}.amazonaws.com/token`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, clientSecret, refreshToken, grantType: "refresh_token" }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        return { accessToken: data.accessToken, expiresIn: data.expiresIn || 3600, refreshToken: data.refreshToken || refreshToken };
      }
      const response = await fetch(KIRO_CONFIG.socialRefreshUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "kiro-cli/1.0.0" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.accessToken, expiresIn: data.expiresIn || 3600, refreshToken: data.refreshToken || refreshToken };
    }

    if (provider === "qwen") {
      const response = await fetch(QWEN_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: QWEN_CONFIG.clientId,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "cline") {
      const response = await fetch(CLINE_CONFIG.refreshUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          refreshToken,
          grantType: "refresh_token",
          clientType: "extension",
        }),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const data = payload?.data || payload;
      const expiresIn = data?.expiresAt
        ? Math.max(1, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000))
        : 3600;
      return {
        accessToken: data?.accessToken,
        expiresIn,
        refreshToken: data?.refreshToken || refreshToken,
      };
    }

    return null;
  } catch (err) {
    console.log(`Error refreshing ${provider} token:`, err.message);
    return null;
  }
}

function isTokenExpired(connection) {
  return shouldRefreshCredentials(connection.provider, connection);
}

async function testOAuthConnection(connection, effectiveProxy = null) {
  const config = OAUTH_TEST_CONFIG[connection.provider];
  if (!config) return { valid: false, error: "Provider test not supported", refreshed: false };
  if (!connection.accessToken) return { valid: false, error: "No access token", refreshed: false };

  // Cursor uses protobuf API - can only verify token exists, not test endpoint
  if (config.tokenExists) {
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  let accessToken = connection.accessToken;
  let refreshed = false;
  let newTokens = null;

  const tokenExpired = isTokenExpired(connection);
  if (config.refreshable && tokenExpired && connection.refreshToken) {
    const tokens = await refreshOAuthToken(connection);
    if (tokens) {
      accessToken = tokens.accessToken;
      refreshed = true;
      newTokens = tokens;
    } else {
      return { valid: false, error: "Token expired and refresh failed", refreshed: false };
    }
  }

  if (config.checkExpiry) {
    if (refreshed) return { valid: true, error: null, refreshed, newTokens };
    if (tokenExpired) return { valid: false, error: "Token expired", refreshed: false };
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  if (connection.provider === "gemini-cli" || connection.provider === "antigravity") {
    const initial = await probeCloudCodeAssistAccess(connection, accessToken, effectiveProxy);
    if (initial.valid) return { valid: true, error: null, refreshed, newTokens };

    if (initial.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens?.accessToken) {
        const retry = await probeCloudCodeAssistAccess(connection, tokens.accessToken, effectiveProxy);
        if (retry.valid) return { valid: true, error: null, refreshed: true, newTokens: tokens };
        return { valid: false, error: retry.error, refreshed: true, newTokens: tokens };
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { valid: false, error: initial.error, refreshed };
  }

  if (connection.provider === "cline") {
    const tryProbe = async (token) => {
      const res = await probeClineAccessToken(token);
      if (res.ok) return { valid: true, error: null, refreshed, newTokens };
      if (res.status === 401) return { valid: false, error: "Token invalid or revoked", refreshed };
      if (res.status === 403) return { valid: false, error: "Access denied", refreshed };
      return { valid: false, error: `API returned ${res.status}`, refreshed };
    };

    const initial = await tryProbe(accessToken);
    if (initial.valid || initial.error !== "Token invalid or revoked" || !connection.refreshToken) {
      return initial;
    }

    const tokens = await refreshOAuthToken(connection);
    if (!tokens?.accessToken) {
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    refreshed = true;
    newTokens = tokens;
    accessToken = tokens.accessToken;
    return await tryProbe(accessToken);
  }

  try {
    const testUrl = config.buildUrl ? config.buildUrl(accessToken) : config.url;
    const headers = config.noAuth
      ? { ...config.extraHeaders }
      : { [config.authHeader]: `${config.authPrefix}${accessToken}`, ...config.extraHeaders };
    const fetchOpts = { method: config.method, headers };
    if (config.body) fetchOpts.body = config.body;
    const res = await fetchWithConnectionProxy(testUrl, fetchOpts, effectiveProxy);

    const accepted = res.ok || (config.acceptStatuses && config.acceptStatuses.includes(res.status));
    if (accepted) return { valid: true, error: null, refreshed, newTokens };

    if (res.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens) {
        const retryUrl = config.buildUrl ? config.buildUrl(tokens.accessToken) : testUrl;
        const retryHeaders = config.noAuth
          ? { ...config.extraHeaders }
          : { [config.authHeader]: `${config.authPrefix}${tokens.accessToken}`, ...config.extraHeaders };
        const retryOpts = { method: config.method, headers: retryHeaders };
        if (config.body) retryOpts.body = config.body;
        const retryRes = await fetchWithConnectionProxy(retryUrl, retryOpts, effectiveProxy);
        const retryAccepted = retryRes.ok || (config.acceptStatuses && config.acceptStatuses.includes(retryRes.status));
        if (retryAccepted) return { valid: true, error: null, refreshed: true, newTokens: tokens };
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    if (res.status === 401) return { valid: false, error: "Token invalid or revoked", refreshed };
    if (res.status === 403) return { valid: false, error: "Access denied", refreshed };
    return { valid: false, error: `API returned ${res.status}`, refreshed };
  } catch (err) {
    return { valid: false, error: err.message, refreshed };
  }
}

async function fetchWithConnectionProxy(url, options = {}, effectiveProxy = null) {
  // Vercel relay: forward via relay URL
  if (effectiveProxy?.vercelRelayUrl) {
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    return proxyAwareFetch(url, options, {
      vercelRelayUrl: effectiveProxy.vercelRelayUrl,
    });
  }

  if (!effectiveProxy?.connectionProxyEnabled || !effectiveProxy?.connectionProxyUrl) {
    return fetch(url, options);
  }

  const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
  return proxyAwareFetch(url, options, {
    connectionProxyEnabled: true,
    connectionProxyUrl: effectiveProxy.connectionProxyUrl,
    connectionNoProxy: effectiveProxy.connectionNoProxy || "",
  });
}

async function testApiKeyConnection(connection, effectiveProxy = null) {
  if (isOpenAICompatibleProvider(connection.provider)) {
    const modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      const res = await fetchWithConnectionProxy(`${modelsBase.replace(/\/$/, "")}/models`, {
        headers: { "Authorization": `Bearer ${connection.apiKey}` },
      }, effectiveProxy);
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  if (isAnthropicCompatibleProvider(connection.provider)) {
    let modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      modelsBase = modelsBase.replace(/\/$/, "");
      if (modelsBase.endsWith("/messages")) modelsBase = modelsBase.slice(0, -9);
      const messagesUrl = `${modelsBase}/v1/messages`;
      const model = connection.defaultModel || "claude-3-haiku-20240307";
      const res = await fetchWithConnectionProxy(messagesUrl, {
        method: "POST",
        headers: {
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "Authorization": `Bearer ${connection.apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
        }),
      }, effectiveProxy);
      // 400/529 still confirms key accepted; only 401/403 = bad key
      const valid = res.status !== 401 && res.status !== 403;
      return { valid, error: valid ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  try {
    switch (connection.provider) {
      case "cloudflare-ai": {
        const psd = connection.providerSpecificData || {};
        const accountId = psd.accountId;
        if (!accountId) return { valid: false, error: "Missing Account ID" };
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
        const res = await fetchWithConnectionProxy(url, {
          method: "POST",
          headers: { "Authorization": `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: getDefaultModel("cloudflare-ai"), messages: [{ role: "user", content: "test" }], max_tokens: 1 }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403 && res.status !== 404;
        return { valid, error: valid ? null : "Invalid API token or Account ID" };
      }
      case "azure": {
        const psd = connection.providerSpecificData || {};
        const endpoint = (psd.azureEndpoint || "").replace(/\/$/, "");
        const deployment = psd.deployment || "gpt-4";
        const apiVersion = psd.apiVersion || "2024-10-01-preview";
        const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
        const headers = { "api-key": connection.apiKey, "Content-Type": "application/json" };
        if (psd.organization) headers["OpenAI-Organization"] = psd.organization;
        const res = await fetchWithConnectionProxy(url, {
          method: "POST", headers,
          body: JSON.stringify({ messages: [{ role: "user", content: "test" }], max_completion_tokens: 1 }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key or Azure configuration" };
      }
      case "openai": {
        const res = await fetchWithConnectionProxy("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "vercel-ai-gateway": {
        const res = await fetchWithConnectionProxy("https://ai-gateway.vercel.sh/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "anthropic": {
        const res = await fetchWithConnectionProxy("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "gemini": {
        const res = await fetchWithConnectionProxy(`https://generativelanguage.googleapis.com/v1/models?key=${connection.apiKey}`, {}, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "openrouter": {
        const res = await fetchWithConnectionProxy("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "glm": {
        const res = await fetchWithConnectionProxy("https://api.z.ai/api/anthropic/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "glm-cn": {
        const res = await fetchWithConnectionProxy("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${connection.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "minimax":
      case "minimax-cn": {
        const endpoints = { minimax: "https://api.minimax.io/anthropic/v1/messages", "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages" };
        const res = await fetchWithConnectionProxy(endpoints[connection.provider], {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "minimax-m2", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "kimi": {
        const res = await fetchWithConnectionProxy("https://api.kimi.com/coding/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "kimi-latest", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "alicode":
      case "alicode-intl": {
        // Aliyun Coding Plan uses OpenAI-compatible API
        const aliBaseUrl = connection.provider === "alicode-intl"
          ? "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions"
          : "https://coding.dashscope.aliyuncs.com/v1/chat/completions";
        const res = await fetchWithConnectionProxy(aliBaseUrl, {
          method: "POST",
          headers: { "Authorization": `Bearer ${connection.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: getDefaultModel(connection.provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "volcengine-ark":
      case "byteplus": {
        const res = await fetchWithConnectionProxy(PROVIDERS[connection.provider]?.baseUrl, {
          method: "POST",
          headers: { "Authorization": `Bearer ${connection.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: getDefaultModel(connection.provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "deepseek": {
        const res = await fetchWithConnectionProxy("https://api.deepseek.com/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "groq": {
        const res = await fetchWithConnectionProxy("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "mistral": {
        const res = await fetchWithConnectionProxy("https://api.mistral.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "xai": {
        const res = await fetchWithConnectionProxy("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nvidia": {
        const res = await fetchWithConnectionProxy("https://integrate.api.nvidia.com/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "perplexity": {
        const res = await fetchWithConnectionProxy("https://api.perplexity.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "together": {
        const res = await fetchWithConnectionProxy("https://api.together.xyz/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "fireworks": {
        const res = await fetchWithConnectionProxy("https://api.fireworks.ai/inference/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "cerebras": {
        const res = await fetchWithConnectionProxy("https://api.cerebras.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "cohere": {
        const res = await fetchWithConnectionProxy("https://api.cohere.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nebius": {
        const res = await fetchWithConnectionProxy("https://api.studio.nebius.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "siliconflow": {
        const res = await fetchWithConnectionProxy("https://api.siliconflow.com/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "hyperbolic": {
        const res = await fetchWithConnectionProxy("https://api.hyperbolic.xyz/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "ollama": {
        const res = await fetch("https://ollama.com/api/tags", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "ollama-local": {
        const host = resolveOllamaLocalHost(connection);
        const res = await fetch(`${host}/api/tags`);
        return { valid: res.ok, error: res.ok ? null : `Ollama not reachable at ${host}` };
      }
      case "deepgram": {
        const res = await fetchWithConnectionProxy("https://api.deepgram.com/v1/projects", { headers: { Authorization: `Token ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "assemblyai": {
        const res = await fetchWithConnectionProxy("https://api.assemblyai.com/v1/account", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nanobanana": {
        const res = await fetchWithConnectionProxy("https://api.nanobananaapi.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "fal-ai": {
        const res = await fetchWithConnectionProxy("https://api.fal.ai/v1/models?limit=1", { headers: { Authorization: `Key ${connection.apiKey}` } }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "chutes": {
        const res = await fetchWithConnectionProxy("https://llm.chutes.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "grok-web": {
        const token = connection.apiKey.startsWith("sso=") ? connection.apiKey.slice(4) : connection.apiKey;
        const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
        const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
        const res = await fetchWithConnectionProxy("https://grok.com/rest/app-chat/conversations/new", {
          method: "POST",
          headers: {
            Accept: "*/*", "Content-Type": "application/json",
            Cookie: `sso=${token}`, Origin: "https://grok.com", Referer: "https://grok.com/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            "x-statsig-id": statsigId, "x-xai-request-id": crypto.randomUUID(),
            traceparent: `00-${randomHex(16)}-${randomHex(8)}-00`,
          },
          body: JSON.stringify({ temporary: true, modelName: "grok-4", message: "ping", fileAttachments: [], imageAttachments: [], disableSearch: false, enableImageGeneration: false, sendFinalMetadata: true }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid SSO cookie" };
      }
      case "chatglm-cn": {
        // Extract refresh token from full cookies or accept a bare token.
        let refreshToken = connection.apiKey;
        const m = connection.apiKey.match(/chatglm_refresh_token=([^;]+)/);
        if (m) refreshToken = m[1].trim();
        // Sign the refresh probe the way the web client does.
        const now = String(Date.now());
        const digits = [...now].map(Number);
        const checksum = (digits.reduce((a, b) => a + b, 0) - digits[digits.length - 2]) % 10;
        const timestamp = now.slice(0, -2) + String(checksum) + now.slice(-1);
        const nonce = crypto.randomUUID().replace(/-/g, "");
        const sign = createHash("md5").update(`${timestamp}-${nonce}-8a1317a7468aa3ad86e997d08f3f31cb`, "utf8").digest("hex");
        const res = await fetchWithConnectionProxy("https://chatglm.cn/chatglm/user-api/user/refresh", {
          method: "POST",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            Authorization: `Bearer ${refreshToken}`,
            Origin: "https://chatglm.cn",
            "X-App-Fr": "default",
            "X-App-Platform": "pc",
            "X-Device-Id": crypto.randomUUID().replace(/-/g, ""),
            "X-Nonce": nonce,
            "X-Request-Id": crypto.randomUUID().replace(/-/g, ""),
            "X-Sign": sign,
            "X-Timestamp": timestamp,
          },
          body: "{}",
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired chatglm.cn refresh token — re-copy your cookies." };
      }
      case "perplexity-web": {
        let sessionToken = connection.apiKey;
        if (sessionToken.startsWith("__Secure-next-auth.session-token=")) sessionToken = sessionToken.slice("__Secure-next-auth.session-token=".length);
        const res = await fetchWithConnectionProxy("https://www.perplexity.ai/api/auth/session", {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Cookie: `__Secure-next-auth.session-token=${sessionToken}`,
          },
        }, effectiveProxy);
        if (!res.ok) return { valid: false, error: "Invalid session cookie" };
        const data = await res.json().catch(() => null);
        const valid = !!(data && data.user);
        return { valid, error: valid ? null : "Session expired — re-paste cookie" };
      }
      case "opencode-go": {
        const res = await fetchWithConnectionProxy("https://opencode.ai/zen/go/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.apiKey}` },
          body: JSON.stringify({ model: getDefaultModel("opencode-go"), messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "xiaomi-mimo":
      case "xiaomi-tokenplan": {
        const baseUrls = { "xiaomi-mimo": "https://api.xiaomimimo.com/v1", "xiaomi-tokenplan": "https://token-plan-sgp.xiaomimimo.com/v1" };
        const res = await fetchWithConnectionProxy(`${baseUrls[connection.provider]}/models`, {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
        }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "blackbox": {
        const baseUrl = PROVIDERS["blackbox"]?.baseUrl?.replace(/\/chat\/completions$/, "") || "https://api.blackbox.ai/v1";
        const res = await fetchWithConnectionProxy(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
        }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "deepseek-web": {
        let userToken = connection.apiKey;
        try { const p = JSON.parse(connection.apiKey); if (typeof p?.value === "string") userToken = p.value; } catch { /* bare */ }
        const res = await fetchWithConnectionProxy("https://chat.deepseek.com/api/v0/users/current", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${userToken}`,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            Origin: "https://chat.deepseek.com", Referer: "https://chat.deepseek.com/",
            "X-App-Version": "20241129.1", "X-Client-Platform": "web", "X-Client-Version": "1.8.0",
          },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired userToken" };
      }
      case "qwen-web": {
        let token = connection.apiKey;
        const tMatch = connection.apiKey.match(/(?:^|;\s*)token=([^;\s]+)/);
        if (tMatch) token = tMatch[1];
        else if (connection.apiKey.includes("=")) token = "";
        if (!token && connection.apiKey.includes("=")) return { valid: false, error: "No 'token' cookie found — copy the full Cookie header from chat.qwen.ai" };
        const res = await fetchWithConnectionProxy("https://chat.qwen.ai/api/v2/chats/new", {
          method: "POST",
          headers: {
            "Content-Type": "application/json", Authorization: `Bearer ${token}`,
            Cookie: connection.apiKey.startsWith("Cookie:") ? connection.apiKey.slice(7).trim() : connection.apiKey,
            "bx-v": "2.5.36", source: "web", version: "0.2.66", "x-request-id": crypto.randomUUID(),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Origin: "https://chat.qwen.ai", Referer: "https://chat.qwen.ai/",
          },
          body: JSON.stringify({ title: "New Chat", models: ["qwen3.7-max"], chat_mode: "normal", chat_type: "t2t", timestamp: Date.now() }),
        }, effectiveProxy);
        const ct = res.headers.get("content-type") || "";
        const valid = res.status !== 401 && res.status !== 403 && !ct.includes("text/html");
        return { valid, error: valid ? null : "Qwen WAF rejected the cookies — re-copy the FULL cookie string from chat.qwen.ai" };
      }
      case "kimi-web": {
        let jwt = connection.apiKey.replace(/^Cookie:\s*/i, "").replace(/^bearer\s+/i, "");
        const m = jwt.match(/(?:^|[\s;])kimi-auth=([^;\s]+)/);
        if (m) jwt = m[1];
        const res = await fetchWithConnectionProxy("https://www.kimi.com/api/auth/session", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${jwt}`, Cookie: `kimi-auth=${jwt}`,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Referer: "https://www.kimi.com/", Origin: "https://www.kimi.com",
          },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired kimi-auth token" };
      }
      case "blackbox-web": {
        let cookieHeader = connection.apiKey.replace(/^Cookie:\s*/i, "");
        if (!cookieHeader.includes("=")) cookieHeader = `next-auth.session-token=${cookieHeader}`;
        const res = await fetchWithConnectionProxy("https://app.blackbox.ai/api/auth/session", {
          method: "GET",
          headers: { Accept: "application/json", Cookie: cookieHeader, "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" },
        }, effectiveProxy);
        if (!res.ok) return { valid: false, error: "Invalid or expired session cookie" };
        const data = await res.json().catch(() => null);
        const valid = !!(data && data.user && data.user.email);
        return { valid, error: valid ? null : "Session cookie accepted but no user — cookie may be expired" };
      }
      case "t3-web": {
        const res = await fetchWithConnectionProxy("https://t3.chat/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json", Cookie: connection.apiKey.replace(/^Cookie:\s*/i, ""),
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Referer: "https://t3.chat/", Origin: "https://t3.chat",
          },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: false }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Session expired — re-paste t3.chat cookies (incl. convex-session-id)" };
      }
      case "duckduckgo-web": {
        const res = await fetchWithConnectionProxy("https://duckduckgo.com/duckchat/v1/status", {
          method: "GET",
          headers: { "x-vqd-accept": "1", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" },
        }, effectiveProxy);
        const valid = res.status !== 403 && res.status < 500;
        return { valid, error: valid ? null : "DuckDuckGo AI Chat is currently blocking requests" };
      }
      case "venice-web": {
        const res = await fetchWithConnectionProxy("https://venice.ai/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json", Accept: "application/json",
            Cookie: connection.apiKey.replace(/^Cookie:\s*/i, ""),
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Referer: "https://venice.ai/", Origin: "https://venice.ai",
          },
          body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], model: "llama-3.1-405b", stream: false, max_tokens: 1 }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired venice.ai session cookie" };
      }
      case "doubao-web": {
        const res = await fetchWithConnectionProxy("https://www.doubao.com/samantha/contact/list", {
          method: "GET",
          headers: {
            Cookie: connection.apiKey.replace(/^Cookie:\s*/i, ""),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Referer: "https://www.doubao.com/",
          },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired doubao.com session cookie" };
      }
      case "v0-vercel-web": {
        const res = await fetchWithConnectionProxy("https://v0.dev/api/auth/session", {
          method: "GET",
          headers: { Cookie: connection.apiKey.replace(/^Cookie:\s*/i, ""), "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired v0.dev session cookie" };
      }
      case "poe-web": {
        // Forward the full cookie jar (cf_clearance + poe-tchannel required by Cloudflare).
        const rawPb = connection.apiKey.replace(/^Cookie:\s*/i, "");
        let cookieHeader;
        if (rawPb.includes("p-b=") && rawPb.includes(";")) {
          cookieHeader = rawPb;
        } else {
          const pm = rawPb.match(/p-b=([^;]+)/);
          let pb = pm ? pm[1] : rawPb;
          try { pb = decodeURIComponent(pb); } catch { /* not encoded */ }
          cookieHeader = `p-b=${pb}`;
        }
        const res = await fetchWithConnectionProxy("https://www.poe.com/api/gql_POST", {
          method: "POST",
          headers: {
            "Content-Type": "application/json", Accept: "application/json", Cookie: cookieHeader,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Referer: "https://www.poe.com/", Origin: "https://www.poe.com",
          },
          body: JSON.stringify({ operationName: "ChatViewQuery", query: "query ChatViewQuery { viewer { id } }", variables: {} }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired p-b cookie — re-copy the FULL cookie string (needs cf_clearance)" };
      }
      case "copilot-web": {
        let token = connection.apiKey.trim();
        const am = token.match(/access_token=([^;]+)/); if (am) token = am[1];
        const bm = token.match(/[Bb]earer\s+(.+)/); if (bm) token = bm[1].trim();
        const res = await fetchWithConnectionProxy("https://copilot.microsoft.com/c/api/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
            Origin: "https://copilot.microsoft.com", Referer: "https://copilot.microsoft.com/",
          },
          body: JSON.stringify({ timeZone: "America/New_York", startNewConversation: true }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired Copilot access token" };
      }
      case "muse-spark-web": {
        let cookie = connection.apiKey.replace(/^Cookie:\s*/i, "").replace(/^bearer\s+/i, "");
        if (!cookie.includes("=")) cookie = `ecto_1_sess=${cookie}`;
        const res = await fetchWithConnectionProxy("https://www.meta.ai/api/graphql/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json", Cookie: cookie,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Origin: "https://www.meta.ai", Referer: "https://www.meta.ai/",
          },
          body: JSON.stringify({ query: "{ viewer { id } }" }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired ecto_1_sess cookie" };
      }
      case "adapta-web": {
        let jwt = connection.apiKey.trim();
        if (jwt.includes("=") && !jwt.startsWith("eyJ")) jwt = jwt.slice(jwt.indexOf("=") + 1).trim();
        const res = await fetchWithConnectionProxy("https://clerk.agent.adapta.one/v1/client", {
          method: "GET",
          headers: { Cookie: `__client=${jwt}`, "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36", Origin: "https://agent.adapta.one" },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired __client cookie" };
      }
      case "veoaifree-web": {
        const res = await fetchWithConnectionProxy("https://veoaifree.com", {
          method: "GET",
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" },
        }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "veoaifree.com is unreachable or rate-limited" };
      }
      case "claude-web": {
        let cookie = connection.apiKey.replace(/^cookie\s*:\s*/i, "");
        if (!/sessionKey\s*=/.test(cookie) && !cookie.includes("=")) cookie = `sessionKey=${cookie}`;
        const res = await fetchWithConnectionProxy("https://claude.ai/api/organizations", {
          method: "GET",
          headers: {
            "Content-Type": "application/json", Cookie: cookie, "anthropic-client-platform": "web_claude_ai",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Origin: "https://claude.ai", Referer: "https://claude.ai/",
          },
        }, effectiveProxy);
        if (res.status === 401) return { valid: false, error: "Invalid or expired sessionKey" };
        if (res.status === 403) return { valid: true, error: "Cloudflare blocked the probe (HTTP 403) — cookie may still be valid but chat may be blocked without TLS impersonation" };
        return { valid: true, error: null };
      }
      case "chatgpt-web": {
        let cookie = connection.apiKey.replace(/^cookie\s*:\s*/i, "");
        if (!/__Secure-next-auth\.session-token\s*=/.test(cookie) && !cookie.includes("=")) {
          cookie = `__Secure-next-auth.session-token=${cookie}`;
        }
        const res = await fetchWithConnectionProxy("https://chatgpt.com/api/auth/session", {
          method: "GET",
          headers: { Accept: "application/json", Cookie: cookie, "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" },
        }, effectiveProxy);
        if (res.status === 401 || res.status === 403) return { valid: false, error: "Invalid or expired session cookie" };
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const valid = !!(data && data.accessToken);
          return { valid, error: valid ? null : "Session cookie accepted but no accessToken — cookie likely expired" };
        }
        return { valid: true, error: null };
      }
      case "gemini-web": {
        if (!/__Secure-1PSID\s*=/.test(connection.apiKey) || !/__Secure-1PSIDTS\s*=/.test(connection.apiKey)) {
          return { valid: false, error: "Missing required Google cookies — copy the FULL cookie string (must include __Secure-1PSID and __Secure-1PSIDTS)" };
        }
        const cookie = connection.apiKey.replace(/^cookie\s*:\s*/i, "");
        const res = await fetchWithConnectionProxy("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", Accept: "*/*", Cookie: cookie,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Origin: "https://gemini.google.com", Referer: "https://gemini.google.com/app/",
          },
          body: new URLSearchParams({ "f.req": JSON.stringify([null, "[\"hi\"]"]), at: "" }).toString(),
        }, effectiveProxy);
        if (res.status === 401) return { valid: false, error: "Invalid Google cookies" };
        if (res.status === 403) return { valid: true, error: "Google blocked the probe (HTTP 403) — cookies may still be valid; Gemini requires a real browser fingerprint" };
        return { valid: true, error: null };
      }
      case "huggingchat": {
        // hf-chat cookie (bare value or full cookie blob).
        let cookie = connection.apiKey.replace(/^Cookie:\s*/i, "");
        if (!cookie.includes("=")) cookie = `hf-chat=${cookie}`;
        const res = await fetchWithConnectionProxy("https://huggingface.co/chat/settings", {
          method: "GET",
          headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired hf-chat cookie" };
      }
      case "lmarena": {
        // LMArena session cookie (arena-auth-prod-v1.0 + chunks, or full Cookie header).
        const cookie = connection.apiKey.replace(/^Cookie:\s*/i, "");
        const res = await fetchWithConnectionProxy("https://arena.ai/api/user", {
          method: "GET",
          headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired LMArena session cookie" };
      }
      case "puter": {
        // puter_auth_token (bare token, Bearer prefix, or full cookie string).
        let token = connection.apiKey.trim();
        const am = token.match(/puter_auth_token=([^;]+)/); if (am) token = am[1];
        const bm = token.match(/[Bb]earer\s+(.+)/); if (bm) token = bm[1].trim();
        const res = await fetchWithConnectionProxy("https://api.puter.com/whoami", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired Puter auth token" };
      }
      case "pollinations": {
        // No-auth by default — validate reachability of the gateway.
        const res = await fetchWithConnectionProxy("https://gen.pollinations.ai/v1/models", {
          method: "GET",
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" },
        }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Pollinations gateway is unreachable" };
      }
      case "cody": {
        const res = await fetchWithConnectionProxy("https://sourcegraph.com/.api/llm/models", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${connection.apiKey}`,
            "X-Requested-With": "Sourcegraph-Editor",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
          },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid Cody access token" };
      }
      case "trae": {
        let token = connection.apiKey.trim();
        const tm = token.match(/Cloud-IDE-JWT\s+(.+)/i); if (tm) token = tm[1].trim();
        const res = await fetchWithConnectionProxy("https://core-normal.trae.ai/api/remote/v1/models?functions=solo_agent_remote,solo_work_remote", {
          method: "GET",
          headers: {
            Authorization: `Cloud-IDE-JWT ${token}`,
            "Content-Type": "application/json",
            "X-Trae-Client-Type": "web",
            Referer: "https://solo.trae.ai/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
          },
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid or expired Cloud-IDE-JWT" };
      }
      case "windsurf": {
        const token = connection.apiKey.trim();
        const valid = token.length >= 16;
        return { valid, error: valid ? null : "Token too short — re-copy the sk-ws-... token" };
      }
      default:
        return { valid: false, error: "Provider test not supported" };
    }
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Test a single connection by ID, update DB, and return result.
 */
export async function testSingleConnection(id) {
  const connection = await getProviderConnectionById(id);
  if (!connection) return { valid: false, error: "Connection not found", latencyMs: 0, testedAt: new Date().toISOString() };

  const effectiveProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

  if (effectiveProxy.connectionProxyEnabled && effectiveProxy.connectionProxyUrl && !effectiveProxy.vercelRelayUrl) {
    const proxyResult = await testProxyUrl({ proxyUrl: effectiveProxy.connectionProxyUrl });
    if (!proxyResult.ok) {
      const proxyError = proxyResult.error || `Proxy test failed with status ${proxyResult.status}`;
      await updateProviderConnection(id, {
        testStatus: "error",
        lastError: proxyError,
        lastErrorAt: new Date().toISOString(),
      });
      return { valid: false, error: proxyError, latencyMs: 0, testedAt: new Date().toISOString() };
    }
  }

  const start = Date.now();
  let result;

  if (connection.authType === "apikey" || connection.authType === "cookie") {
    result = await testApiKeyConnection(connection, effectiveProxy);
  } else {
    result = await testOAuthConnection(connection, effectiveProxy);
  }

  const latencyMs = Date.now() - start;

  const updateData = {
    testStatus: result.valid ? "active" : "error",
    lastError: result.valid ? null : result.error,
    lastErrorAt: result.valid ? null : new Date().toISOString(),
  };

  if (result.refreshed && result.newTokens) {
    if (result.newTokens.accessToken) updateData.accessToken = result.newTokens.accessToken;
    if (result.newTokens.refreshToken) updateData.refreshToken = result.newTokens.refreshToken;
    if (result.newTokens.idToken) updateData.idToken = result.newTokens.idToken;
    if (result.newTokens.lastRefreshAt) updateData.lastRefreshAt = result.newTokens.lastRefreshAt;
    if (result.newTokens.expiresIn) updateData.expiresIn = result.newTokens.expiresIn;
    if (result.newTokens.expiresIn) {
      updateData.expiresAt = new Date(Date.now() + result.newTokens.expiresIn * 1000).toISOString();
    } else if (result.newTokens.expiresAt) {
      updateData.expiresAt = result.newTokens.expiresAt;
    }
    if (result.newTokens.providerSpecificData) {
      updateData.providerSpecificData = {
        ...(connection.providerSpecificData || {}),
        ...result.newTokens.providerSpecificData,
      };
    }
  }

  await updateProviderConnection(id, updateData);

  return { valid: result.valid, error: result.error, refreshed: !!result.refreshed, latencyMs, testedAt: new Date().toISOString() };
}
