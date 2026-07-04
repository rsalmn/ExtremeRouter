// Windsurf (Codeium / Devin CLI) — coding IDE with a rich Claude/GPT/Gemini catalog.
//
// STATUS: COMING SOON. Windsurf's inference server speaks gRPC-web + protobuf
// (exa.language_server_pb.LanguageServerService/GetChatMessage), not OpenAI REST.
// A native gRPC-web adapter (with protobuf encoding) is planned; until then this
// entry is a placeholder so users can see the brand and the catalog, but requests
// will surface a clear "gRPC adapter pending" error via the DefaultExecutor.
//
// Auth (planned): import-token — the user runs "Windsurf: Provide Auth Token" in
// the IDE, copies the sk-ws-... API key, and pastes it. The token is used directly
// as `Authorization: Bearer sk-ws-...` against server.self-serve.windsurf.com.
//
// Reference: github.com/diegosouzapw/OmniRoute (WindsurfExecutor, MIT).
export default {
  id: "windsurf",
  priority: 45,
  alias: "ws",
  uiAlias: "ws",
  display: {
    name: "Windsurf",
    icon: "surfing",
    color: "#1FB6FF",
    textIcon: "WS",
    website: "https://windsurf.com",
    notice: {
      signupUrl: "https://windsurf.com",
      apiKeyUrl: "https://windsurf.com/show-auth-token",
      text: "Windsurf coding IDE — Claude Opus 4.7 (full effort tiers), Sonnet 4.6 1M context, GPT-5.5/5.4, Gemini 3.1 Pro, SWE models. ⚠️ COMING SOON: Windsurf speaks gRPC-web+protobuf, not REST — a native adapter is pending. The brand icon & catalog are shown now; chat requests will return a clear 'gRPC adapter pending' error until the adapter lands.",
    },
  },
  category: "oauth",
  authModes: ["apikey"],
  hasOAuth: false,
  // Flag so the UI can render a "Coming Soon" badge on this card.
  comingSoon: true,
  transport: {
    // Placeholder REST endpoint — the real upstream is gRPC-web. The executor
    // (DefaultExecutor, since there's no specialized WindsurfExecutor yet) will
    // return an error explaining the gRPC adapter is pending.
    baseUrl: "https://server.self-serve.windsurf.com",
    format: "openai",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  // Model catalog (full Windsurf catalog, verified against model_configs_v2.bin).
  // Kept here so the UI can advertise what will be available once the adapter lands.
  models: [
    // ── Cognition SWE ──────────────────────────────────────────────────────
    { id: "swe-1.6-fast", name: "SWE-1.6 Fast" },
    { id: "swe-1.6", name: "SWE-1.6" },
    { id: "swe-1.5-fast", name: "SWE-1.5 Fast" },
    { id: "swe-1.5", name: "SWE-1.5" },
    // ── Claude Opus 4.7 — effort-tiered ─────────────────────────────────────
    { id: "claude-opus-4.7-max", name: "Claude Opus 4.7 Max", contextLength: 200000 },
    { id: "claude-opus-4.7-xhigh", name: "Claude Opus 4.7 XHigh", contextLength: 200000 },
    { id: "claude-opus-4.7-high", name: "Claude Opus 4.7 High", contextLength: 200000 },
    { id: "claude-opus-4.7-medium", name: "Claude Opus 4.7 Medium", contextLength: 200000 },
    { id: "claude-opus-4.7-low", name: "Claude Opus 4.7 Low", contextLength: 200000 },
    { id: "claude-opus-4.7-review", name: "Claude Opus 4.7 Review", contextLength: 200000 },
    // ── Claude Sonnet/Opus 4.6 ──────────────────────────────────────────────
    { id: "claude-sonnet-4.6-thinking-1m", name: "Claude Sonnet 4.6 Thinking 1M", contextLength: 1000000 },
    { id: "claude-sonnet-4.6-1m", name: "Claude Sonnet 4.6 1M", contextLength: 1000000 },
    { id: "claude-sonnet-4.6-thinking", name: "Claude Sonnet 4.6 Thinking", contextLength: 200000 },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", contextLength: 200000 },
    { id: "claude-opus-4.6-thinking", name: "Claude Opus 4.6 Thinking", contextLength: 200000 },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6", contextLength: 200000 },
    // ── GPT-5.5 ─────────────────────────────────────────────────────────────
    { id: "gpt-5.5-xhigh", name: "GPT-5.5 XHigh", contextLength: 200000 },
    { id: "gpt-5.5-high", name: "GPT-5.5 High", contextLength: 200000 },
    { id: "gpt-5.5-medium", name: "GPT-5.5 Medium", contextLength: 200000 },
    { id: "gpt-5.5-low", name: "GPT-5.5 Low", contextLength: 200000 },
    // ── Gemini ──────────────────────────────────────────────────────────────
    { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro High", contextLength: 1000000 },
    { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro Low", contextLength: 1000000 },
    { id: "gemini-3.0-flash-high", name: "Gemini 3 Flash High", contextLength: 1000000 },
  ],
  passthroughModels: true,
};
