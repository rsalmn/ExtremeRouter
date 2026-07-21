// TokenRouter — AI model gateway (tokenrouter.com).
//
// OpenAI-compatible /v1/chat/completions behind a single `sk-` API key.
// Hosts Claude, GPT, Gemini, Kimi, DeepSeek, GLM and many other models — the
// catalog is exposed via /v1/models (live discovery).
//
// Quota tracking is supported via the management API. The user pastes BOTH:
//   - chat API key (sk-...) → used for /v1 chat completions
//   - management key         → stored in providerSpecificData.mgmtKey, used for
//                              /api/management/self/wallet (Quota Tracker)
//
// No custom executor needed — DefaultExecutor handles OpenAI-compatible APIs.
export default {
  id: "tokenrouter",
  priority: 320,
  alias: "tokenrouter",
  aliases: ["tr"],
  uiAlias: "tr",
  display: {
    name: "TokenRouter",
    icon: "router",
    color: "#10B981",
    textIcon: "TR",
    website: "https://api.tokenrouter.com",
    notice: {
      signupUrl: "https://api.tokenrouter.com",
      apiKeyUrl: "https://api.tokenrouter.com",
      text: "TokenRouter is an AI model gateway with Claude, GPT, Gemini, Kimi, DeepSeek, GLM and more. Create an API key at api.tokenrouter.com, then paste it here. OpenAI-compatible — works with any OpenAI-format client. For Quota Tracker, also paste your management key (separate from the chat sk- key).",
    },
  },
  category: "apikey",
  authType: "apikey",
  // BOTH flags are required: `usage` gates USAGE_SUPPORTED_PROVIDERS (the
  // general list shown in the Quota UI), `usageApikey` gates
  // USAGE_APIKEY_PROVIDERS (api-key providers allowed past the authType check
  // in /api/providers/client route.js isUsageEligible).
  features: { usage: true, usageApikey: true },
  transport: {
    baseUrl: "https://api.tokenrouter.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.tokenrouter.com/v1/models",
    // Quota Tracker endpoints (require the management key, NOT the chat key).
    usage: {
      walletUrl: "https://api.tokenrouter.com/api/management/self/wallet",
    },
  },
  // Live discovery only — /v1/models auto-filters by the API key's tier.
  // Empty seed list; passthroughModels allows any model id.
  models: [],
  passthroughModels: true,
  modelsFetcher: {
    url: "https://api.tokenrouter.com/v1/models",
    type: "openai",
  },
};
