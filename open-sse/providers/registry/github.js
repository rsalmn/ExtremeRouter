export default {
  id: "github",
  priority: 40,
  alias: "gh",
  uiAlias: "gh",
  display: {
    name: "GitHub Copilot",
    icon: "code",
    color: "#333333",
    website: "https://github.com/features/copilot",
    notice: {
      signupUrl: "https://github.com/features/copilot",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api.githubcopilot.com/chat/completions",
    responsesUrl: "https://api.githubcopilot.com/responses",
    // Anthropic-native shim: the only Copilot endpoint that surfaces prompt-cache
    // token counts (cached_tokens) for Claude models, and avoids round-tripping
    // tool_use/tool_result/thinking content blocks through the OpenAI shape.
    // Routed via each claude-* model's targetFormat: "claude" below (see
    // GithubExecutor buildUrl/buildHeaders). Port of decolua/9router#2608.
    messagesUrl: "https://api.githubcopilot.com/v1/messages",
    headers: {
      "copilot-integration-id": "vscode-chat",
      "editor-version": "vscode/1.110.0",
      "editor-plugin-version": "copilot-chat/0.38.0",
      "user-agent": "GitHubCopilotChat/0.38.0",
      "openai-intent": "conversation-panel",
      "x-github-api-version": "2025-04-01",
      "x-vscode-user-agent-library-version": "electron-fetch",
      "X-Initiator": "user",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    copilot: {
      vscodeVersion: "1.110.0",
      chatVersion: "0.38.0",
      userAgent: "GitHubCopilotChat/0.38.0",
      apiVersion: "2025-04-01",
    },
    usage: {
      url: "https://api.github.com/copilot_internal/user",
    },
  },
  // Models synced with OmniRoute commit fea1d54 (2026-07). All claude-* entries
  // carry targetFormat: "claude" so chatCore translates them to Anthropic-native
  // shape and GithubExecutor routes them to /v1/messages (see messagesUrl above).
  // contextLength → contextWindow, maxOutputTokens → maxOutput (ExtremeRouter
  // camelCase convention).
  models: [
    // ── Claude (native /v1/messages path) ─────────────────────────────────
    { id: "claude-fable-5", name: "Claude Fable 5", targetFormat: "claude", contextWindow: 1000000, maxOutput: 64000 },
    { id: "claude-opus-4.8-fast", name: "Claude Opus 4.8 (fast mode)", targetFormat: "claude", contextWindow: 1000000, maxOutput: 64000, unsupportedParams: ["temperature", "top_p", "top_k"] },
    { id: "claude-opus-4.8", name: "Claude Opus 4.8", targetFormat: "claude", contextWindow: 1000000, maxOutput: 64000, unsupportedParams: ["temperature", "top_p", "top_k"] },
    { id: "claude-opus-4.7", name: "Claude Opus 4.7", targetFormat: "claude", contextWindow: 1000000, maxOutput: 64000 },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", targetFormat: "claude", contextWindow: 1000000, maxOutput: 64000 },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5", targetFormat: "claude", contextWindow: 200000, maxOutput: 32000 },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", targetFormat: "claude", contextWindow: 1000000, maxOutput: 64000 },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", targetFormat: "claude", contextWindow: 200000, maxOutput: 32000 },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", targetFormat: "claude", contextWindow: 200000, maxOutput: 32000 },
    // ── Gemini (#2911: must use chat/completions, not Responses API) ───────
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", contextWindow: 1000000, maxOutput: 64000 },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", contextWindow: 1000000, maxOutput: 64000 },
    // ── GPT (Responses API) ────────────────────────────────────────────────
    { id: "gpt-5.5", name: "GPT-5.5", targetFormat: "openai-responses", contextWindow: 1050000, maxOutput: 128000 },
    { id: "gpt-5.4", name: "GPT-5.4", targetFormat: "openai-responses", contextWindow: 1050000, maxOutput: 128000 },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", targetFormat: "openai-responses", contextWindow: 400000, maxOutput: 128000 },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", targetFormat: "openai-responses", contextWindow: 400000, maxOutput: 128000 },
    { id: "gpt-5-mini", name: "GPT-5 Mini", targetFormat: "openai-responses", contextWindow: 264000, maxOutput: 64000 },
    { id: "gpt-4o-2024-11-20", name: "GPT-4o", contextWindow: 128000, maxOutput: 16384 },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, maxOutput: 4096 },
    { id: "gpt-4-0125-preview", name: "GPT 4 Turbo", contextWindow: 128000, maxOutput: 4096 },
    // ── Other ─────────────────────────────────────────────────────────────
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", contextWindow: 256000, maxOutput: 32000 },
    { id: "mai-code-1-flash", name: "MAI-Code-1-Flash", targetFormat: "openai-responses", contextWindow: 256000, maxOutput: 128000 },
    { id: "oswe-vscode-prime", name: "Raptor Mini", targetFormat: "openai-responses", contextWindow: 264000, maxOutput: 64000 },
    // ── Embeddings (separate kind, handled by embeddingConfig above) ───────
    { id: "text-embedding-3-small", name: "Text Embedding 3 Small (GitHub)", kind: "embedding" },
    { id: "text-embedding-3-large", name: "Text Embedding 3 Large (GitHub)", kind: "embedding" },
  ],
  serviceKinds: ["llm","embedding"],
  embeddingConfig: { baseUrl: "https://models.github.ai/inference/embeddings", authType: "apikey", authHeader: "bearer" },
  oauth: {
    clientId: "Iv1.b507a08c87ecfe98",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    deviceCodeUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: "read:user",
    apiVersion: "2022-11-28",
    copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
    userAgent: "GitHubCopilotChat/0.26.7",
    editorVersion: "vscode/1.85.0",
    editorPluginVersion: "copilot-chat/0.26.7",
  },
  features: {
    usage: true,
  },
};
