// Qwen Web — Alibaba Tongyi Qwen Chat via chat.qwen.ai (cookie + bearer, v2 API).
//
// The QwenWebExecutor (open-sse/executors/qwen-web.js) bridges the consumer v2 API:
//   1. POST /api/v2/chats/new → create a chat, returns chat_id
//   2. POST /api/v2/chat/completions?chat_id= → phase-based SSE stream
//
// The v2 endpoints sit behind Alibaba's "baxia" WAF, which requires the FULL browser cookie jar
// from a real logged-in session (cna, ssxmod_itna, ssxmod_itna2, token, ...). The user pastes their
// entire cookie string and we replay it verbatim, plus extract the bearer `token` from it.
//
// Auth input (apiKey field): the FULL Cookie header from chat.qwen.ai
// (must include cna, ssxmod_itna, and token). A bare bearer token alone is rejected by the WAF.
export default {
  id: "qwen-web",
  priority: 130,
  alias: "qwen-web",
  uiAlias: "qwen-web",
  display: {
    name: "Qwen Web (Subscription)",
    icon: "hub",
    color: "#615CED",
    textIcon: "QW",
    website: "https://chat.qwen.ai",
    notice: {
      signupUrl: "https://chat.qwen.ai",
      apiKeyUrl: "https://chat.qwen.ai",
      text: "Alibaba Tongyi Qwen Chat free web access. Open chat.qwen.ai, log in, then copy your FULL Cookie header (DevTools → Network → any request → Request Headers → Cookie, or DevTools → Application → Cookies). Paste ALL cookies here — the WAF (baxia) requires the complete cookie jar (cna, ssxmod_itna, token, ...), not just the bearer token. The auth token is read from the `token` cookie automatically. Responses are streamed from the v2 API and translated to OpenAI format.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your FULL Cookie header from chat.qwen.ai (must include cna, ssxmod_itna and token cookies).",
  transport: {
    baseUrl: "https://chat.qwen.ai",
    format: "qwen-web",
    authType: "cookie",
  },
  // Model entries include capability flags (contextWindow, maxOutput,
  // supportsReasoning/vision/toolCalling) so the model picker + capability
  // resolver surface them correctly. Port of OmniRoute commit ccdbc89 (Part 2/3).
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
      id: "qwen3.6-plus",
      name: "Qwen3.6 Plus",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
  ],
  passthroughModels: true,
};
