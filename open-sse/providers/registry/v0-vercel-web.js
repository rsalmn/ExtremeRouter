// v0 (v0.dev) — Vercel's v0 AI code generation tool via session cookie.
// Reverse-ported from OmniRoute's v0-vercel-web executor. Model ids mirror the
// OmniRoute v0-vercel catalog (CHAT_OPENAI_COMPAT_MODELS["v0-vercel"]).
export default {
  id: "v0-vercel-web",
  priority: 150,
  alias: "v0-vercel-web",
  aliases: [
    "v0",
  ],
  uiAlias: "v0",
  display: {
    name: "v0 Web (Cookie)",
    icon: "code",
    color: "#000000",
    textIcon: "v0",
    website: "https://v0.dev",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your full Cookie header from v0.dev",
  transport: {
    baseUrl: "https://v0.dev/api/chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "v0-1.0-md", name: "v0 1.0 MD" },
    { id: "v0-1.5-lg", name: "v0 1.5 LG" },
    { id: "v0-1.5-md", name: "v0 1.5 MD" },
    { id: "v0-default", name: "v0 Default" },
  ],
  passthroughModels: true,
};
