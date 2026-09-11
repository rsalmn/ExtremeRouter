export default {
  id: "opencode-go",
  priority: 210,
  alias: "opencode-go",
  aliases: [
    "ocg",
  ],
  uiAlias: "ocg",
  display: {
    name: "OpenCode Go",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Go subscription: $5/mo (then  0/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    headers: {},
  },
  models: [
    // ── /chat/completions (OpenAI-compatible; no targetFormat) ──────────────
    // SourceFormat-matched transport stays on this default lane — a Claude
    // client is never routed to /messages for a model that lacks it.
    { id: "glm-5.3", name: "GLM 5.3" },
    // GLM-5.2 — base model + effort-tier aliases (#6922).
    // OpenCodeGoExecutor.parseEffortLevel() rewrites the alias to the canonical
    // id and injects reasoning_effort, mirroring the deepseek-v4-pro-* pattern.
    // GLM-5.2 supports high/max only (Z.AI reasoning plane; low/medium rejected).
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.2-high", name: "GLM 5.2 (High Effort)" },
    { id: "glm-5.2-max", name: "GLM 5.2 (Max Effort)" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "longcat-2.0", name: "LongCat 2.0" },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    // DeepSeek V4 Pro — all four effort tiers (low/medium/high/max).
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-pro-low", name: "DeepSeek V4 Pro (Low Effort)" },
    { id: "deepseek-v4-pro-medium", name: "DeepSeek V4 Pro (Medium Effort)" },
    { id: "deepseek-v4-pro-high", name: "DeepSeek V4 Pro (High Effort)" },
    { id: "deepseek-v4-pro-max", name: "DeepSeek V4 Pro (Max Effort)" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    // MiMo-V2.5 — base model + effort-tier aliases (#6922).
    // Supports high/max only (Xiaomi MiMo does not document low/medium tiers).
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "mimo-v2.5-high", name: "MiMo V2.5 (High Effort)" },
    { id: "mimo-v2.5-max", name: "MiMo V2.5 (Max Effort)" },
    { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
    { id: "hy4-preview", name: "Hy4 Preview" },
    { id: "hy3", name: "Hy3" },

    // ── /messages (Anthropic format; targetFormat claude) ───────────────────
    // targetFormat forces chatCore past the sourceFormat-matched transport
    // into Claude translation + x-api-key auth (MESSAGES_FORMAT_MODELS).
    { id: "minimax-m3", name: "MiniMax M3", targetFormat: "claude" },
    { id: "minimax-m2.7", name: "MiniMax M2.7", targetFormat: "claude" },
    { id: "minimax-m2.5", name: "MiniMax M2.5", targetFormat: "claude" },
    { id: "qwen3.8-max", name: "Qwen 3.8 Max", targetFormat: "claude" },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash", targetFormat: "claude" },
    { id: "qwen3.7-max", name: "Qwen 3.7 Max", targetFormat: "claude" },
    { id: "qwen3.7-plus", name: "Qwen 3.7 Plus", targetFormat: "claude" },
    { id: "qwen3.6-plus", name: "Qwen 3.6 Plus", targetFormat: "claude" },

    // ── /responses only (targetFormat openai-responses) ─────────────────────
    // Responses-only models live on /zen/go/v1/responses — chat/completions
    // 500s for these. targetFormat forces chatCore past the sourceFormat-matched
    // transport into translation (see getModelTargetFormat + OpenCodeGoExecutor
    // buildUrl). Same Muse Spark family as opencode's free lane; Grok/GPT Luna
    // are Responses-API upstreams on the Go subscription.
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", targetFormat: "openai-responses" },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", targetFormat: "openai-responses" },
    { id: "grok-4.6", name: "Grok 4.6", targetFormat: "openai-responses" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", targetFormat: "openai-responses" },
  ],
};
