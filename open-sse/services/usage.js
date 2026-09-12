/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { getGitHubUsage } from "./usage/github.js";
import { getGeminiUsage, getAntigravityUsage } from "./usage/google.js";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage, consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "./usage/codex.js";

export { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits };
import { getKiroUsage } from "./usage/kiro.js";
import { getMiniMaxUsage } from "./usage/minimax.js";
import { getCodeBuddyCnUsage, getCodebuddyUsage } from "./usage/codebuddy-cn.js";
import {
  getQwenUsage,
  getIflowUsage,
  getGlmUsage,
  getVercelAiGatewayUsage,
  getQoderUsage,
} from "./usage/misc.js";
import { getOllamaUsage } from "./usage/ollama.js";
import { resolveQoderCredentials } from "./qoderModels.js";
import { getXaiUsage } from "./usage/xai.js";
import { getTokenRouterUsage } from "./usage/tokenrouter.js";
import { getClineUsage } from "./usage/cline.js";
import { getGrokWebUsage } from "./usage/grok-web.js";
import { getInfronUsage } from "./usage/infron.js";
import { getKimchiUsage } from "./usage/kimchi.js";
import { getKimiDesktopUsage } from "./usage/kimi-desktop.js";
import { getZedUsage } from "./usage/zed.js";
import { getXkiroUsage } from "./usage/xkiro.js";
import { getXiaomiMimoUsage } from "./usage/xiaomi-mimo.js";

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
// provider → usage handler (ctx carries every arg each handler needs)
const USAGE_HANDLERS = {
  github: (c) => getGitHubUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  "gemini-cli": (c) => getGeminiUsage(c.accessToken, c.providerDataWithProjectId, c.proxyOptions),
  antigravity: (c) => getAntigravityUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  claude: (c) => getClaudeUsage(c.accessToken, c.proxyOptions),
  codex: (c) => getCodexUsage(c.accessToken, c.proxyOptions),
  kiro: (c) => getKiroUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  qoder: async (c) => {
    // PAT connections need the job-token exchange before quota can be read.
    const resolved = await resolveQoderCredentials(c, c.proxyOptions).catch(() => null);
    return getQoderUsage(resolved?.accessToken || c.accessToken, c.proxyOptions);
  },
  qwen: (c) => getQwenUsage(c.accessToken, c.providerSpecificData),
  iflow: (c) => getIflowUsage(c.accessToken),
  ollama: (c) => getOllamaUsage(c.apiKey, c.proxyOptions),
  glm: (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  "glm-cn": (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  // ZCode: connection.apiKey holds the Start Plan JWT — the quota endpoint
  // needs the derived coding key ("id.secret") instead (absent on
  // Start-Plan-only accounts → soft "key invalid" message).
  zcode: (c) => getGlmUsage(c.providerSpecificData?.codingApiKey || c.apiKey, c.provider, c.proxyOptions),
  minimax: (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "minimax-cn": (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "vercel-ai-gateway": (c) => getVercelAiGatewayUsage(c.apiKey, c.proxyOptions),
  "codebuddy-cn": (c) => getCodeBuddyCnUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  "codebuddy-intl": (c) => getCodebuddyUsage("codebuddy-intl", c.accessToken, c.apiKey, c.proxyOptions),
  workbuddy: (c) => getCodebuddyUsage("workbuddy", c.accessToken, c.apiKey, c.proxyOptions),
  // Pass full connection context so xAI can aggregate local usageHistory by
  // connectionId when the (removed) public billing API is unavailable.
  xai: (c) => getXaiUsage(c, c.proxyOptions),
  tokenrouter: (c) => getTokenRouterUsage(c, c.providerSpecificData, c.proxyOptions),
  // Cline + ClinePass share the same upstream host and plan-limits endpoint;
  // a single handler serves both providers.
  cline: (c) => getClineUsage({ accessToken: c.accessToken, apiKey: c.apiKey }, c.proxyOptions),
  clinepass: (c) => getClineUsage({ accessToken: c.accessToken, apiKey: c.apiKey }, c.proxyOptions),
  "grok-web": (c) => getGrokWebUsage({ apiKey: c.apiKey }, c.proxyOptions),
  infron: (c) => getInfronUsage({ apiKey: c.apiKey }, c.proxyOptions),
  kimchi: (c) => getKimchiUsage(c.accessToken, c.proxyOptions),
  // kimi-desktop stores the kimi-auth JWT as apiKey (oauth import route)
  "kimi-desktop": (c) => getKimiDesktopUsage(c.apiKey, c.proxyOptions),
  // Zed: plan + edit-prediction quota from /client/users/me. refreshToken is
  // the long-lived USER token (accessToken is the short-lived LLM token).
  zed: (c) => getZedUsage(c.accessToken, c.providerSpecificData, c.proxyOptions, c.refreshToken),
  // xKiro: the same sk-xt- key used for chat reads /v1/usage (free endpoint).
  xkiro: (c) => getXkiroUsage({ apiKey: c.apiKey, accessToken: c.accessToken }, c.proxyOptions),
  // xiaomi-mimo: weekly quota from the Xiaomi account session (mimoPassToken in
  // providerSpecificData, else the local Desktop cookie store). The sk- key
  // alone cannot read it.
  "xiaomi-mimo": (c) => getXiaomiMimoUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
};

export async function getUsageForProvider(connection, proxyOptions = null) {
  const { provider, accessToken, apiKey, refreshToken, providerSpecificData, projectId, id } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  // connectionId/id lets handlers that lack a remote billing API (xAI) aggregate
  // local usageHistory spend for the specific connection card.
  return await handler({
    provider,
    accessToken,
    apiKey,
    refreshToken,
    providerSpecificData,
    providerDataWithProjectId,
    proxyOptions,
    connectionId: id || connection.connectionId || null,
    id: id || null,
  });
}
