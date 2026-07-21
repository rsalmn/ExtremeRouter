// Forge Workspace (Forge AI) — AI model gateway (forge-ai.space).
//
// OpenAI-compatible API with tier-based model access:
//   - FREE tier: 32 models (GPT-5.6, Claude, DeepSeek, Kimi, Gemini, Grok, etc.)
//   - PRO tier: +1 model (Claude Fable 5)
//
// The standard /v1/models endpoint auto-filters by the API key's tier, so
// live model discovery naturally shows only accessible models.
// The /v1/models-rates endpoint provides full tier + pricing metadata.
//
// No custom executor needed — DefaultExecutor handles OpenAI-compatible APIs.
export default {
  id: "forge",
  priority: 310,
  alias: "forge",
  aliases: ["fg", "forgeai"],
  uiAlias: "fg",
  display: {
    name: "Forge Workspace",
    icon: "local_fire_department",
    color: "#FF6B35",
    textIcon: "FG",
    website: "https://www.forge-ai.space/",
    notice: {
      signupUrl: "https://www.forge-ai.space/?ref=ref-a556c7a8",
      apiKeyUrl: "https://www.forge-ai.space/?ref=ref-a556c7a8",
      text: "Forge Workspace is an AI model gateway with 33+ models across FREE and PRO tiers. Sign up for free credits at forge-ai.space, then paste your API key. OpenAI-compatible — works with any OpenAI-format client.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://forge-gateway-api.fly.dev/v1/chat/completions",
    format: "openai",
    validateUrl: "https://forge-gateway-api.fly.dev/v1/models",
  },
  // Seed catalog — offline fallback when live /v1/models fetch fails.
  // Models grouped by upstream provider for discoverability.
  // Tier metadata: FREE models available to all keys, PRO requires upgrade.
  // The /v1/models endpoint auto-filters by the API key's tier at runtime.
  models: [
    // OpenAI (FREE)
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 1050000, tier: "FREE" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", contextWindow: 1050000, tier: "FREE" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", contextWindow: 1050000, tier: "FREE" },
    { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 128000, tier: "FREE" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", contextWindow: 400000, tier: "FREE" },
    // Anthropic (FREE)
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 1000000, tier: "FREE" },
    { id: "claude-sonnet-4-6-thinking", name: "Claude Sonnet 4.6 Thinking", contextWindow: 1000000, tier: "FREE" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: 1000000, tier: "FREE" },
    { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", contextWindow: 200000, tier: "FREE" },
    { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", contextWindow: 200000, tier: "FREE" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextWindow: 200000, tier: "FREE" },
    // Anthropic (PRO)
    { id: "claude-fable-5", name: "Claude Fable 5", contextWindow: 1000000, tier: "PRO" },
    // xAI (FREE)
    { id: "grok-4.5", name: "Grok 4.5", contextWindow: 500000, tier: "FREE" },
    { id: "grok-4.3", name: "Grok 4.3", contextWindow: 1000000, tier: "FREE" },
    { id: "grok-build-0.1", name: "Grok Build 0.1", contextWindow: 256000, tier: "FREE" },
    // DeepSeek (FREE)
    { id: "deepseek-r1", name: "DeepSeek R1", contextWindow: 128000, tier: "FREE" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: 1000000, tier: "FREE" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 1000000, tier: "FREE" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2", contextWindow: 163000, tier: "FREE" },
    { id: "deepseek-v3.1", name: "DeepSeek V3.1", contextWindow: 128000, tier: "FREE" },
    { id: "deepseek-v3", name: "DeepSeek V3", contextWindow: 128000, tier: "FREE" },
    // Kimi (FREE)
    { id: "kimi-k3", name: "Kimi K3", contextWindow: 1000000, tier: "FREE" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", contextWindow: 1000000, tier: "FREE" },
    { id: "kimi-k2.6", name: "Kimi K2.6", contextWindow: 1000000, tier: "FREE" },
    { id: "kimi-k2.5", name: "Kimi K2.5", contextWindow: 1000000, tier: "FREE" },
    // Gemini (FREE)
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview", contextWindow: 1000000, tier: "FREE" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", contextWindow: 1000000, tier: "FREE" },
    // Others (FREE)
    { id: "tencent/hy3", name: "Tencent HY3", contextWindow: 1000000, tier: "FREE" },
    { id: "mimo-v2.5", name: "MiMo V2.5", contextWindow: 1000000, tier: "FREE" },
    { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", contextWindow: 1000000, tier: "FREE" },
    { id: "MiniMax-M3", name: "MiniMax M3", contextWindow: 1000000, tier: "FREE" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5", contextWindow: 1000000, tier: "FREE" },
    { id: "glm-5.2", name: "GLM 5.2", contextWindow: 1000000, tier: "FREE" },
  ],
  // Live model discovery: /v1/models auto-filters by API key tier.
  // FREE key → 32 models, PRO key → 33 models (+ Claude Fable 5).
  modelsFetcher: {
    url: "https://forge-gateway-api.fly.dev/v1/models",
    type: "openai",
  },
  // Forge supports reasoning via "thinking": true in the request body.
  // thinkingConfig enables the thinking level picker in the UI for all models.
  thinkingConfig: {
    options: ["auto", "none", "max"],
    defaultMode: "auto",
  },
  passthroughModels: true,
};
