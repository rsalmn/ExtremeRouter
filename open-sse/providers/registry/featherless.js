// Featherless — HuggingFace model hosting via OpenAI-compatible API.
//
// Featherless provides access to 46,000+ open-source models hosted on
// HuggingFace infrastructure through a single OpenAI-compatible endpoint.
// Models include Llama, Qwen, Gemma, Mistral, DeepSeek, Phi, and many more.
//
// Endpoint: POST https://api.featherless.ai/v1/chat/completions
// Models:   GET  https://api.featherless.ai/v1/models
// Auth: Bearer <featherless-...>
//
// No custom executor needed — DefaultExecutor handles OpenAI-compatible APIs.
// Model discovery at runtime via modelsFetcher (live /v1/models endpoint).
export default {
  id: "featherless",
  priority: 290,
  alias: "featherless",
  aliases: ["fl"],
  uiAlias: "fl",
  display: {
    name: "Featherless",
    icon: "flutter_dash",
    color: "#FF6B35",
    textIcon: "FL",
    website: "https://featherless.ai",
    notice: {
      signupUrl: "https://featherless.ai",
      apiKeyUrl: "https://featherless.ai/account/api-keys",
      text: "Featherless hosts 46,000+ open-source models from HuggingFace. Get a key at featherless.ai/account/api-keys. OpenAI-compatible — works with any standard client. Models are auto-discovered at runtime.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.featherless.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.featherless.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.featherless.ai/v1/models?available_on_current_plan=true&per_page=100", type: "openai" },
  // Seed models — offline fallback + popular picks. Full list discoverable at runtime.
  models: [
    { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B" },
    { id: "meta-llama/Meta-Llama-3.1-70B-Instruct", name: "Llama 3.1 70B" },
    { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen 2.5 7B" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
    { id: "google/gemma-2-9b-it", name: "Gemma 2 9B" },
    { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B v0.3" },
    { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", name: "Mixtral 8x7B" },
    { id: "deepseek-ai/deepseek-llm-7b-chat", name: "DeepSeek LLM 7B Chat" },
    { id: "microsoft/Phi-3.5-mini-instruct", name: "Phi 3.5 Mini" },
  ],
  passthroughModels: true,
};
