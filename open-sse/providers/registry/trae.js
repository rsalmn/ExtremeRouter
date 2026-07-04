// Trae (ByteDance coding IDE) — SOLO remote agent via session-based API.
//
// Trae has no public OAuth client; the credential is a Cloud-IDE-JWT captured from
// the Trae editor / solo.trae.ai (~14-day lifetime). The flow is session-based:
//   1. POST {base}/chat_sessions  → { data: { chat_session_id, message_id } }
//   2. GET  {base}/chat_sessions/{id}/events?reply_to_message_id={message_id}
//        → text/event-stream. Assistant text streams in `plan_item` events.
//
// Auth: header `Authorization: Cloud-IDE-JWT <token>` (RS256, ~14-day lifetime).
//   The JWT is stored as the connection's apiKey/accessToken. Get it from the
//   Trae editor's globalStorage state.vscdb, or sign in at solo.trae.ai and copy
//   the JWT from the Authorization header in DevTools.
//
// Reference: github.com/diegosouzapw/OmniRoute (TraeExecutor, MIT).
export default {
  id: "trae",
  priority: 55,
  alias: "tr",
  uiAlias: "tr",
  display: {
    name: "Trae (ByteDance)",
    icon: "code",
    color: "#8B5CF6",
    textIcon: "TR",
    website: "https://trae.ai",
    notice: {
      signupUrl: "https://trae.ai",
      apiKeyUrl: "https://solo.trae.ai",
      text: "ByteDance Trae coding IDE — sign in at solo.trae.ai, then copy the Cloud-IDE-JWT token from the Authorization header (DevTools → Network). Lifetime ~14 days. Models include Gemini 3.1 Pro, MiniMax M3 (1M ctx), Kimi K2.5, GPT-5.4/5.2, and an 'auto' router.",
    },
  },
  category: "oauth",
  authModes: ["apikey"],
  hasOAuth: false,
  transport: {
    baseUrl: "https://core-normal.trae.ai/api/remote/v1",
    format: "trae",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "raw", // we build "Cloud-IDE-JWT <token>" ourselves in the executor
    },
  },
  models: [
    { id: "auto", name: "Auto (Code · Server Picks)" },
    { id: "work", name: "Work (Auto · fast)" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", upstreamModelId: "gemini-3.1-pro" },
    { id: "gemini-3-flash-solo", name: "Gemini 3 Flash" },
    { id: "minimax-m3", name: "MiniMax M3", upstreamModelId: "minimax-m3" },
    { id: "minimax-m2.7", name: "MiniMax M2.7" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.2", name: "GPT 5.2" },
  ],
  passthroughModels: true,
};
