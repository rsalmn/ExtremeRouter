// Perplexity Agent — multi-model routing gateway via Perplexity's Agent API.
//
// Unlike the existing `perplexity` (Sonar, /chat/completions), the Agent API uses
// Perplexity's OpenAI-compatible Responses API at POST /v1/agent. It routes to
// 30+ third-party models (GPT, Claude, Gemini, Grok, GLM, Kimi, Sonar) through
// a single Perplexity API key.
//
// Endpoint: POST https://api.perplexity.ai/v1/agent
// Auth: Bearer <pplx-...>
// Body: { input: string | array, model: "openai/gpt-5-mini", stream?: bool }
//
// Response format: OpenAI Responses API (output[].content[].text for non-streaming,
// response.output_text.delta events for streaming).
//
// The PerplexityAgentExecutor (open-sse/executors/perplexity-agent.js) translates
// OpenAI chat.completions requests to/from the Responses API format.
export default {
  id: "perplexity-agent",
  priority: 175,
  alias: "pplx-agent",
  aliases: ["pplxa", "perplexity-agent"],
  uiAlias: "pplxa",
  display: {
    name: "Perplexity Agent",
    icon: "smart_toy",
    color: "#20A39E",
    textIcon: "PA",
    website: "https://www.perplexity.ai",
    notice: {
      signupUrl: "https://www.perplexity.ai",
      apiKeyUrl: "https://www.perplexity.ai/settings/api",
      text: "Perplexity Agent API routes to 30+ third-party models (GPT, Claude, Gemini, Grok, GLM, Kimi, Sonar) through one Perplexity API key. Get a key at perplexity.ai/settings/api. Uses the Responses API format.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.perplexity.ai/v1/agent",
    format: "openai-responses",
    validateUrl: "https://api.perplexity.ai/v1/models",
  },
  // Curated seed models — the full ~33 model list is discoverable at runtime
  // via /v1/models. These cover the most popular models.
  models: [
    { id: "openai/gpt-5-mini", name: "GPT-5 Mini" },
    { id: "openai/gpt-5", name: "GPT-5" },
    { id: "openai/gpt-5.4", name: "GPT-5.4" },
    { id: "openai/gpt-5.5", name: "GPT-5.5" },
    { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-opus-4-7", name: "Claude Opus 4.7" },
    { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "xai/grok-4.20-multi-agent", name: "Grok 4.20 Multi-Agent" },
    { id: "perplexity/glm-5.2", name: "GLM 5.2" },
    { id: "perplexity/kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "perplexity/sonar", name: "Sonar" },
  ],
  passthroughModels: true,
};
