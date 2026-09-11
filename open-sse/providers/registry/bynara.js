// Bynara — multi-model AI router (router.bynara.id).
//
// OpenAI-compatible + Anthropic-native + Responses API gateway behind a single
// API key. Supports LLM chat, image generation, and image editing. Models
// discovered live via /v1/models at runtime.
//
// Multi-endpoint transport with cross-transport fallback: if the OpenAI
// endpoint times out or 5xxs, the engine retries via the Anthropic endpoint
// automatically (body is re-translated to Claude format).
//
// Image generation uses a separate host (api-images.bynara.id).
import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "bynara",
  priority: 350,
  alias: "bynara",
  aliases: ["by"],
  uiAlias: "by",
  display: {
    name: "Bynara",
    icon: "hub",
    color: "#6366F1",
    textIcon: "BY",
    website: "https://router.bynara.id",
    notice: {
      signupUrl: "https://router.bynara.id/register?ref=884C9YJM",
      apiKeyUrl: "https://router.bynara.id/register?ref=884C9YJM",
      text: "Bynara is a multi-model AI router with OpenAI, Anthropic, and Responses API support. Create an API key at router.bynara.id, then paste it here. Supports LLM chat, image generation, and image editing.",
    },
  },
  category: "free",
  hasFree: true,
  authType: "apikey",
  // API-key only. Without this the provider page treats category:"free" as
  // OAuth (FREE_PROVIDERS ⊂ isOAuth) and fires /api/oauth/bynara/authorize →
  // "Unknown provider: bynara" (Bynara is not in the OAuth PROVIDERS map).
  hasOAuth: false,
  authModes: ["apikey"],
  transport: {
    // Default = OpenAI format (most clients use this).
    baseUrl: "https://router.bynara.id/v1/chat/completions",
    format: "openai",
    // Multi-model OpenAI gateway — force openai reasoning_effort. Without this,
    // *deepseek-v4* pattern injects native {thinking:{type:"enabled"}} which
    // Bynara rejects with 400 "model rejected request... parameter invalid".
    thinkingFormat: "openai",
    responsesUrl: "https://router.bynara.id/v1/responses",
    validateUrl: "https://router.bynara.id/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  // Multi-endpoint: both OpenAI and Anthropic formats supported. The engine
  // picks the endpoint matching the client sourceFormat (skip translation),
  // and falls back to the alternate on timeout/5xx (cross-transport fallback).
  transports: [
    {
      format: "openai",
      baseUrl: "https://router.bynara.id/v1/chat/completions",
      responsesUrl: "https://router.bynara.id/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://router.bynara.id/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      // Bynara's /v1/messages authenticates with the same sk-nry- key as a
      // Bearer token (docs: "call this path with your key as the Bearer
      // token"), NOT x-api-key like real Anthropic. Without this the
      // cross-transport fallback would 401.
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  // Live discovery — /v1/models exposes whatever the key has access to.
  // agnes-video-v2.0 is a static override so `getModelType` classifies it as a
  // video (T2V) model: the dynamic /v1/models fetcher does not expose media
  // `kind`, and a video-input modality is NOT text-to-video proof. LLM models
  // remain dynamic/passthrough — only this entry is pinned.
  models: [
    { id: "agnes-video-v2.0", name: "Agnes Video 2.0", kind: "video", params: ["mode", "duration", "ratio", "resolution"] },
  ],
  passthroughModels: true,
  modelsFetcher: {
    url: "https://router.bynara.id/v1/models",
    // bynara-type parser (suggested-models/filters.js) reads the gateway's
    // context_window / vision / reasoning fields directly, instead of the
    // generic OpenAI shape which only understands context_length.
    type: "bynara",
  },
  // Image and video generation via the separate media host.
  serviceKinds: ["llm", "image", "video"],
  imageConfig: {
    baseUrl: "https://api-images.bynara.id/v1/images/generations",
    editUrl: "https://api-images.bynara.id/v1/images/edits",
    bodyFields: ["model", "prompt", "n", "size", "response_format"],
  },
// Video contract: POST /v1/videos with mode=t2v, Bearer sk-nry-... auth; poll
  // GET /v1/videos/{id}; result url is a relative /v1/videos/{id}/download
  // resolved against this host (expiring).
  //
  // HOST NOTE: Bynara docs list api-images.bynara.id, but a live probe showed that
  // host returns an nginx HTML 404 for POST /v1/videos, whereas
  // router.bynara.id/v1/videos answers with a proper JSON API response (401 with
  // a valid route). The working video endpoint is router.bynara.id (same key).
  videoConfig: {
    baseUrl: "https://router.bynara.id/v1/videos",
    bodyFields: ["model", "mode", "prompt", "negative_prompt", "resolution", "ratio", "duration", "seed", "watermark"],
  },
};
