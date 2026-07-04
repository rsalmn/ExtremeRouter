// Devin (by Cognition) — session-based AI software engineer API.
//
// IMPORTANT: Devin does NOT expose an OpenAI-compatible /chat/completions endpoint.
// Instead, the API is session-based: create a session → poll for completion → read messages.
// The DevinExecutor (open-sse/executors/devin.js) bridges this by translating OpenAI chat
// requests into Devin session lifecycle calls and synthesizing an SSE stream back.
//
// Auth: API key only (Bearer token, prefix "cog_"). There is NO OAuth flow for the API.
//   Get a key at: https://app.devin.ai/settings (Account Settings → API Keys)
//
// "Models" map to Devin agent modes (the only knobs the session API exposes):
//   devin-normal → mode "normal" (default Agent)
//   devin-fast   → mode "fast"   (Fast mode)
//   devin-lite   → mode "lite"   (Devin Lite)
//   devin-ultra  → mode "ultra"  (Devin Ultra)
//
// The organization id is sent per-request via the X-Devin-Organization header (resolved from
// providerSpecificData.orgId in the connection). If omitted, the API uses the key's default org.
//
// Sources:
//   https://docs.devin.ai/api-reference/authentication
//   https://docs.devin.ai/api-reference/v1/sessions/create-a-new-devin-session
//   https://docs.devin.ai/api-reference/v1/sessions/retrieve-details-about-an-existing-devin-session
//   https://docs.devin.ai/api-reference/v1/sessions/send-a-message-to-an-existing-devin-session
export default {
  id: "devin",
  priority: 70,
  alias: "devin",
  uiAlias: "devin",
  display: {
    name: "Devin CLI",
    icon: "smart_toy",
    color: "#7C5CFF",
    textIcon: "DV",
    website: "https://devin.ai",
    notice: {
      signupUrl: "https://app.devin.ai",
      apiKeyUrl: "https://app.devin.ai/settings",
      text: "Devin (by Cognition) is a session-based AI software engineer. Create an API key (cog_...) in your Devin account settings. Each model below maps to a Devin agent mode. Responses are aggregated from Devin sessions and streamed back — they may take longer than a typical chat model.",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  hasOAuth: false,
  transport: {
    // Base URL of the Devin REST API. The executor builds full per-call URLs from this.
    baseUrl: "https://api.devin.ai",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  // Each model = one Devin agent mode. upstreamModelId carries the mode value sent to the API.
  models: [
    { id: "devin-normal", name: "Devin (Normal)", upstreamModelId: "normal" },
    { id: "devin-fast", name: "Devin (Fast)", upstreamModelId: "fast" },
    { id: "devin-lite", name: "Devin Lite", upstreamModelId: "lite" },
    { id: "devin-ultra", name: "Devin Ultra", upstreamModelId: "ultra" },
  ],
};
