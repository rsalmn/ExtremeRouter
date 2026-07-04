// Adapta Web — Adapta (agent.adapta.one) consumer web reverse-adapter.
//
// Ported from OmniRoute's adapta-web executor. Adapta is an agentic-chat web app, NOT an
// OpenAI-compatible API. The AdaptaWebExecutor (open-sse/executors/adapta-web.js) bridges it by:
//   1. Exchanging the long-lived Clerk `__client` JWT for a short-lived session JWT via Clerk's
//      /v1/client + /v1/client/sessions/{id}/tokens endpoints (cached, auto-refreshed).
//   2. POSTing to /api/chat/stream/v1 (Vercel AI SDK SSE) with a Bearer session JWT.
//   3. Translating text-delta/done/error frames into OpenAI chat.completion.chunk frames.
//
// Auth: the `__client` cookie from clerk.agent.adapta.one. Paste the bare JWT value or the
// full `__client=<jwt>` pair — the executor extracts the JWT either way.
export default {
  id: "adapta-web",
  priority: 150,
  alias: "adapta-web",
  aliases: [
    "adp-web",
  ],
  uiAlias: "adp-web",
  display: {
    name: "Adapta Web",
    icon: "hub",
    color: "#7C3AED",
    textIcon: "AD",
    website: "https://agent.adapta.one",
    notice: {
      signupUrl: "https://agent.adapta.one",
      apiKeyUrl: "https://agent.adapta.one",
      text: "Adapta agentic chat (GPT/Claude/Gemini/Grok/DeepSeek/Llama routed via Adapta's 'ONE' auto-select). Log into agent.adapta.one, then copy the __client cookie value from DevTools → Application → Cookies → clerk.agent.adapta.one. Paste it here (bare JWT or __client=<jwt>). The executor auto-refreshes the short-lived session JWT via Clerk. Streaming is translated to OpenAI format.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your clerk.agent.adapta.one __client cookie value (bare JWT or __client=<jwt>).",
  transport: {
    baseUrl: "https://agent.adapta.one/api/chat/stream/v1",
    format: "adapta-web",
    authType: "cookie",
  },
  models: [
    { id: "adapta-one", name: "Adapta ONE (Auto)" },
    { id: "adapta-gpt", name: "GPT-5 (via Adapta)" },
    { id: "adapta-claude", name: "Claude Sonnet 4.6 (via Adapta)" },
    { id: "adapta-gemini", name: "Gemini 2.5 Pro (via Adapta)" },
    { id: "adapta-grok", name: "Grok 4 (via Adapta)" },
    { id: "adapta-deepseek", name: "DeepSeek R2 (via Adapta)" },
    { id: "adapta-llama", name: "Llama 4 (via Adapta)" },
  ],
  passthroughModels: true,
};
