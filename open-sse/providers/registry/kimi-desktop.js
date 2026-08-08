// Kimi Desktop — Moonshot Kimi Windows/macOS desktop app.
//
// The desktop app authenticates against the same www.kimi.com chat plane as the
// web client and stores its session as plain JSON at:
//   Windows: %APPDATA%\kimi-desktop\bridge-store\token-store.json
//   macOS:   ~/Library/Application Support/kimi-desktop/bridge-store/token-store.json
// The file holds { origin, tokens: { access_token, refresh_token }, ... } where
// both tokens are JWTs issued by Moonshot "user-center" (app_id: kimi).
//
// Auto-import reads that file and stores the access_token JWT as the connection
// apiKey — the exact input the kimi-web executor consumes (Bearer <JWT> +
// Cookie: kimi-auth=<JWT> against www.kimi.com's Connect-RPC ChatService).
export default {
  id: "kimi-desktop",
  priority: 131,
  alias: "kimi-desktop",
  uiAlias: "kimi-desktop",
  display: {
    name: "Kimi Desktop (App)",
    icon: "auto_fix_high",
    color: "#4338CA",
    textIcon: "KD",
    website: "https://www.kimi.com",
    notice: {
      signupUrl: "https://www.kimi.com",
      text: "Kimi Desktop (Windows/macOS app). Log in on the desktop app, then import the session automatically — the gateway reads the token store in the app's AppData folder and uses it against www.kimi.com. No browser cookies needed. If the session has expired, re-open the desktop app and re-login, then import again.",
    },
  },
  category: "oauth",
  authType: "import_token",
  authHint:
    "Session imported from the Kimi desktop app. Re-import after re-login to refresh.",
  transport: {
    baseUrl: "https://www.kimi.com",
    format: "kimi-web",
    authType: "cookie",
  },
  models: [
    { id: "kimi-default", name: "Kimi Default" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.5-thinking", name: "Kimi K2.5 (Thinking)", supportsReasoning: true },
    { id: "kimi-k2.5-search", name: "Kimi K2.5 (Search)" },
    { id: "kimi-k2.5-thinking-search", name: "Kimi K2.5 (Thinking + Search)", supportsReasoning: true },
    { id: "kimi-2.6-fast", name: "Kimi 2.6 Fast" },
    { id: "kimi-2.6-thinking", name: "Kimi 2.6 (Thinking)", supportsReasoning: true },
    { id: "kimi-2.6-search", name: "Kimi 2.6 (Search)" },
    { id: "kimi-2.6-thinking-search", name: "Kimi 2.6 (Thinking + Search)", supportsReasoning: true },
    { id: "kimi-k2", name: "Kimi K2" },
    { id: "kimi-k2-thinking", name: "Kimi K2 (Thinking)", supportsReasoning: true },
    { id: "kimi-k2-search", name: "Kimi K2 (Search)" },
    { id: "kimi-k2-thinking-search", name: "Kimi K2 (Thinking + Search)", supportsReasoning: true },
    { id: "kimi-thinking", name: "Kimi (Thinking)", supportsReasoning: true },
    { id: "kimi-search", name: "Kimi (Search)" },
    { id: "kimi-thinking-search", name: "Kimi (Thinking + Search)", supportsReasoning: true },
    { id: "kimi-k3", name: "Kimi K3" },
  ],
  passthroughModels: true,
  features: {
    usage: true,
  },
  thinkingConfig: {
    options: ["standard", "high", "max"],
    defaultMode: "high",
  },
  quotaFamily: "kimi-desktop",
  oauth: {
    tokenStoragePath: {
      win32: "%APPDATA%\\kimi-desktop\\bridge-store\\token-store.json",
      darwin: "~/Library/Application Support/kimi-desktop/bridge-store/token-store.json",
    },
    dbKeys: {
      accessToken: "tokens.access_token",
      refreshToken: "tokens.refresh_token",
      userId: "tokens.msh_user_id",
    },
  },
};
