// Qwen Cloud (Token Plan, ap-southeast-1) — Alibaba token-plan endpoint with
// qwen3.8-max-preview, hosted at ap-southeast-1.maas.aliyuncs.com.
//
// This is the regional Alibaba MaaS endpoint used by token-plan subscriptions.
// Distinct from `qwen-cloud` (DashScope international) and `qwencloud` (cookie
// web). Port of OmniRoute commit 00677044 (Part 3/3).
export default {
  id: "qwen-cloud-token-plan",
  priority: 166,
  alias: "qct",
  aliases: ["qwen-cloud-token-plan"],
  uiAlias: "qct",
  display: {
    name: "Qwen Cloud (Token Plan)",
    icon: "cloud",
    color: "#615CED",
    textIcon: "QT",
    website: "https://dashscope.console.aliyun.com",
    notice: {
      signupUrl: "https://dashscope.console.aliyun.com",
      apiKeyUrl: "https://dashscope.console.aliyun.com/apiKey",
      text: "Alibaba token-plan endpoint (ap-southeast-1) for Qwen3.8 Max Preview and other frontier models. Paste your API key here. OpenAI-compatible.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl:
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    format: "openai",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    {
      id: "qwen3.8-max-preview",
      name: "Qwen3.8 Max Preview",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
    {
      id: "qwen3.7-max",
      name: "Qwen3.7 Max",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
    {
      id: "qwen3.7-plus",
      name: "Qwen3.7 Plus",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
    {
      id: "qwen3.6-flash",
      name: "Qwen3.6 Flash",
      contextWindow: 1000000,
      maxOutput: 32768,
    },
    {
      id: "glm-5.2",
      name: "GLM 5.2",
      contextWindow: 1000000,
      maxOutput: 16384,
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      contextWindow: 163840,
      maxOutput: 32768,
    },
  ],
  passthroughModels: true,
};
