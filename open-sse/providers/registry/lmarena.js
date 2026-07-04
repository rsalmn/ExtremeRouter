// LMArena (lmarena.ai) — FREE web model-comparison platform reverse-adapter.
//
// Ported from OmniRoute's lmarena executor. lmarena.ai is a consumer model-arena web app, NOT an
// OpenAI-compatible API. The LMArenaExecutor (open-sse/executors/lmarena.js) bridges it by:
//   1. Reconstructing the single `arena-auth-prod-v1` session cookie from the Supabase-SSR chunked
//      form (arena-auth-prod-v1.0, .1, ...) the site now uses.
//   2. POSTing to /nextjs-api/stream (custom SSE) with the session cookie.
//   3. Translating LMArena's prefixed event lines (a0:/ag:/a3:/ae:/ad:/a2:) into OpenAI
//      chat.completion.chunk frames.
//
// LMArena is FREE for testing models — no subscription required. 40+ frontier models (GPT, Claude,
// Gemini, Llama, ...) are exposed. Log into lmarena.ai, copy the full Cookie header, paste it here.
// Guests work for basic comparisons but login gives higher limits.
export default {
  id: "lmarena",
  priority: 150,
  alias: "lmarena",
  aliases: [
    "lma",
  ],
  uiAlias: "lmarena",
  display: {
    name: "LMArena (Free)",
    icon: "auto_awesome",
    color: "#FF6B6B",
    textIcon: "LMA",
    website: "https://lmarena.ai",
    notice: {
      signupUrl: "https://lmarena.ai",
      apiKeyUrl: "https://lmarena.ai",
      text: "LMArena is FREE for testing models — a model comparison platform with 40+ frontier models (GPT, Claude, Gemini, Llama, ...). No subscription required. Log into lmarena.ai, then copy the FULL Cookie header from any request (DevTools → Network → request → Request Headers → Cookie). The session is now split across arena-auth-prod-v1.0, .1, … — copy the whole header. Paste it here; the executor auto-recombines the chunks. Works with the free tier for basic comparisons.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the full Cookie header from lmarena.ai (DevTools → Network → request → Cookie). Includes arena-auth-prod-v1.0/.1/… chunks.",
  transport: {
    baseUrl: "https://arena.ai/nextjs-api/stream",
    format: "lmarena",
    authType: "cookie",
  },
  // LMArena is a passthrough provider: the client supplies the upstream model id (e.g. "gpt-5",
  // "claude-sonnet-4-5", "gemini-2.5-pro") which is forwarded verbatim to the arena stream API.
  // The list below is a representative catalog of commonly-available models; passthroughModels is
  // true so any other lmarena.ai model id the client sends is forwarded as-is.
  models: [
    { id: "gpt-5", name: "GPT-5 (via LMArena)" },
    { id: "gpt-5-mini", name: "GPT-5 Mini (via LMArena)" },
    { id: "gpt-4.1", name: "GPT-4.1 (via LMArena)" },
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (via LMArena)" },
    { id: "claude-opus-4-1", name: "Claude Opus 4.1 (via LMArena)" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (via LMArena)" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (via LMArena)" },
    { id: "grok-4", name: "Grok 4 (via LMArena)" },
    { id: "deepseek-v3-2", name: "DeepSeek V3.2 (via LMArena)" },
    { id: "qwen3-235b", name: "Qwen3 235B (via LMArena)" },
    { id: "llama-4-maverick", name: "Llama 4 Maverick (via LMArena)" },
  ],
  passthroughModels: true,
};
