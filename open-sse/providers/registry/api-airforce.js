// api.airforce — OpenAI-compatible gateway with session-cookie → API-key exchange.
//
// api.airforce exposes a standard OpenAI /v1/chat/completions endpoint, but the
// credential the user pastes is a web SESSION cookie (`airforce_session` JWT from
// the dashboard at api.airforce/playground/), NOT an API key. The session JWT is
// rejected by /v1/* with 401 "Invalid API key" if sent as a Bearer token.
//
// The executor (open-sse/executors/api-airforce.js) resolves this by:
//   1. GET https://api.airforce/api/me with `Cookie: airforce_session=<jwt>`
//      → returns the account JSON including the real `api_key` ("sk-air-...").
//   2. Caches that api_key (per-credential, 10 min TTL) to avoid re-fetching.
//   3. Forwards standard OpenAI chat.completions requests with
//      `Authorization: Bearer <api_key>` to https://api.airforce/v1/chat/completions.
//
// Auth input: the `airforce_session` cookie value (a JWT), OR the full
// `airforce_session=<jwt>` cookie string, OR the full Cookie header from
// api.airforce. A bare value with no `=` is wrapped as
// `airforce_session=<value>`.
//
// Free tier: 10 free chat models (gpt-4o-mini, glm-4.7-flash, gpt-oss-120b,
// gpt-oss-20b, minimax-m2.5, seed-rp, etc.) subject to a global 1 req/s rate
// limit. Paid models (claude-sonnet-4.6-rp, gpt-5, etc.) work if the account has
// a positive Pay-As-You-Go balance.
export default {
  id: "api-airforce",
  priority: 70,
  alias: "airforce",
  aliases: [
    "airforce",
    "af",
  ],
  uiAlias: "airforce",
  display: {
    name: "Api.Airforce",
    icon: "flight",
    color: "#6366F1",
    textIcon: "AF",
    website: "https://api.airforce",
    notice: {
      signupUrl: "https://api.airforce/playground/",
      apiKeyUrl: "https://api.airforce/playground/",
      text: "Api.Airforce is an OpenAI-compatible gateway with 65+ models. Log in at api.airforce/playground/, then open DevTools → Application → Cookies → copy the `airforce_session` cookie value (a JWT starting with eyJ). Paste it here — ExtremeRouter exchanges it for your API key automatically. Free tier: 10 free chat models (gpt-4o-mini, glm-4.7-flash, gpt-oss-120b/20b). Paid models need a positive balance at api.airforce/dashboard.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your airforce_session cookie value (JWT from api.airforce DevTools → Application → Cookies), or the full `airforce_session=...` cookie string.",
  transport: {
    baseUrl: "https://api.airforce/v1/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  // Catalog: free chat models (verified from /v1/models, tier:"free" + supports_chat:true).
  // passthroughModels allows paid models to be used when the account has balance.
  models: [
    { id: "gpt-4o-mini", name: "GPT-4o mini (Free)" },
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash (Free)" },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B (Free)" },
    { id: "gpt-oss-20b", name: "GPT-OSS 20B (Free)" },
    { id: "minimax-m2.5", name: "MiniMax M2.5 (Free)" },
    { id: "seed-rp", name: "Seed RP (Free)" },
    { id: "unmoderated-gpt", name: "Unmoderated GPT (Free)" },
    { id: "gemma3-270m:free", name: "Gemma 3 270M (Free)" },
    { id: "rnj-1", name: "RNJ-1 (Free)" },
    { id: "plutotext-r3-emotional", name: "PlutoText R3 Emotional (Free)" },
    // Popular paid models (require balance)
    { id: "claude-sonnet-4.6-rp", name: "Claude Sonnet 4.6 (Paid)" },
    { id: "claude-opus-4.5-rp", name: "Claude Opus 4.5 (Paid)" },
    { id: "gpt-5", name: "GPT-5 (Paid)" },
    { id: "deepseek-v3-0324", name: "DeepSeek V3.2 (Paid)" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Paid)" },
  ],
  passthroughModels: true,
};
