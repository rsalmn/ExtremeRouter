// Microsoft Copilot (copilot.microsoft.com) — Web session provider via WebSocket API.
// Reverse-ported from OmniRoute's copilot-web executor. The flow is:
//   1. POST /c/api/start → conversationId (+ session cookies)
//   2. WS connect wss://copilot.microsoft.com/c/api/chat?api-version=2
//   3. Send {event:"send", conversationId, content, mode}
//   4. Receive a stream of JSON events (appendText, chainOfThought, done, error, ...)
//
// Auth: access_token from copilot.microsoft.com (extracted from DevTools/HAR) pasted into
// the apiKey credential field. Anonymous access is supported with limited models.
// transport.baseUrl points at the WebSocket endpoint; the /c/api/start URL is derived from
// it inside the executor.
export default {
  id: "copilot-web",
  priority: 150,
  alias: "copilot-web",
  aliases: [
    "copilot",
  ],
  uiAlias: "copilot",
  display: {
    name: "Microsoft Copilot Web (Cookie)",
    icon: "smart_toy",
    color: "#0A7BBA",
    textIcon: "CP",
    website: "https://copilot.microsoft.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your access_token from copilot.microsoft.com (anonymous works with limited models)",
  transport: {
    baseUrl: "wss://copilot.microsoft.com/c/api/chat?api-version=2",
    format: "copilot-web",
    authType: "cookie",
  },
  models: [
    { id: "copilot", name: "Copilot Chat" },
    { id: "copilot-chat", name: "Copilot Chat" },
    { id: "copilot-think", name: "Copilot Think (reasoning)" },
    { id: "copilot-think-deeper", name: "Copilot Think Deeper (reasoning)" },
    { id: "copilot-smart", name: "Copilot Smart" },
    { id: "copilot-gpt5", name: "Copilot GPT-5" },
    { id: "copilot-study", name: "Copilot Study" },
    { id: "gpt-4o", name: "GPT-4o (via Copilot)" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo (via Copilot)" },
    { id: "gpt-4", name: "GPT-4 (via Copilot)" },
    { id: "gpt-5", name: "GPT-5 (via Copilot)" },
    { id: "o1", name: "o1 (reasoning)" },
    { id: "o3", name: "o3 (reasoning)" },
  ],
  passthroughModels: true,
};
