// OpenVecta — pay-per-use AI inference gateway (openvecta.com).
//
// OpenAI-compatible /v1/chat/completions and /v1/models endpoints behind a single
// Bearer key. Hosts ~17 LLMs (GLM, Claude Sonnet, DeepSeek, GPT OSS, Llama 4, Kimi
// K2, Nemotron, …) + text-embedding models. Free signup credits available.
//
// No custom executor needed — DefaultExecutor handles OpenAI-compatible APIs.
// The seed model list below is the offline fallback; live model discovery at
// runtime via /v1/models is handled by the existing NAMED_OPENAI_STYLE_PROVIDERS
// live-fetch path (configured in /api/providers/[id]/models route).
export default {
  id: "openvecta",
  priority: 310,
  alias: "openvecta",
  aliases: ["ov"],
  uiAlias: "ov",
  display: {
    name: "OpenVecta",
    icon: "hub",
    color: "#7C3AED",
    textIcon: "OV",
    website: "https://openvecta.com",
    notice: {
      signupUrl: "https://openvecta.com",
      apiKeyUrl: "https://openvecta.com",
      text: "OpenVecta is a pay-per-use AI inference gateway. Sign up at openvecta.com for free credits, then paste your API key. OpenAI-compatible — works with any OpenAI-format client. ~17 LLMs + embeddings available.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://openvecta.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://openvecta.com/v1/models",
  },
  // Seed catalog — offline fallback when live /v1/models fetch fails.
  // Context lengths from OpenVecta's public catalog.
  models: [
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B" },
    { id: "gemma-4-31b", name: "Gemma 4 31B" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct" },
    { id: "llama-4-maverick", name: "Llama 4 Maverick" },
    { id: "nemotron-3-super-120b", name: "Nemotron 3 Super 120B" },
  ],
  passthroughModels: true,
};
