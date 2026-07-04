// Puter — FREE AI gateway exposing 500+ models (GPT, Claude, Gemini, Grok,
// DeepSeek, Qwen, Mistral, Llama...) through a single OpenAI-compatible endpoint.
//
// Puter is a free, user-pays (via free account) AI service — not a scraped web
// cookie flow like grok-web/chatglm-cn. It authenticates with a Bearer auth token
// obtained from puter.com/dashboard ("Copy Auth Token"). Auth can also be carried
// as the `puter_auth_token` cookie, so the PuterExecutor accepts either the bare
// token or a full cookie string.
//
// Endpoint: https://api.puter.com/puterai/openai/v1/chat/completions
// Auth:     Bearer <puter_auth_token>  (from puter.com/dashboard → Copy Auth Token)
// Docs:     https://docs.puter.com/AI/
//
// Only chat completions (with streaming SSE) are available via REST. Image
// generation, TTS, STT and video are puter.js SDK-only features and are skipped.
export default {
  id: "puter",
  priority: 60,
  alias: "puter",
  uiAlias: "puter",
  display: {
    name: "Puter AI",
    icon: "cloud_circle",
    color: "#6366F1",
    textIcon: "PU",
    website: "https://puter.com",
    notice: {
      signupUrl: "https://puter.com",
      apiKeyUrl: "https://puter.com/dashboard",
      text: "Puter is FREE AI. Log in at puter.com, then open the dashboard and click \"Copy Auth Token\" (or copy your puter_auth_token cookie). Paste the token here — it works as a Bearer credential. Puter exposes 500+ models (GPT, Claude, Gemini, Grok, DeepSeek, Qwen, Mistral, Llama...) through one OpenAI-compatible endpoint. Model IDs use provider/model-name format for non-OpenAI models. Only chat completions (with streaming) are available via REST.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your Puter auth token (from puter.com/dashboard → Copy Auth Token) or your puter_auth_token cookie value.",
  transport: {
    baseUrl: "https://api.puter.com/puterai/openai/v1/chat/completions",
    format: "puter",
    authType: "cookie",
  },
  // Catalog sourced from OmniRoute. Puter accepts model IDs directly from its
  // catalog (provider/model-name format for non-OpenAI models). No aliasing needed.
  models: [
    // OpenAI — bare IDs
    { id: "gpt-5.5", name: "GPT-5.5 (Puter)" },
    { id: "gpt-5.4", name: "GPT-5.4 (Puter)" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini (Puter)" },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano (Puter)" },
    { id: "gpt-4o", name: "GPT-4o (Puter)" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini (Puter)" },
    { id: "o3", name: "OpenAI o3 (Puter)" },
    // Anthropic Claude — bare IDs
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (Puter)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Puter)" },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7 (Puter)" },
    // Google Gemini — google/ prefix
    { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash (Puter)" },
    { id: "google/gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite (Puter)" },
    { id: "google/gemini-3-flash", name: "Gemini 3 Flash (Puter)" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Puter)" },
    // DeepSeek — deepseek/ prefix (reasoning)
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (Puter)", supportsReasoning: true },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash (Puter)", supportsReasoning: true },
    // xAI Grok — x-ai/ prefix
    { id: "x-ai/grok-4.3", name: "Grok 4.3 (Puter)" },
    { id: "x-ai/grok-4.20", name: "Grok 4.20 (Puter)" },
    // Meta Llama — bare IDs
    { id: "llama-4-scout", name: "Llama 4 Scout (Puter)" },
    { id: "llama-4-maverick", name: "Llama 4 Maverick (Puter)" },
    { id: "llama-3.3-70b-instruct", name: "Llama 3.3 70B (Puter)" },
    // Mistral — bare IDs
    { id: "mistral-small-2603", name: "Mistral Small 4 (Puter)" },
    { id: "mistral-medium-3-5", name: "Mistral Medium 3.5 (Puter)" },
    { id: "mistral-large-2512", name: "Mistral Large (Puter)" },
    { id: "devstral-2512", name: "Devstral 2 (Puter)" },
    { id: "codestral-2508", name: "Codestral (Puter)" },
    { id: "mistral-nemo", name: "Mistral Nemo (Puter)" },
    // Qwen — qwen/ prefix
    { id: "qwen/qwen3.6-plus", name: "Qwen 3.6 Plus (Puter)" },
    { id: "qwen/qwen3.5-397b-a17b", name: "Qwen 3.5 397B (Puter)" },
    // Perplexity Sonar
    { id: "perplexity/sonar-deep-research", name: "Perplexity Sonar Deep Research (Puter)" },
    { id: "perplexity/sonar-pro-search", name: "Perplexity Sonar Pro Search (Puter)" },
    { id: "perplexity/sonar-pro", name: "Perplexity Sonar Pro (Puter)" },
    { id: "perplexity/sonar-reasoning-pro", name: "Perplexity Sonar Reasoning Pro (Puter)" },
    { id: "perplexity/sonar", name: "Perplexity Sonar (Puter)" },
  ],
  passthroughModels: true,
};
