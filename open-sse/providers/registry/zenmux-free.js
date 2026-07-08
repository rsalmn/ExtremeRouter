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
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3.2 (Non-thinking)" },
    { id: "deepseek/deepseek-reasoner", name: "DeepSeek V3.2 (Thinking)" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "kuaishou/kat-coder-pro-v1-free", name: "KAT Coder Pro V1 Free" },
    { id: "xiaomi/mimo-v2-flash-free", name: "MiMo V2 Flash Free" },
    { id: "z-ai/glm-4.7-flash-free", name: "GLM 4.7 Flash Free" },
    { id: "stepfun/step-3.5-flash-free", name: "Step 3.5 Flash Free" },
    { id: "inclusionai/ling-1t", name: "Ling 1T" },
    { id: "inclusionai/ling-mini-2.0", name: "Ling Mini 2.0" },
    { id: "inclusionai/ring-1t", name: "Ring 1T" },
    { id: "sapiens-ai/agnes-1.5-lite", name: "Agnes 1.5 Lite" },
    { id: "sapiens-ai/agnes-1.5-pro", name: "Agnes 1.5 Pro" },
  ],
  passthroughModels: true,
};
