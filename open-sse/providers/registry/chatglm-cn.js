// ChatGLM.cn (智谱清言) — cookie/token-based reverse of the consumer web chat.
//
// Unlike the official Zhipu developer API (open.bigmodel.cn, Bearer key), chatglm.cn is the
// consumer web app. It authenticates via a `chatglm_refresh_token` cookie (JWT). The
// ChatGLMExecutor (open-sse/executors/chatglm-cn.js) bridges this to an OpenAI-compatible
// interface by:
//   1. refreshing the refresh_token → access_token (1h lifetime, auto-renewed)
//   2. POSTing to the web /backend-api/assistant/stream (SSE) endpoint
//   3. translating the GLM event stream into OpenAI chat.completion.chunk frames
//
// Auth input: the FULL cookie string OR just the refresh token value.
//   - Full cookies: "chatglm_token=...; chatglm_refresh_token=eyJ...; chatglm_user_id=..."
//     → executor extracts chatglm_refresh_token automatically.
//   - Just the token: "eyJ..." (refresh token JWT) → used as-is.
// The access token (chatglm_token) is short-lived (~1h) and is derived automatically,
// so users only need to paste the refresh token (6-month lifetime).
//
// Reverse-engineering reference: github.com/XxxXTeam/glm2api
export default {
  id: "chatglm-cn",
  priority: 60,
  alias: "chatglm-cn",
  uiAlias: "chatglm-cn",
  display: {
    name: "ChatGLM (Web)",
    icon: "chat",
    color: "#3B5FE5",
    textIcon: "GL",
    website: "https://chatglm.cn",
    notice: {
      signupUrl: "https://chatglm.cn",
      apiKeyUrl: "https://chatglm.cn/main/",
      text: "ChatGLM (智谱清言) free web chat. Open chatglm.cn, log in, then copy your cookies (DevTools → Application → Cookies). Paste the full cookie string here — the refresh token is what we actually use (valid ~6 months). Guest accounts work but have tighter rate limits. Responses are streamed from the web backend and translated to OpenAI format.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your chatglm.cn cookies (full cookie string or just the chatglm_refresh_token value, e.g. eyJhbGc...).",
  transport: {
    // Base of the GLM web backend. The executor builds full per-call URLs from this.
    baseUrl: "https://chatglm.cn/chatglm",
    format: "chatglm-cn",
    authType: "cookie",
  },
  // GLM web models. `chatglm.cn` routes by assistant_id + chat_mode rather than a model
  // field, but exposing the catalog as models lets clients pick the capability they want.
  // upstreamModelId carries the model name sent inside meta_data where relevant.
  models: [
    { id: "glm-5.2", name: "GLM-5.2", upstreamModelId: "glm-5.2" },
    { id: "glm-5.1", name: "GLM-5.1", upstreamModelId: "glm-5.1" },
    { id: "glm-5", name: "GLM-5", upstreamModelId: "glm-5" },
    { id: "glm-5-turbo", name: "GLM-5 Turbo", upstreamModelId: "glm-5-turbo" },
    { id: "glm-4.7", name: "GLM-4.7", upstreamModelId: "glm-4.7" },
    { id: "glm-4.7-flash", name: "GLM-4.7 Flash", upstreamModelId: "glm-4.7-flash" },
    { id: "glm-4.6", name: "GLM-4.6", upstreamModelId: "glm-4.6" },
    { id: "glm-4.6v-flash", name: "GLM-4.6V Flash", upstreamModelId: "glm-4.6v-flash" },
    { id: "glm-4.5", name: "GLM-4.5", upstreamModelId: "glm-4.5" },
    { id: "glm-4", name: "GLM-4", upstreamModelId: "glm-4" },
    { id: "glm-4-flash", name: "GLM-4 Flash", upstreamModelId: "glm-4-flash" },
    { id: "glm-4-air", name: "GLM-4 Air", upstreamModelId: "glm-4-air" },
    { id: "glm-deep-research", name: "GLM Deep Research", upstreamModelId: "glm-deep-research" },
  ],
  passthroughModels: true,
  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
  },
};
