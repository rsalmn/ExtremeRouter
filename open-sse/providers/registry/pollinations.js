// Pollinations — free text generation via an OpenAI-compatible gateway (gen.pollinations.ai/v1).
//
// Pollinations is FREE and works anonymously for keyless models. Premium models (claude, gemini,
// midijourney) require a Pollinations API key. This is an OpenAI-format provider: the executor
// (open-sse/executors/pollinations.js) forwards standard chat.completions requests, attaches a
// Bearer token only when an API key is supplied, and translates json_object/json_schema
// response_format into Pollinations' `jsonMode` flag (the upstream treats jsonMode=true as "the
// model MUST return JSON" and 400s requests whose messages don't mention "json").
//
// Auth input: OPTIONAL. Leave blank for anonymous/keyless models; paste a Pollinations API key
// (from https://enter.pollinations.ai) to unlock premium models.
//
// NOTE (2026-06): Pollinations retired the legacy text.pollinations.ai host (now 404). The
// current OpenAI-compatible gateway is gen.pollinations.ai/v1, which is why this routes there.
export default {
  id: "pollinations",
  priority: 80,
  alias: "pollinations",
  aliases: [
    "pol",
  ],
  uiAlias: "pollinations",
  display: {
    name: "Pollinations",
    icon: "local_florist",
    color: "#7C3AED",
    textIcon: "PL",
    website: "https://pollinations.ai",
    notice: {
      signupUrl: "https://enter.pollinations.ai",
      apiKeyUrl: "https://enter.pollinations.ai",
      text: "Pollinations is FREE text + image generation. Keyless models (openai, openai-fast, openai-large, qwen-coder, mistral, deepseek, grok, gemini-flash-lite-3.1, perplexity-fast, perplexity-reasoning) need no auth. Premium models (claude, gemini, midijourney) require a Pollinations API key from enter.pollinations.ai. No credential is required for the free tier; paste an API key only to unlock premium models.",
    },
  },
  category: "webCookie",
  authType: "none",
  noAuth: true,
  authHint: "Optional — leave blank for free keyless models. Paste a Pollinations API key for premium models.",
  transport: {
    baseUrl: "https://gen.pollinations.ai/v1/chat/completions",
    format: "pollinations",
    authType: "none",
  },
  models: [
    { id: "openai", name: "OpenAI (Pollinations)" },
    { id: "openai-fast", name: "OpenAI Fast (Pollinations)" },
    { id: "openai-large", name: "OpenAI Large (Pollinations)" },
    { id: "qwen-coder", name: "Qwen Coder (Pollinations)" },
    { id: "mistral", name: "Mistral (Pollinations)" },
    { id: "gemini", name: "Gemini (Pollinations)" },
    { id: "gemini-flash-lite-3.1", name: "Gemini Flash Lite 3.1 (Pollinations)" },
    { id: "gemini-fast", name: "Gemini Fast (Pollinations)" },
    { id: "deepseek", name: "DeepSeek (Pollinations)" },
    { id: "grok", name: "Grok (Pollinations)" },
    { id: "grok-large", name: "Grok Large (Pollinations)" },
    { id: "gemini-search", name: "Gemini Search (Pollinations)" },
    { id: "midijourney", name: "Midijourney (Pollinations)" },
    { id: "midijourney-large", name: "Midijourney Large (Pollinations)" },
    { id: "claude-fast", name: "Claude Fast (Pollinations)" },
    { id: "claude", name: "Claude (Pollinations)" },
    { id: "claude-large", name: "Claude Large (Pollinations)" },
    { id: "perplexity-fast", name: "Perplexity Fast (Pollinations)" },
    { id: "perplexity-reasoning", name: "Perplexity Reasoning (Pollinations)" },
    { id: "kimi", name: "Kimi (Pollinations)" },
    { id: "gemini-large", name: "Gemini Large (Pollinations)" },
    { id: "nova-fast", name: "Nova Fast (Pollinations)" },
    { id: "nova", name: "Nova (Pollinations)" },
    { id: "glm", name: "GLM (Pollinations)" },
    { id: "minimax", name: "MiniMax (Pollinations)" },
    { id: "mistral-large", name: "Mistral Large (Pollinations)" },
    { id: "polly", name: "Polly (Pollinations)" },
    { id: "qwen-coder-large", name: "Qwen Coder Large (Pollinations)" },
    { id: "qwen-large", name: "Qwen Large (Pollinations)" },
    { id: "qwen-vision", name: "Qwen Vision (Pollinations)" },
    { id: "qwen-safety", name: "Qwen Safety (Pollinations)" },
  ],
  passthroughModels: true,
};
