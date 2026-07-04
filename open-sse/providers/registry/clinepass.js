export default {
  id: "clinepass",
  priority: 85,
  alias: "clinepass",
  uiAlias: "clinepass",
  display: {
    name: "ClinePass",
    icon: "vpn_key",
    color: "#5B9BD5",
    textIcon: "CP",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://app.cline.bot",
      apiKeyUrl: "https://app.cline.bot/settings#api-keys",
      text: "ClinePass is a paid Cline subscription ($4.99–$9.99/mo) for curated open-weight coding models. Create an API key in your Cline account settings, then add it here.",
    },
  },
  category: "oauth",
  authModes: ["apikey", "oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "clineHeaders",
      ],
    },
  },
  // Model IDs follow the documented `{provider}/{model}` format.
  // `cline-pass/` prefix is required by the Cline API for ClinePass models.
  models: [
    { id: "cline-pass/glm-5.2", name: "GLM-5.2 (ClinePass)", upstreamModelId: "cline-pass/glm-5.2" },
    { id: "cline-pass/kimi-k2.7-code", name: "Kimi K2.7 Code (ClinePass)", upstreamModelId: "cline-pass/kimi-k2.7-code" },
    { id: "cline-pass/kimi-k2.6", name: "Kimi K2.6 (ClinePass)", upstreamModelId: "cline-pass/kimi-k2.6" },
    { id: "cline-pass/deepseek-v4-pro", name: "DeepSeek V4 Pro (ClinePass)", upstreamModelId: "cline-pass/deepseek-v4-pro" },
    { id: "cline-pass/deepseek-v4-flash", name: "DeepSeek V4 Flash (ClinePass)", upstreamModelId: "cline-pass/deepseek-v4-flash" },
    { id: "cline-pass/mimo-v2.5", name: "MiMo-V2.5 (ClinePass)", upstreamModelId: "cline-pass/mimo-v2.5" },
    { id: "cline-pass/mimo-v2.5-pro", name: "MiMo-V2.5-Pro (ClinePass)", upstreamModelId: "cline-pass/mimo-v2.5-pro" },
    { id: "cline-pass/minimax-m3", name: "MiniMax M3 (ClinePass)", upstreamModelId: "cline-pass/minimax-m3" },
    { id: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max (ClinePass)", upstreamModelId: "cline-pass/qwen3.7-max" },
    { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus (ClinePass)", upstreamModelId: "cline-pass/qwen3.7-plus" },
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
  },
};

