// Alibaba (China) — DashScope China endpoint at dashscope.aliyuncs.com.
// Same model catalog as the international `alibaba` provider but pointed at
// the China-region host. Port of OmniRoute commit 00677044 (Part 3/3).
export default {
  id: "alibaba-cn",
  priority: 161,
  alias: "alibaba-cn",
  aliases: ["alicn"],
  uiAlias: "alicn",
  display: {
    name: "Alibaba (China)",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "AC",
    website: "https://dashscope.console.aliyun.com",
    notice: {
      signupUrl: "https://dashscope.console.aliyun.com",
      apiKeyUrl: "https://dashscope.console.aliyun.com/apiKey",
      text: "Alibaba Cloud Model Studio (DashScope China region). Create an API key at dashscope.console.aliyun.com. OpenAI-compatible.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    format: "openai",
    validateUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
    { id: "qwen3.6-27b", name: "Qwen3.6 27B" },
    { id: "qwen3.6-35b-a3b", name: "Qwen3.6 35B A3B" },
    { id: "qwen3.5-plus", name: "Qwen3.5 Plus" },
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
