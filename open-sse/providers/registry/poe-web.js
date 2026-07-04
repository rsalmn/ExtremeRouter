// Poe (poe.com) — Multi-model chat via Poe's GraphQL API (subscription cookie).
// Reverse-ported from OmniRoute's poe-web executor. Model ids mirror the OmniRoute
// MODEL_MAP (poe-web.ts). Poe addresses bots by display name; the executor maps the
// requested model id to the bot handle.
export default {
  id: "poe-web",
  priority: 150,
  alias: "poe-web",
  aliases: [
    "poe",
  ],
  uiAlias: "poe",
  display: {
    name: "Poe Web (Subscription)",
    icon: "forum",
    color: "#7C3AED",
    textIcon: "P",
    website: "https://www.poe.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your p-b= cookie value from poe.com",
  transport: {
    baseUrl: "https://www.poe.com/api/gql_POST",
    format: "poe-web",
    authType: "cookie",
  },
  models: [
    { id: "gpt-4o", name: "GPT-4o (via Poe)" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo (via Poe)" },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet (via Poe)" },
    { id: "claude-3-opus", name: "Claude 3 Opus (via Poe)" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (via Poe)" },
    { id: "llama-3-70b", name: "Llama 3 70B (via Poe)" },
    { id: "mixtral-8x22b", name: "Mixtral 8x22B (via Poe)" },
    { id: "poe-default", name: "Poe Assistant" },
  ],
  passthroughModels: true,
};
