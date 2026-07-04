// Kimi Web — Moonshot AI consumer chat via www.kimi.com (international).
//
// The KimiWebExecutor (open-sse/executors/kimi-web.js) bridges the international consumer chat:
//   1. POST /apiv2/kimi.gateway.chat.v1.ChatService/Chat (Connect-RPC framing)
//   2. Auth: Bearer <JWT> + Cookie: kimi-auth=<JWT>
//   3. Body/Response: 5-byte Connect envelope (flags + length) wrapping JSON
//   4. Response stream carries deltas with mask "block.text.content" (answer) or
//      "block.think.content" (reasoning) via op "set"/"append".
//
// Auth input (apiKey field): the kimi-auth JWT — either bare, or extracted from the full Cookie
// header the user pastes from www.kimi.com. We extract `kimi-auth` and use it both as the Bearer
// token and as the Cookie we send back (so the user's analytics cookies aren't leaked).
export default {
  id: "kimi-web",
  priority: 130,
  alias: "kimi-web",
  uiAlias: "kimi-web",
  display: {
    name: "Kimi Web (Subscription)",
    icon: "auto_fix_high",
    color: "#1F1F1F",
    textIcon: "KM",
    website: "https://www.kimi.com",
    notice: {
      signupUrl: "https://www.kimi.com",
      apiKeyUrl: "https://www.kimi.com",
      text: "Moonshot Kimi free web chat (international). Open www.kimi.com, log in, then copy your Cookie header (DevTools → Application → Cookies → kimi-auth, or DevTools → Network → any request → Cookie). The kimi-auth JWT is what we actually use — paste the full cookie string or just the JWT value. Responses are streamed over the Connect-RPC protocol and translated to OpenAI format.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your Cookie header from www.kimi.com (must contain kimi-auth=<JWT>), or just the kimi-auth JWT value.",
  transport: {
    baseUrl: "https://www.kimi.com",
    format: "kimi-web",
    authType: "cookie",
  },
  models: [
    { id: "kimi-default", name: "Kimi Default" },
    { id: "kimi-k2.6", name: "Kimi K2.6 (Thinking)", supportsReasoning: true },
    { id: "kimi-128k", name: "Kimi 128K (Long Context)" },
  ],
  passthroughModels: true,
};
