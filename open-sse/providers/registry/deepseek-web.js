// DeepSeek Web — cookie/token-based reverse of chat.deepseek.com consumer web chat.
//
// Unlike the official DeepSeek developer API (api.deepseek.com, Bearer key), chat.deepseek.com is
// the consumer web app. The DeepSeekWebExecutor (open-sse/executors/deepseek-web.js) bridges it:
//   1. Acquires a short-lived access token from the user's `userToken` (localStorage) via
//      /api/v0/users/current.
//   2. Creates a chat session, solves a proof-of-work (DeepSeekHashV1 = SHA3-256) challenge, and
//      POSTs to /api/v0/chat/completion.
//   3. Translates the DeepSeek delta SSE into OpenAI chat.completion.chunk frames.
//
// Auth input (apiKey field): the userToken value from chat.deepseek.com localStorage
// (DevTools → Application → Local Storage → chat.deepseek.com → userToken).
export default {
  id: "deepseek-web",
  priority: 130,
  alias: "ds-web",
  uiAlias: "ds-web",
  display: {
    name: "DeepSeek Web (Subscription)",
    icon: "psychology",
    color: "#4D6BFE",
    textIcon: "DS",
    website: "https://chat.deepseek.com",
    notice: {
      signupUrl: "https://chat.deepseek.com",
      apiKeyUrl: "https://chat.deepseek.com",
      text: "DeepSeek free web chat. Open chat.deepseek.com, log in, then copy your userToken from DevTools (Application → Local Storage → chat.deepseek.com → userToken). Paste it here. The token is exchanged for a short-lived access token automatically, and a proof-of-work challenge is solved per request. Responses are streamed from the web backend and translated to OpenAI format.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your userToken value from chat.deepseek.com (DevTools → Application → Local Storage → userToken).",
  transport: {
    baseUrl: "https://chat.deepseek.com",
    format: "deepseek-web",
    authType: "cookie",
  },
  models: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-pro-think", name: "DeepSeek V4 Pro Think", supportsReasoning: true },
    { id: "deepseek-v4-pro-search", name: "DeepSeek V4 Pro Search" },
    { id: "deepseek-v4-pro-think-search", name: "DeepSeek V4 Pro Think+Search", supportsReasoning: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-flash-think", name: "DeepSeek V4 Flash Think", supportsReasoning: true },
    { id: "deepseek-v4-flash-search", name: "DeepSeek V4 Flash Search" },
    { id: "deepseek-v4-flash-think-search", name: "DeepSeek V4 Flash Think+Search", supportsReasoning: true },
    { id: "deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner", supportsReasoning: true },
    { id: "DeepSeek-R1", name: "DeepSeek R1", supportsReasoning: true },
    { id: "DeepSeek-R1-Search", name: "DeepSeek R1 Search", supportsReasoning: true },
    { id: "DeepSeek-V3.2", name: "DeepSeek V3.2" },
    { id: "DeepSeek-Search", name: "DeepSeek Search" },
  ],
  passthroughModels: true,
};
