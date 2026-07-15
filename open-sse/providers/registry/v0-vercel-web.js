// v0 (v0.app) — Vercel's v0 AI code generation tool via session cookie.
//
// v0.app is the new domain (formerly v0.dev). Uses a custom streaming diff
// protocol (line-delimited JSON with nested patches). The V0VercelWebExecutor
// (open-sse/executors/v0-vercel-web.js) parses this protocol and translates
// to OpenAI chat.completion.chunk frames.
//
// Auth: session Cookie from v0.app (user_session JWE + other cookies).
// The user pastes the full Cookie header from their browser DevTools.
export default {
  id: "v0-vercel-web",
  priority: 150,
  alias: "v0-vercel-web",
  aliases: ["v0"],
  uiAlias: "v0",
  display: {
    name: "v0 (Vercel)",
    icon: "code",
    color: "#000000",
    textIcon: "v0",
    website: "https://v0.app",
    notice: {
      signupUrl: "https://v0.app",
      apiKeyUrl: "https://v0.app",
      text: "v0 is Vercel's AI code generation tool. Log in at v0.app, then open DevTools → Application → Cookies → copy the FULL cookie string (must include user_session + v0-last-scope). Default model: v0-mini. Free tier: 5 credits/month.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your full Cookie header from v0.app (must include user_session and v0-last-scope cookies).",
  transport: {
    baseUrl: "https://v0.app/chat/api/chat",
    format: "v0-vercel-web",
    authType: "cookie",
  },
  models: [
    { id: "v0-mini", name: "v0 Mini" },
    { id: "v0-default", name: "v0 Default" },
  ],
  passthroughModels: true,
};
