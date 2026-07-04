// Claude Web (claude.ai) — web-cookie reverse of the consumer Claude.ai chat.
//
// NOTE — anti-bot reality: claude.ai sits behind Cloudflare bot management. OmniRoute defeats
// it with native TLS impersonation (curl-impersonate) + a Turnstile cf_clearance solver and an
// optional Playwright browser bridge. ExtremeRouter has NONE of these and uses plain Node fetch,
// so requests will usually hit a Cloudflare challenge (403 "Just a moment" / cf-mitigated). If it
// fails, your sessionKey cookie is likely still valid — the request is rejected for its TLS
// fingerprint, not bad credentials. This is an anti-bot limitation, not a code bug.
//
// Auth input: the FULL cookie string from claude.ai, including `sessionKey=...` (and ideally a
// matching `cf_clearance=...` scraped from a browser on a residential IP). Paste from
// DevTools → Application → Cookies.
export default {
  id: "claude-web",
  priority: 150,
  alias: "claude-web",
  aliases: ["cw"],
  uiAlias: "cw",
  display: {
    name: "Claude Web (claude.ai)",
    icon: "psychology",
    color: "#D97757",
    textIcon: "CW",
    website: "https://claude.ai",
    notice: {
      signupUrl: "https://claude.ai",
      apiKeyUrl: "https://claude.ai/new",
      text: "Claude Web (claude.ai) cookie provider. Open claude.ai, log in, then copy your cookies (DevTools → Application → Cookies) — you need sessionKey= (and ideally a cf_clearance= scraped from a residential-IP browser). ⚠️ claude.ai is behind Cloudflare bot management: OmniRoute bypasses it with native TLS impersonation + Turnstile solving, which ExtremeRouter does NOT have. Requests will usually be blocked (403 'Just a moment' / cf-mitigated). When this happens your cookie is probably still valid — the TLS fingerprint is rejected, not your login. For reliable access use the official 'claude' provider instead.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your claude.ai cookies (need sessionKey=, and ideally cf_clearance=).",
  transport: {
    // Base of the Claude.ai API. The executor builds the full /organizations/{id}/.../completion URL.
    baseUrl: "https://claude.ai/api",
    format: "claude-web",
    authType: "cookie",
  },
  models: [
    { id: "claude-sonnet-4-6", name: "Claude 4.6 Sonnet (web)" },
    { id: "claude-haiku-4-5", name: "Claude 4.5 Haiku (web)" },
  ],
  passthroughModels: true,
};
