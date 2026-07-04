// Muse Spark Web — Meta AI (meta.ai) consumer web reverse-adapter.
//
// Ported from OmniRoute's muse-spark-web executor. meta.ai is NOT an OpenAI-compatible
// API: the MuseSparkWebExecutor (open-sse/executors/muse-spark-web.js) bridges it by POSTing
// a GraphQL persisted-query "subscription" to https://www.meta.ai/api/graphql and translating
// the streamed AssistantMessage payloads into OpenAI chat.completion.chunk frames.
//
// Auth: the `ecto_1_sess` session cookie (formerly `abra_sess` before the Abra→Ecto rebrand).
// Users paste either the bare cookie value or a full cookie line; the executor normalizes it.
// Conversation continuity is preserved via an in-memory cache keyed by (connectionId, model,
// normalized history prefix) so repeated /v1/chat/completions turns grow one meta.ai convo.
export default {
  id: "muse-spark-web",
  priority: 150,
  alias: "muse-spark-web",
  aliases: [
    "ms-web",
  ],
  uiAlias: "ms-web",
  display: {
    name: "Muse Spark Web (Meta AI)",
    icon: "auto_awesome",
    color: "#0866FF",
    textIcon: "MS",
    website: "https://www.meta.ai",
    notice: {
      signupUrl: "https://www.meta.ai",
      apiKeyUrl: "https://www.meta.ai",
      text: "Muse Spark (Meta AI) free web chat. Log into meta.ai, then copy the ecto_1_sess cookie value from DevTools → Application → Cookies → www.meta.ai. Paste it here (bare value or full cookie line). Streaming responses from Meta's GraphQL endpoint are translated to OpenAI format. Thinking/contemplating models expose reasoning_content.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your meta.ai ecto_1_sess cookie value (or the full cookie line from DevTools).",
  transport: {
    baseUrl: "https://www.meta.ai/api/graphql",
    format: "muse-spark-web",
    authType: "cookie",
  },
  models: [
    { id: "muse-spark", name: "Muse Spark" },
    { id: "muse-spark-thinking", name: "Muse Spark Thinking", supportsReasoning: true },
    { id: "muse-spark-contemplating", name: "Muse Spark Contemplating", supportsReasoning: true },
  ],
  passthroughModels: true,
};
