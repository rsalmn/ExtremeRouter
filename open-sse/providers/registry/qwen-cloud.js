// Qwen Cloud (Alibaba DashScope International) — API-key OpenAI-compatible
// gateway at dashscope-intl.aliyuncs.com.
//
// Distinct from `qwencloud` (the cookie-based chat.qwen.ai web provider) and
// from `qwen-web` (cookie-based chat.qwen.ai v2 API). This is the official
// DashScope international API-key endpoint, OpenAI-compatible.
//
// Port of OmniRoute commit 00677044 (Part 3/3).
export default {
  id: "qwen-cloud",
  priority: 165,
  alias: "qwc",
  aliases: ["qwen-cloud"],
  uiAlias: "qwc",
  display: {
    name: "Qwen Cloud (DashScope)",
    icon: "cloud",
    color: "#615CED",
    textIcon: "QC",
    website: "https://dashscope.console.aliyun.com",
    notice: {
      signupUrl: "https://dashscope.console.aliyun.com",
      apiKeyUrl: "https://dashscope.console.aliyun.com/apiKey",
      text: "Alibaba DashScope international API. Create an API key at dashscope.console.aliyun.com, then paste it here. OpenAI-compatible — works with any OpenAI-format client.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    format: "openai",
    validateUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    { id: "qwen3.7-max-2026-06-08", name: "Qwen3.7 Max (2026-06-08)" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
    { id: "qwen3.6-27b", name: "Qwen3.6 27B" },
    { id: "qwen3.6-35b-a3b", name: "Qwen3.6 35B A3B" },
    { id: "qwen3.5-plus-2026-04-20", name: "Qwen3.5 Plus (2026-04-20)" },
    { id: "qwen3.5-122b-a10b", name: "Qwen3.5 122B A10B" },
    { id: "qwen3.5-397b-a17b", name: "Qwen3.5 397B A17B" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.2-fast-preview", name: "GLM 5.2 Fast Preview" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
  ],
  passthroughModels: true,
};
