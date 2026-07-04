// ChatGPT Web (chatgpt.com) — web-cookie reverse of the consumer ChatGPT chat.
//
// NOTE — anti-bot reality: chatgpt.com runs an aggressive Sentinel anti-bot stack (proof-of-work,
// Turnstile, device-id + TLS fingerprint scoring). OmniRoute defeats it with native TLS
// impersonation (chatgptTlsClient). ExtremeRouter uses plain Node fetch, so even though this port
// solves the proof-of-work and posts the exact headers, requests will usually be blocked (403 /
// "needs a browser" / cf-mitigated). If it fails, your __Secure-next-auth.session-token cookie is
// likely still valid — the TLS fingerprint is rejected, not your login. This is an anti-bot
// limitation, not a code bug.
//
// Auth input: the FULL cookie string from chatgpt.com, including the NextAuth session token
// (paste the value of __Secure-next-auth.session-token, or the whole "Cookie:" DevTools line).
export default {
  id: "chatgpt-web",
  priority: 150,
  alias: "chatgpt-web",
  aliases: ["cgpt-web"],
  uiAlias: "cgpt-web",
  display: {
    name: "ChatGPT Web (chatgpt.com)",
    icon: "smart_toy",
    color: "#10A37F",
    textIcon: "CW",
    website: "https://chatgpt.com",
    notice: {
      signupUrl: "https://chatgpt.com",
      apiKeyUrl: "https://chatgpt.com",
      text: "ChatGPT Web (chatgpt.com) cookie provider (Plus/Pro session). Open chatgpt.com, log in, then copy your __Secure-next-auth.session-token cookie value (or the full 'Cookie:' line from DevTools → Network). ⚠️ chatgpt.com uses Sentinel anti-bot (proof-of-work + Turnstile + TLS fingerprint). OmniRoute bypasses it with native TLS impersonation; ExtremeRouter does NOT have that, so even though we solve the PoW and send exact headers, requests usually get blocked (403 / 'needs a browser'). Your cookie is probably valid when that happens — the TLS fingerprint is rejected, not your login. For reliable access use the official 'openai' provider instead.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your chatgpt.com __Secure-next-auth.session-token value (or full Cookie line).",
  transport: {
    baseUrl: "https://chatgpt.com/backend-api/f/conversation",
    format: "chatgpt-web",
    authType: "cookie",
  },
  models: [
    { id: "gpt-5.5-pro", name: "GPT-5.5 Pro" },
    { id: "gpt-5.5-pro-extended", name: "GPT-5.5 Pro Extended" },
    { id: "gpt-5.5-thinking", name: "GPT-5.5 Thinking" },
    { id: "gpt-5.5", name: "GPT-5.5 Instant" },
    { id: "gpt-5.4-pro", name: "GPT-5.4 Pro" },
    { id: "gpt-5.4-thinking", name: "GPT-5.4 Thinking" },
    { id: "gpt-5.4-thinking-mini", name: "GPT-5.4 Thinking Mini" },
    { id: "gpt-5.3", name: "GPT-5.3 Instant" },
    { id: "gpt-5.3-mini", name: "GPT-5.3 Mini" },
    { id: "o3", name: "o3" },
  ],
  passthroughModels: true,
};
