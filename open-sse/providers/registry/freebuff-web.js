// FreeBuff — free consumer web chat (freebuff.com/chat).
//
// FreeBuff is a free AI assistant with web search, coding help, and deep
// reasoning. Auth via NextAuth.js session cookie (__Secure-next-auth.session-token).
//
// The FreeBuffWebExecutor (open-sse/executors/freebuff-web.js) bridges the
// NextAuth web API to an OpenAI-compatible interface:
//   1. POST /api/chat/stream { threadId, content, images, attachments }
//      → SSE stream of { type, text } events
//   2. Translate SSE events → OpenAI chat.completion.chunk frames:
//      - "delta" → content delta
//      - "reasoning_delta" → reasoning_content delta
//      - "done" → finish_reason: stop
//
// Auth input: the FULL cookie string from freebuff.com/chat (DevTools →
// Application → Cookies), or just the __Secure-next-auth.session-token value.
// A bare value with no `=` is wrapped as `__Secure-next-auth.session-token=<value>`.
export default {
  id: "freebuff-web",
  priority: 65,
  alias: "fb",
  aliases: ["freebuff", "freebuff-web"],
  uiAlias: "fb",
  display: {
    name: "FreeBuff",
    icon: "bolt",
    color: "#F97316",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      signupUrl: "https://freebuff.com",
      apiKeyUrl: "https://freebuff.com",
      text: "FreeBuff is a FREE AI assistant with coding help, web research, and deep reasoning. Log in at freebuff.com/chat, then open DevTools → Application → Cookies → copy the __Secure-next-auth.session-token cookie value (or the full cookie string). Default model: deepseek-v4-flash.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your freebuff.com session cookie (__Secure-next-auth.session-token value or full cookie string).",
  transport: {
    baseUrl: "https://freebuff.com/api/chat/stream",
    format: "freebuff-web",
    authType: "cookie",
  },
  models: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (FreeBuff)" },
  ],
  passthroughModels: true,
};
