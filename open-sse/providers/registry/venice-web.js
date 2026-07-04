// Venice — web-cookie reverse of venice.ai (privacy-focused consumer chat).
//
// Unlike the official Venice developer API (api.venice.ai, Bearer key), this is the consumer
// web app. It authenticates via a session cookie from venice.ai. The VeniceWebExecutor
// (open-sse/executors/venice-web.js) bridges the `/api/chat` endpoint to an OpenAI-compatible
// interface, translating the SSE stream (or full JSON) into OpenAI chunks.
//
// Auth input: the FULL cookie string from venice.ai (DevTools → Application → Cookies).
// The executor strips a leading `Cookie:` prefix.
export default {
  id: "venice-web",
  priority: 60,
  alias: "venice-web",
  aliases: [
    "venice",
    "ven-web",
  ],
  uiAlias: "ven-web",
  display: {
    name: "Venice (Web)",
    icon: "lock",
    color: "#9333EA",
    textIcon: "VE",
    website: "https://venice.ai",
    notice: {
      signupUrl: "https://venice.ai",
      apiKeyUrl: "https://venice.ai",
      text: "Venice is a privacy-focused AI chat. Open venice.ai, log in, then copy your full Cookie header (DevTools → Application → Cookies). Paste the full cookie string here. Responses are streamed from the web /api/chat endpoint and translated to OpenAI format.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your venice.ai full Cookie header.",
  transport: {
    baseUrl: "https://venice.ai",
    format: "venice-web",
    authType: "cookie",
  },
  models: [
    { id: "venice-latest", name: "Venice Latest" },
    { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
    { id: "deepseek-r1", name: "DeepSeek R1" },
    { id: "qwen-2.5-coder", name: "Qwen 2.5 Coder" },
  ],
  passthroughModels: true,
};
