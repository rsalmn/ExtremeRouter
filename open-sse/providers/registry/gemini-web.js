// Gemini Web (gemini.google.com) — web-cookie reverse of the consumer Gemini chat.
//
// NOTE — anti-bot reality: gemini.google.com is Google-protected and rejects programmatic
// requests that don't carry a real browser fingerprint. OmniRoute drives this provider via
// Playwright automation; ExtremeRouter has NO browser. This port attempts a direct HTTP fetch
// of the StreamGenerate endpoint with the user's cookies, which will almost certainly be
// blocked (403 / "needs a browser" / empty body). If it fails, the cookies are likely still
// valid — the request shape is rejected for lacking a browser TLS/JS fingerprint, not a code bug.
//
// Auth input: the FULL cookie string from gemini.google.com, including at least
//   __Secure-1PSID and __Secure-1PSIDTS (paste from DevTools → Application → Cookies).
export default {
  id: "gemini-web",
  priority: 150,
  alias: "gemini-web",
  aliases: ["gweb"],
  uiAlias: "gweb",
  display: {
    name: "Gemini Web (Google)",
    icon: "auto_awesome",
    color: "#4285F4",
    textIcon: "GE",
    website: "https://gemini.google.com",
    notice: {
      signupUrl: "https://gemini.google.com",
      apiKeyUrl: "https://gemini.google.com/app",
      text: "Gemini Web (gemini.google.com) cookie provider. Open gemini.google.com, log in, then copy your cookies (DevTools → Application → Cookies) — you need at least __Secure-1PSID and __Secure-1PSIDTS. ⚠️ Google blocks programmatic (non-browser) requests: this provider will often fail with 403/empty responses because ExtremeRouter cannot impersonate a browser TLS fingerprint. The cookies are probably valid when this happens — the request shape is rejected, not your login. Responses are translated to OpenAI format.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your gemini.google.com cookies (need __Secure-1PSID + __Secure-1PSIDTS).",
  transport: {
    baseUrl: "https://gemini.google.com/app",
    format: "gemini-web",
    authType: "cookie",
  },
  models: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-pro", name: "Gemini 2.0 Pro" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
  passthroughModels: true,
};
