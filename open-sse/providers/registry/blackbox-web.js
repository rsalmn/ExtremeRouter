// Blackbox AI — web-cookie reverse of the consumer app (app.blackbox.ai).
//
// Unlike the official Blackbox API key provider (api.blackbox.ai/v1, category:"apikey"),
// this is the consumer web app. It authenticates via a `next-auth.session-token` cookie.
// The BlackboxWebExecutor (open-sse/executors/blackbox-web.js) bridges the web `/api/chat`
// endpoint to an OpenAI-compatible interface. Premium models require a paid subscription,
// surfaced from `/api/check-subscription` per session.
//
// Auth input: the FULL cookie string from app.blackbox.ai (DevTools → Application → Cookies).
// The executor strips a leading `Cookie:`/`bearer ` prefix and wraps a bare value as
// `next-auth.session-token=<value>`.
export default {
  id: "blackbox-web",
  priority: 60,
  alias: "blackbox-web",
  aliases: [
    "bb-web",
  ],
  uiAlias: "bb-web",
  display: {
    name: "Blackbox AI (Web)",
    icon: "smart_toy",
    color: "#5B5FEF",
    textIcon: "BB",
    website: "https://app.blackbox.ai",
    notice: {
      signupUrl: "https://app.blackbox.ai",
      apiKeyUrl: "https://app.blackbox.ai",
      text: "Blackbox AI free/paid web chat. Open app.blackbox.ai, log in, then copy your next-auth.session-token cookie (DevTools → Application → Cookies). Paste the full cookie string here. Premium models require a paid subscription; the executor probes your subscription status automatically.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your app.blackbox.ai cookie (full Cookie header or just the next-auth.session-token value).",
  transport: {
    baseUrl: "https://app.blackbox.ai/api/chat",
    format: "blackbox-web",
    authType: "cookie",
  },
  models: [
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "gpt-4", name: "GPT-4" },
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    { id: "claude-3-opus", name: "Claude 3 Opus" },
    { id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
    { id: "gemini-pro", name: "Gemini Pro" },
  ],
  passthroughModels: true,
};
