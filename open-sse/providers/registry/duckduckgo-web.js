// DuckDuckGo AI Chat — anonymous free reverse of duckduckgo.com/duckchat.
//
// DuckDuckGo AI Chat is free and requires NO credentials. It uses an anonymous VQD token
// flow (acquired from /duckchat/v1/status) plus browser-like headers. The
// DuckDuckGoWebExecutor (open-sse/executors/duckduckgo-web.js) handles VQD acquisition,
// the x-vqd-4 header, and translates the NDJSON SSE stream into OpenAI chunks.
//
// Auth input: NONE — authType "none". The credential field is unused; a VQD token is
// fetched per request.
export default {
  id: "duckduckgo-web",
  priority: 60,
  alias: "duckduckgo-web",
  aliases: [
    "ddgw",
  ],
  uiAlias: "ddgw",
  display: {
    name: "DuckDuckGo AI Chat",
    icon: "public",
    color: "#DE5833",
    textIcon: "DD",
    website: "https://duckduckgo.com/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1",
    notice: {
      signupUrl: "https://duckduckgo.com/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1",
      apiKeyUrl: "https://duckduckgo.com/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1",
      text: "DuckDuckGo AI Chat is free and anonymous — no login or cookie required. It exposes GPT-4o Mini, GPT-5 Mini, Claude 3.5 Haiku, Llama 4 Scout, Mistral Small and O3 Mini. No credential is needed; an anonymous VQD token is acquired per request. DuckDuckGo rate-limits anonymous sessions, so it is best for light use.",
    },
  },
  category: "webCookie",
  authType: "none",
  noAuth: true,
  authHint: "No credential needed — DuckDuckGo AI Chat is free and anonymous.",
  transport: {
    baseUrl: "https://duckduckgo.com",
    format: "duckduckgo-web",
    authType: "none",
  },
  models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
    { id: "llama-4-scout", name: "Llama 4 Scout" },
    { id: "mistral-small-2501", name: "Mistral Small" },
    { id: "o3-mini", name: "O3 Mini" },
  ],
  passthroughModels: true,
};
