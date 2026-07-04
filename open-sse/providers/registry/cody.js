// Cody (Sourcegraph) — coding assistant with a generous free plan.
//
// Sourcegraph's Cody exposes an OpenAI-compatible chat-completions endpoint at
// https://sourcegraph.com/.api/llm that accepts a personal access token (sgp_...)
// as a Bearer API key. The model id encodes both the vendor and model, e.g.
// `anthropic::...::claude-sonnet-4`, `openai::...::gpt-4o`, `google::...::gemini-2.5-pro`.
//
// Auth: API key (Bearer sgp_...). No OAuth — get a token from
//   https://sourcegraph.com/user/settings/tokens (the Cody free plan includes
//   ~200 messages/month on Claude Sonnet 4 / GPT-4o / Gemini Pro).
// Endpoint: POST https://sourcegraph.com/.api/llm/completions/Stream
//           (OpenAI-shaped body; the legacy path is /.api/llm — Stream is the
//           streaming-aware one used by the Cody editor).
//
// The CodyExecutor is just a thin DefaultExecutor-compatible adapter (OpenAI
// format passthrough) since the wire protocol is already OpenAI-compatible.
export default {
  id: "cody",
  priority: 50,
  alias: "cody",
  uiAlias: "cody",
  display: {
    name: "Cody (Sourcegraph)",
    icon: "code_blocks",
    color: "#FF6B35",
    textIcon: "CO",
    website: "https://sourcegraph.com/cody",
    notice: {
      signupUrl: "https://sourcegraph.com/cody",
      apiKeyUrl: "https://sourcegraph.com/user/settings/tokens",
      text: "Sourcegraph Cody — coding assistant with a free plan (~200 messages/month). Create a personal access token (sgp_...) at sourcegraph.com/user/settings/tokens, then paste it here. Models include Claude Sonnet 4, GPT-4o, and Gemini Pro.",
    },
  },
  category: "oauth",
  authModes: ["apikey"],
  hasOAuth: false,
  transport: {
    // OpenAI-compatible streaming endpoint.
    baseUrl: "https://sourcegraph.com/.api/llm/completions/Stream",
    format: "openai",
    headers: {
      // Cody's gateway rejects requests without a browser-like X-Requested-With.
      "X-Requested-With": "Sourcegraph-Editor",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  // Model ids follow Cody's `vendor::version::model` convention. The Cody editor
  // exposes these via the LLM proxy; only the most useful coding models are listed
  // (the upstream accepts passthrough ids too via passthroughModels).
  models: [
    { id: "anthropic::new::claude-sonnet-4", name: "Claude Sonnet 4 (Cody)" },
    { id: "anthropic::new::claude-haiku-4", name: "Claude Haiku 4 (Cody)" },
    { id: "anthropic::new::claude-3.7-sonnet", name: "Claude 3.7 Sonnet (Cody)" },
    { id: "openai::new::gpt-4o", name: "GPT-4o (Cody)" },
    { id: "openai::new::o3-mini", name: "o3-mini (Cody)" },
    { id: "google::new::gemini-2.5-pro", name: "Gemini 2.5 Pro (Cody)" },
    { id: "google::new::gemini-2.0-flash", name: "Gemini 2.0 Flash (Cody)" },
    { id: "mixtral-8x22B", name: "Mixtral 8x22B (Cody)" },
  ],
  passthroughModels: true,
};
