// t3.chat — web-cookie reverse of the consumer chat aggregator (t3.chat).
//
// t3.chat is a TanStack Start app that fronts Claude, GPT, Gemini, DeepSeek, Grok, Llama,
// Mistral, Qwen and Kimi behind a single subscription. It authenticates via cookies,
// including a `convex-session-id` cookie. The T3ChatWebExecutor
// (open-sse/executors/t3-web.js) bridges the `/api/chat` endpoint to an OpenAI-compatible
// interface, translating Turbo Stream Serialization (TSS) / NDJSON responses.
//
// Auth input: the FULL cookie string from t3.chat (DevTools → Application → Cookies),
// which must include `convex-session-id`.
export default {
  id: "t3-web",
  priority: 60,
  alias: "t3-web",
  aliases: [
    "t3chat",
  ],
  uiAlias: "t3chat",
  display: {
    name: "T3 Chat (Web)",
    icon: "chat",
    color: "#6D28D9",
    textIcon: "T3",
    website: "https://t3.chat",
    notice: {
      signupUrl: "https://t3.chat",
      apiKeyUrl: "https://t3.chat",
      text: "T3 Chat aggregates Claude, GPT, Gemini, DeepSeek, Grok, Llama, Mistral, Qwen and Kimi behind one subscription. Open t3.chat, log in, then copy your full Cookie header (DevTools → Network → request → Cookie), including convex-session-id. Paste the full cookie string here. Responses are translated from TanStack Start TSS/NDJSON into OpenAI format.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your t3.chat full Cookie header (must include convex-session-id).",
  transport: {
    baseUrl: "https://t3.chat",
    format: "t3-web",
    authType: "cookie",
  },
  models: [
    // Claude
    { id: "claude-opus-4", name: "Claude Opus 4 (via t3.chat)" },
    { id: "claude-sonnet-4", name: "Claude Sonnet 4 (via t3.chat)" },
    { id: "claude-haiku-4", name: "Claude Haiku 4 (via t3.chat)" },
    { id: "claude-3.7", name: "Claude 3.7 Sonnet (via t3.chat)" },
    // GPT / OpenAI
    { id: "gpt-5", name: "GPT-5 (via t3.chat)" },
    { id: "gpt-4o", name: "GPT-4o (via t3.chat)" },
    { id: "gpt-4.1", name: "GPT-4.1 (via t3.chat)" },
    { id: "o3", name: "o3 (via t3.chat)" },
    { id: "o4-mini", name: "o4-mini (via t3.chat)" },
    // Gemini
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (via t3.chat)" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (via t3.chat)" },
    // DeepSeek
    { id: "deepseek-r1", name: "DeepSeek R1 (via t3.chat)" },
    { id: "deepseek-v3", name: "DeepSeek V3 (via t3.chat)" },
    // Grok
    { id: "grok-3", name: "Grok 3 (via t3.chat)" },
    { id: "grok-3-mini", name: "Grok 3 Mini (via t3.chat)" },
    // Llama / Meta
    { id: "llama-4-maverick", name: "Llama 4 Maverick (via t3.chat)" },
    { id: "llama-4-scout", name: "Llama 4 Scout (via t3.chat)" },
    { id: "llama-3.3-70b", name: "Llama 3.3 70B (via t3.chat)" },
    // Mistral
    { id: "devstral", name: "Devstral (via t3.chat)" },
    { id: "mistral-large", name: "Mistral Large (via t3.chat)" },
    // Qwen
    { id: "qwen3-235b", name: "Qwen3 235B (via t3.chat)" },
    { id: "qwen3-32b", name: "Qwen3 32B (via t3.chat)" },
    // Kimi
    { id: "kimi-k2", name: "Kimi K2 (via t3.chat)" },
  ],
  passthroughModels: true,
};
