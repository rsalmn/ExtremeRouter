// Moonshot AI (api.moonshot.ai) — official Moonshot platform API for Kimi models.
//
// OpenAI-compatible endpoint at https://api.moonshot.ai/v1/chat/completions.
// Supports kimi-k3 with reasoning_effort "max", plus kimi-k2.6, kimi-k2.5,
// and vision models. Separate from the `kimi` (Coding Plan at api.kimi.com) and
// `kimi-coding` providers.
//
// No custom executor needed — DefaultExecutor handles OpenAI-compatible APIs.
// Reasoning_effort is passed through via the thinking layer (openai format).
export default {
  id: "moonshot",
  priority: 165,
  alias: "moonshot",
  aliases: ["ms"],
  uiAlias: "ms",
  display: {
    name: "Moonshot AI",
    icon: "dark_mode",
    color: "#6D28D9",
    textIcon: "MS",
    website: "https://platform.moonshot.ai",
    notice: {
      signupUrl: "https://platform.moonshot.ai/console/api-keys",
      apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
      text: "Moonshot AI is the official platform for Kimi models (kimi-k3, kimi-k2.6, kimi-k2.5). Get an API key at platform.moonshot.ai. OpenAI-compatible. kimi-k3 supports reasoning_effort: max.",
    },
  },
  category: "apikey",
  authType: "apikey",
  thinkingConfig: {
    options: ["auto", "none", "max"],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://api.moonshot.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.moonshot.ai/v1/models",
  },
  models: [
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "moonshot-v1-8k-vision-preview", name: "Moonshot v1 8K Vision" },
    { id: "moonshot-v1-32k-vision-preview", name: "Moonshot v1 32K Vision" },
    { id: "moonshot-v1-128k-vision-preview", name: "Moonshot v1 128K Vision" },
  ],
  passthroughModels: true,
};
