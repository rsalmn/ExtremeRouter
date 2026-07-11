// ZenMux Free — session-cookie free-tier gateway.
//
// Users log into zenmux.ai, export all cookies via a browser extension
// (EditThisCookie / Cookie-Editor), and paste the full Cookie header string
// as the credential. The ctoken extracted from the cookie string is required
// for all API requests as a query parameter.
//
// Models available on the free tier (5 Flows/5h, 38.64 Flows/week):
// DeepSeek V3.2, GLM 4.7 Flash Free, MiMo V2 Flash Free, and others.
//
// Reference: github.com/diegosouzapw/OmniRoute (zenmux-free executor, MIT).
export default {
  id: "zenmux-free",
  priority: 65,
  alias: "zmf",
  uiAlias: "zmf",
  display: {
    name: "ZenMux Free",
    icon: "hub",
    color: "#6366F1",
    textIcon: "ZM",
    website: "https://zenmux.ai",
    notice: {
      signupUrl: "https://zenmux.ai",
      apiKeyUrl: "https://zenmux.ai",
      text: "ZenMux Free tier — log in at zenmux.ai, export all cookies (EditThisCookie / Cookie-Editor / DevTools), and paste the full Cookie string. Must include `ctoken`. Free models: DeepSeek V3.2, GLM 4.7 Flash, MiMo V2 Flash, KAT Coder Pro, and more.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the FULL cookie string from zenmux.ai (must include ctoken). Use EditThisCookie or DevTools → Application → Cookies → copy all.",
  transport: {
    baseUrl: "https://zenmux.ai/api/anthropic/v1/messages",
    format: "zenmux-free",
    authType: "cookie",
  },
  models: [
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek/deepseek-reasoner", name: "DeepSeek Reasoner" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "z-ai/glm-4.7-flash-free", name: "GLM 4.7 Flash Free" },
    { id: "z-ai/glm-4.6v-flash-free", name: "GLM 4.6V Flash Free" },
    { id: "z-ai/glm-4.7", name: "GLM 4.7" },
    { id: "z-ai/glm-4.6v-flash", name: "GLM 4.6V Flash" },
    { id: "qwen/qwen3.7-plus", name: "Qwen 3.7 Plus" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "minimax/minimax-m2.1", name: "MiniMax M2.1" },
    { id: "stepfun/step-3.5-flash", name: "Step 3.5 Flash" },
    { id: "stepfun/step-3.7-flash", name: "Step 3.7 Flash" },
    { id: "stepfun/step-3.7-flash-free", name: "Step 3.7 Flash Free" },
    { id: "stepfun/step-3", name: "Step 3" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "google/gemini-3.1-flash-lite-image", name: "Gemini 3.1 Flash Lite Image" },
    { id: "anthropic/claude-fable-5", name: "Claude Fable 5" },
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "inclusionai/ling-2.6-1t", name: "Ling 2.6 1T" },
    { id: "inclusionai/ring-2.6-1t", name: "Ring 2.6 1T" },
    { id: "meituan/longcat-2.0", name: "Longcat 2.0" },
    { id: "kuaishou/kat-coder-pro-v2.5", name: "KAT Coder Pro V2.5" },
    { id: "kuaishou/kat-coder-air-v2.5", name: "KAT Coder Air V2.5" },
    { id: "sapiens-ai/agnes-image-1.2", name: "Agnes Image 1.2" },
  ],
  passthroughModels: true,
};
