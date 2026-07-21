// Huancheng Public API (hcnsec) — Xinjiang Huancheng Cybersecurity public LLM
// API platform. OpenAI-compatible /v1 endpoints behind a single API key.
//
// Free credits available with daily check-ins. Models discovered live via
// /v1/models at runtime (passthroughModels + empty seed catalog).
//
// Port of OmniRoute commit 437ca488 (PR #6410).
export default {
  id: "hcnsec",
  priority: 330,
  alias: "hcnsec",
  aliases: ["hc"],
  uiAlias: "hc",
  display: {
    name: "Huancheng Public API",
    icon: "security",
    color: "#0EA5E9",
    textIcon: "HC",
    website: "https://api.hcnsec.cn",
    notice: {
      signupUrl: "https://api.hcnsec.cn/sign-up?aff=ZKgv",
      apiKeyUrl: "https://api.hcnsec.cn/sign-up?aff=ZKgv",
      text: "Xinjiang Huancheng Cybersecurity public LLM API platform. Free credits with daily check-ins. Create an API key at api.hcnsec.cn, then paste it here. OpenAI-compatible — works with any OpenAI-format client.",
    },
  },
  category: "freeTier",
  hasFree: true,
  authType: "apikey",
  transport: {
    baseUrl: "https://api.hcnsec.cn/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.hcnsec.cn/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  // Seed catalog — offline fallback when live /v1/models fetch fails.
  // Typical models available on HCNSEC platform (exact catalog varies by API key).
  // Live discovery via modelsFetcher provides the real-time list.
  models: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "deepseek-v3", name: "DeepSeek V3" },
    { id: "glm-5", name: "GLM 5" },
  ],
  passthroughModels: true,
  modelsFetcher: {
    url: "https://api.hcnsec.cn/v1/models",
    type: "openai",
  },
};
