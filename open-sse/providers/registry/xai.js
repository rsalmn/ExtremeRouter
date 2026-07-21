export default {
  id: "xai",
  priority: 280,
  alias: "xai",
  display: {
    name: "xAI (Grok)",
    icon: "auto_awesome",
    color: "#1DA1F2",
    textIcon: "XA",
    website: "https://x.ai",
    notice: {
      apiKeyUrl: "https://console.x.ai",
    },
  },
  category: "oauth",
  authModes: [
    "oauth",
    "apikey",
  ],
  hasOAuth: true,
  thinkingConfig: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://api.x.ai/v1/chat/completions",
    validateUrl: "https://api.x.ai/v1/models",
    responsesUrl: "https://api.x.ai/v1/responses",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refreshUrl: "https://auth.x.ai/oauth2/token",
    usage: {
      billingUrl: "https://api.x.ai/v1/billing?format=credits",
      subscriptionUrl: "https://api.x.ai/v1/user?include=subscription",
    },
  },
  // Both flags required: `usage` gates USAGE_SUPPORTED_PROVIDERS (general
  // list shown in Quota UI), `usageApikey` gates USAGE_APIKEY_PROVIDERS
  // (api-key connections allowed past the authType check). xAI billing API
  // works with both OAuth tokens and API keys.
  features: { usage: true, usageApikey: true },
  models: [
    // Reasoning LLMs (Responses API + Chat Completions)
    { id: "grok-4.5", name: "Grok 4.5" },
    { id: "grok-4.20-multi-agent", name: "Grok 4.20 Multi-Agent" },
    { id: "grok-4.20-reasoning", name: "Grok 4.20 Reasoning" },
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning" },
    { id: "grok-code-fast-1", name: "Grok Code Fast" },
    { id: "grok-3", name: "Grok 3" },
    // Image generation / editing
    { id: "grok-imagine-image-quality", name: "Grok Imagine (Image Quality)", params: ["n","response_format"], kind: "image" },
    { id: "grok-2-image-1212", name: "Grok 2 Image", params: ["n","response_format"], kind: "image" },
    // Image-to-Video
    { id: "grok-imagine-video-1.5", name: "Grok Imagine Video 1.5", kind: "video" },
  ],
  serviceKinds: ["llm","imageToText","webSearch","image","video"],
  imageConfig: { baseUrl: "https://api.x.ai/v1/images/generations", bodyFields: ["model","prompt","n","response_format"] },
  searchViaChat: {
    defaultModel: "grok-4.20-reasoning",
    endpoint: "https://api.x.ai/v1/responses",
    pricingUrl: "https://x.ai/api#pricing",
  },
};
