// Doubao Web (doubao.com) — ByteDance consumer chat via session cookie.
// Reverse-ported from OmniRoute's doubao-web executor. Model catalog mirrors the
// OmniRoute registry (doubao/web/index.ts).
export default {
  id: "doubao-web",
  priority: 150,
  alias: "doubao-web",
  aliases: [
    "db",
  ],
  uiAlias: "db",
  display: {
    name: "Doubao Web (Cookie)",
    icon: "smart_toy",
    color: "#3B5BFF",
    textIcon: "豆",
    website: "https://www.doubao.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your full Cookie header from doubao.com",
  transport: {
    baseUrl: "https://www.doubao.com/api/chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "doubao-default", name: "Doubao Default" },
    { id: "doubao-pro", name: "Doubao Pro" },
  ],
  passthroughModels: true,
};
