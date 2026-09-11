// Model capabilities — what each model can read/do beyond plain text.
//
// Fallback order (first match wins), result merged over DEFAULT_CAPABILITIES:
//   1. PROVIDER_CAPABILITIES[provider][model]  — provider-specific override
//   2. MODEL_CAPABILITIES[model]               — canonical exact id (handles exceptions)
//   3. PATTERN_CAPABILITIES                     — glob match, ordered specific -> generic
//   4. DEFAULT_CAPABILITIES                     — safe floor (always returned)
//
// Two refinement layers then apply to tiers 2-4, and NEITHER can override an
// explicit hand-written statement (tier 1 short-circuits before they run; a
// key the matched tier declared explicitly is never touched):
//   • the synced catalog — modalities are MODEL-level evidence (keyed by
//     canonical base id, majority-voted across models.dev sources), limits are
//     GATEWAY-level evidence (keyed provider + model). Sourced from models.dev
//     in the background; injected via setCatalogSource() so this module stays
//     free of filesystem imports (it is bundled into the browser through
//     useModelCaps). Registry-declared limits still outrank catalog limits.
//   • the PATTERN_CAPABILITIES family rules themselves — already the last
//     name-heuristic tier; the catalog adds evidence BELOW the hand-written
//     tables, never above them.
//
// ── HOW TO ADD / UPDATE A MODEL ──────────────────────────────────────
// Authoritative data source: https://models.dev/api.json (145 providers, 4000+
// models, MIT). Each model exposes the exact fields we map below:
//   modalities.input  ["text","image","pdf","audio","video"] -> vision / pdf / audioInput / videoInput
//   modalities.output ["text","image","audio"]               -> imageOutput / audioOutput
//   reasoning   -> reasoning      tool_call    -> tools
//   limit.context -> contextWindow   limit.output -> maxOutput
// Look up the model id, then:
//   • If a PATTERN below already covers it correctly -> nothing to do.
//   • If it is an exception (pattern would mis-match) -> add an exact entry to
//     MODEL_CAPABILITIES (only the fields that differ from DEFAULT).
//   • If a whole new family -> add an ordered PATTERN (specific before generic).
// NOTE: models.dev has NO "search" flag (web search is a runtime tool, not a
// model spec); set `search` from vendor docs (Claude 4.x+, GPT-5.x/4o, Gemini
// 2.0+, Grok, Perplexity). Verify with: curl -s https://models.dev/api.json

import { matchPattern } from "./pricing.js";
import { getRegistryLimits } from "./registryLimits.js";
import { resolveProviderAlias } from "../services/model.js";

/**
 * Unverified safety floor — every resolved result is merged over this so
 * consumers never need null-checks. These are NOT verified capabilities: a
 * result carrying `known: false` reached this floor without any model-specific
 * evidence, and the numbers are a conservative assumption chosen so Token
 * Budget still has a ceiling to enforce (a null ceiling would mean
 * "unconstrained", which is the unsafe direction). Diagnostics and UI should
 * use `known` to distinguish verified limits from this fallback.
 */
export const DEFAULT_CAPABILITIES = {
  // input modalities
  vision: false,        // read images
  pdf: false,           // read PDF / documents
  audioInput: false,    // read audio
  videoInput: false,    // read video
  // output modalities
  imageOutput: false,   // generate images
  audioOutput: false,   // generate audio
  // features
  search: false,        // built-in web search tool / grounding
  tools: true,          // function / tool calling
  reasoning: false,     // thinking / reasoning
  // thinking wire format (only meaningful when reasoning:true). null → derive from transport.format.
  // enum: openai|claude-adaptive|claude-budget|gemini-level|gemini-budget|zai|qwen|deepseek|kimi|minimax|hunyuan|step
  thinkingFormat: null,
  thinkingCanDisable: true,  // false → model cannot turn thinking off (clamp to min instead of disable)
  thinkingRange: null,       // { min, max } for budget formats; null = no clamp
  thinkingMaxEffort: false,  // true → supports "max" reasoning_effort (e.g. gpt-5.6-sol)
  thinkingLevels: null,      // explicit valid reasoning_effort list (e.g. ["low","medium","high"]); null = all levels
  // limits (tokens)
  contextWindow: 200000,
  maxOutput: 64000,
};

// User-added model metadata can carry dashboard service kinds instead of the
// runtime capability names used here. Map those typed model kinds into input /
// output capabilities so custom vision models are not treated as text-only.
const SERVICE_KIND_CAPABILITIES = {
  imageToText: { vision: true },
  image: { imageOutput: true },
  stt: { audioInput: true },
  tts: { audioOutput: true },
  embedding: { tools: false },
};

export function capabilitiesFromServiceKind(kind) {
  return SERVICE_KIND_CAPABILITIES[kind] || null;
}

/**
 * Canonical exact-id overrides — used for exceptions that patterns would
 * otherwise mis-match. Only declare deltas vs DEFAULT.
 */
export const MODEL_CAPABILITIES = {
  // Claude Fable 5.1, 4.6/4.7/4.8 and Kiro Sonnet 5 have 1M context + adaptive
  // thinking (override generic claude pattern). Fable 5.1 is PERMANENTLY adaptive
  // (thinkingCanDisable: false): thinking is always on, so output_config.effort
  // is accepted directly and the explicit thinking switch must NOT be sent.
  "claude-fable-5-1": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.6":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.7":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-7":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-6":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4.6": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4-6": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },

  // Gemini image-gen / OpenAI image / xai image variants
  "gpt-image-1":       { imageOutput: true, tools: false },

  // GLM vision variant (text GLM has no vision)
  "glm-4.6v":          { vision: true, reasoning: true, thinkingFormat: "zai", contextWindow: 128000 },

  // Qwen plain coder/text (no vision) — registry "vision-model" / "coder-model" aliases
  "vision-model":      { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },
  "coder-model":       { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },
};

// Codex OAuth (ChatGPT backend) — per-model context window reported by upstream
// (lower than OpenAI API's 1.05M). Sol differs from Terra/Luna. Port of
// decolua/9router GPT-5.6 Codex reasoning-overrides design.
// thinkingMaxEffort + thinkingLevels mirror the codex override matrix in
// thinkingLevels.js so UI gates (combo "max" option, playground picker) see
// the real level range instead of the generic openai fallback.
const CODEX_GPT_56_SOL_CAPS = {
  vision: true, reasoning: true, search: true, thinkingFormat: "openai",
  contextWindow: 372000, maxOutput: 128000,
  thinkingMaxEffort: true,
  thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
};
const CODEX_GPT_56_DEFAULT_CAPS = {
  vision: true, reasoning: true, search: true, thinkingFormat: "openai",
  contextWindow: 272000, maxOutput: 128000,
  thinkingMaxEffort: true,
  thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
};

/**
 * Provider-specific capability overrides. Keyed by provider alias/id.
 */
export const PROVIDER_CAPABILITIES = {
  // Codex GPT-5.6 family — provider-scoped so the global *gpt-5.6* patterns
  // (which describe Kiro) can't leak onto cx/ models, and the *gpt-5*codex*
  // 400k default can't override Sol's real 372k window.
  codex: {
    "gpt-6-astra":         { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 },
    "gpt-5.6-sol":         CODEX_GPT_56_SOL_CAPS,
    "gpt-5.6-sol-review":  CODEX_GPT_56_SOL_CAPS,
    "gpt-5.6-terra":       CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-terra-review": CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-luna":        CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-luna-review": CODEX_GPT_56_DEFAULT_CAPS,
  },
  // Fireworks AI — OpenAI-compatible host. transport.thinkingFormat:"openai" makes
  // reasoning models speak OpenAI reasoning_effort. These per-model pins correct
  // generic family patterns that mis-flag Fireworks models:
  //   *kimi*k2*     → vision + kimi thinking format (k2-instruct-0905 is text-only)
  //   *glm-5*       → zai thinking format + 200k ctx (glm-5p2 is 1M ctx)
  //   *deepseek*    → reasoning (deepseek-v3p1 is a plain chat model)
  //   *qwen*235b*   → qwen thinking format (OpenAI-style effort here)
  fireworks: {
    "accounts/fireworks/models/glm-5p2":            { reasoning: true, thinkingFormat: "openai", contextWindow: 1048575, maxOutput: 131072 },
    "accounts/fireworks/models/kimi-k2p6":          { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262000, maxOutput: 262000 },
    "accounts/fireworks/models/kimi-k2-instruct-0905": { vision: false, reasoning: false, contextWindow: 262144, maxOutput: 262144 },
    "accounts/fireworks/models/deepseek-v3p1":      { vision: false, reasoning: false, contextWindow: 128000, maxOutput: 16384 },
    "accounts/fireworks/models/qwen3-235b-a22b":    { reasoning: true, thinkingFormat: "openai", contextWindow: 128000, maxOutput: 32768 },
  },
  // NVIDIA NIM is OpenAI-compatible → rejects MiniMax/GLM native `thinking` field.
  // Force openai reasoning_effort format for its reasoning models. #issue
  "nvidia": {
    "minimaxai/minimax-m2.7": { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
    "minimaxai/minimax-m3": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 131072 },
    "z-ai/glm-5.2": { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 128000 },
    "deepseek-ai/deepseek-v4-pro": { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },
    "deepseek-ai/deepseek-v4-flash": { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },
  },
  // CodeBuddy.cn — authoritative per-model metadata from the gateway's model
  // config (contextWindow=maxInputTokens, maxOutput=maxOutputTokens, vision=
  // supportsImages). Every model reasons via OpenAI-style reasoning_effort
  // (see registry thinkingFormat). `onlyReasoning` models can't turn thinking
  // off → thinkingCanDisable:false (clamped to minimal instead of disabled).
  "codebuddy-cn": {
    "glm-5.2":            { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 48000 },
    "glm-5.1":            { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0":            { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0-turbo":      { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5v-turbo":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 38000 },
    // glm-4.7 removed from upstream catalog (2026-08-14); hy3 (Hunyuan) added.
    "hy3":                { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    "minimax-m3":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 48000 },
    "minimax-m2.7":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "kimi-k2.7":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.6":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.5":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 164000, maxOutput: 32000 },
    "hy3-preview":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    "deepseek-v4-pro":    { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    // deepseek-v4-flash → deepseek-v4.1-flash (product-config swap). Server
    // table: maxOutput 50000 → 128000; contextWindow stays 1M. Effort tiers
    // are low/high/xhigh (no minimal/medium) on the CodeBuddy CN gateway.
    "deepseek-v4.1-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "high", "xhigh"], contextWindow: 1000000, maxOutput: 128000 },
    "deepseek-v3-2-volc": { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 96000, maxOutput: 32000 },
  },
  // Bynara (router.bynara.id) — deterministic runtime mirror of the gateway's
  // /v1/models metadata (context_window, vision, reasoning). Live-verified
  // against a real-key /v1/models capture (2026-09-10): ids must match the
  // gateway exactly or the override is dead (falls through to
  // DEFAULT_CAPABILITIES). The live values are also absorbed automatically by
  // the bynara modelsFetcher parser (suggested-models/filters.js) for the
  // providers page; this static block keeps getCapabilitiesForModel correct
  // for picker/combo/playground even before/without that fetch. Reasoning
  // models speak OpenAI reasoning_effort (the gateway's primary chat format).
  bynara: {
    "agnes-2.0-flash":        { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 512000 },
    "agnes-2.5-flash":        { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 512000 },
    // 1M context per live catalog. The old 128000 starved resolveOutputBudget
    // (availableContext<=0 → max_tokens:0 on the wire → provider rejection)
    // for large Swarm-panel prompts on this model.
    "glm-5.3-flash-free":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000 },
    "glm-5.3-free":           { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
    "grok-4.5-free":          { vision: true, contextWindow: 212000 },
    "laguna-s-2.1":           { reasoning: true, thinkingFormat: "openai", contextWindow: 262000 },
    // Live id is ling-3.0-flash-fin-free ("fin" = fine-tune); no vision/reasoning
    // field in the live catalog (docs list no reasoning support) — reasoning
    // stays at the default false. The old "ling-3.0-flash-free" key never matched.
    "ling-3.0-flash-fin-free": { contextWindow: 262000 },
    "minimax-m3-free":        { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000 },
    "mistral-large":          { contextWindow: 252000 },
    "mistral-medium-3-5":     { vision: true, contextWindow: 256000 },
    // Live id is nemotron-3.5-lightning-free (context_window 261996 → rounded to
    // the 262000 convention used by the other mid-tier bynara entries). The old
    // "nemotron-3-ultra" key was dead AND 1M (never true for this model).
    "nemotron-3.5-lightning-free": { contextWindow: 262000 },
    "qwen-3.8-max-free":      { contextWindow: 262144 },
    "qwen3.8-27b":            { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000 },
    "qwen3.8-flash-free":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000 },
    "stepfun-3.7-flash":      { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262000 },
    "tencent-hy3-free":       { contextWindow: 262000 },
    // DeepSeek V4 free/paid on Bynara speak OpenAI reasoning_effort only
    // (gateway rejects native DeepSeek thinking:{type} blocks → HTTP 400).
    "deepseek-v4-pro":        { vision: false, reasoning: true, thinkingFormat: "openai", thinkingMaxEffort: true, contextWindow: 1000000, maxOutput: 384000 },
    "deepseek-v4-pro-free":   { vision: false, reasoning: true, thinkingFormat: "openai", thinkingMaxEffort: true, contextWindow: 1000000, maxOutput: 384000 },
    "deepseek-v4-flash":      { vision: false, reasoning: true, thinkingFormat: "openai", thinkingMaxEffort: true, contextWindow: 1000000, maxOutput: 384000 },
    "deepseek-v4-flash-free": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingMaxEffort: true, contextWindow: 1000000, maxOutput: 384000 },
  },
  // OrcaRouter (api.orcarouter.ai) — multi-provider OpenAI gateway. Live model
  // cards: https://www.orcarouter.ai/api/public/models/<id>. thinkingFormat is
  // also pinned on transport (openai reasoning_effort is the unified wire
  // shape per docs.orcarouter.ai/advanced/reasoning); provider-scoped caps fix
  // context/vision so generic *qwen3.7*/*deepseek-v4* patterns don't inflate
  // free-tier text models to 1M multimodal.
  orcarouter: {
    "orcarouter/free":                 { contextWindow: 1000000, maxOutput: 64000 },
    "orcarouter/fusion":               { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 64000 },
    "orcarouter/fusion-flash":         { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 64000 },
    "orcarouter/fusion-mini":          { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 64000 },
    "qwen/qwen3.8-27b-free":           { vision: false, reasoning: true, thinkingFormat: "openai", contextWindow: 65536, maxOutput: 65536 },
    "qwen/qwen3.8-27b":                { vision: false, reasoning: true, thinkingFormat: "openai", contextWindow: 65536, maxOutput: 65536 },
    "qwen/qwen3.7-max":                { vision: false, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 64000 },
    // Live card reports a 32k window. The 65536 output value this entry
    // originally carried was copied from the qwen3.8-27b sibling (65536/65536)
    // and exceeded the window, handing Token Budget an unreachable ceiling.
    // Clamped to the window pending a model-specific output figure.
    "qwen/qwen3.5-27b":                { vision: true, videoInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 32768, maxOutput: 32768 },
    "deepseek/deepseek-v4-pro":        { vision: false, reasoning: true, thinkingFormat: "openai", thinkingMaxEffort: true, contextWindow: 1048576, maxOutput: 384000 },
    "deepseek/deepseek-v4-pro-free":   { vision: false, reasoning: true, thinkingFormat: "openai", thinkingMaxEffort: true, contextWindow: 1048576, maxOutput: 384000 },
    "deepseek/deepseek-v4-flash":      { vision: false, reasoning: true, thinkingFormat: "openai", thinkingMaxEffort: true, contextWindow: 1048576, maxOutput: 384000 },
    "deepseek/deepseek-v4-flash-free": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingMaxEffort: true, contextWindow: 1048576, maxOutput: 384000 },
    "deepseek/deepseek-reasoner":      { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 384000 },
    "minimax/minimax-m2.7":            { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 204800, maxOutput: 131072 },
    "openai/gpt-5.5":                  { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 },
    "tencent/hy3-free":                { vision: false, contextWindow: 262000 },
  },
  // tokenharbor — AI gateway; pin the Claude 5 flagships to claude-adaptive 1M
  // so the generic *claude*opus*/*claude*fable* pattern (claude-budget 200k)
  // can't win for these models.
  tokenharbor: {
    "claude-opus-5":  { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
    "claude-fable-5": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  },
  // meta-ai — Muse Spark family. Reasoning always on (native reasoning_effort
  // tiers minimal/low/medium/high/xhigh; "none" unsupported → HTTP 400, so
  // thinkingCanDisable false clamps disable requests to minimal). Provider-
  // scoped so the generic *muse-spark* pattern can't leak native effort levels
  // onto muse-spark-web (web bridge doesn't speak OpenAI-compatible effort).
  "meta-ai": {
    // Muse Spark 1.x is fully multimodal (models.dev: image+video+pdf+audio input).
    "muse-spark-1.2":            { vision: true, pdf: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 },
    "muse-spark-1.2-contributor": { vision: true, pdf: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 },
    "muse-spark-1.1":            { vision: true, pdf: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 },
  },
  // opencode — free lane serves muse-spark-1.2-contributor-free via the
  // Responses API (model targetFormat: openai-responses). Same Muse Spark 1.2
  // family as meta-ai's entries: multimodal input, reasoning always on with
  // native effort tiers ("none" unsupported), 1M context / 131072 output
  // (models.dev: opencode/muse-spark-1.2-contributor-free, verified live —
  // /zen/v1/responses accepted the request; /chat/completions 500s).
  opencode: {
    "muse-spark-1.2-contributor-free": { vision: true, pdf: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 },
    "muse-spark-1.3-contributor-free": { vision: true, pdf: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 },
  },
  // codebuddy-intl + workbuddy — same CodeBuddy gateway on their own hosts
  // (codebuddy.ai / workbuddy.ai). WorkBuddy's flagship model is "hy3" (the
  // registry model id); it reasons via OpenAI-style reasoning_effort like every
  // other model on this gateway.
  "codebuddy-intl": {
    "glm-5.3":           { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 48000 },
    "glm-5.3-flash":     { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5.2":            { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 48000 },
    "glm-5.1":            { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0-turbo":      { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5v-turbo":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 38000 },
    "minimax-m3":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 48000 },
    "minimax-m2.7":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "kimi-k3-1":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 1048576 },
    "kimi-k2.7":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.6":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.5":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 164000, maxOutput: 32000 },
    "hy4-preview":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 },
    "hy4-preview-x":      { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 },
    "hy3-preview":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    "deepseek-v4-pro":    { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    "deepseek-v4-flash":  { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    "deepseek-v3-2-volc": { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 96000, maxOutput: 32000 },
  },
  workbuddy: {
    "hy3":               { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 64000 },
    "hy4-preview":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 },
    "hy4-preview-x":     { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 },
    "glm-5.3":           { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 48000 },
    "glm-5.3-flash":     { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5.2":           { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 48000 },
    "glm-5.1":           { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0-turbo":     { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5v-turbo":      { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 38000 },
    "minimax-m3":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 48000 },
    "minimax-m2.7":      { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "kimi-k3-1":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 1048576 },
    "kimi-k2.7":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.6":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.5":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 164000, maxOutput: 32000 },
    "hy3-preview":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    "deepseek-v4-pro":   { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    "deepseek-v4-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    "deepseek-v3-2-volc": { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 96000, maxOutput: 32000 },
  },
  // Qoder — upstream exposes opaque internal ids (dfmodel, kmodel, …); the
  // registry `name` is display-only and capability lookup matches on the raw
  // id, so every qoder model would fall through to DEFAULT_CAPABILITIES
  // (200K) without this map. contextWindow follows the real model family's
  // spec: the /algo/api/v2/model/list max_input_tokens under-reports some
  // windows (GLM-5.3 / Kimi-K3 / Qwen3.8-Max claim 180K but accept more).
  // max_output_tokens arrives as 0 for every model, so outputs are
  // best-guess from the real model family. Vision tags follow the
  // upstream is_vl flag; the executor now passes image_url blocks through
  // (http(s) URLs and inline data: URIs are accepted directly). reasoning:true
  // on all of them — every model can reason; the upstream is_reasoning flag
  // only drives model_config selection. thinkingFormat keeps the true-model
  // family for documentation/UI, but thinkingCanDisable:false everywhere: the
  // executor only forwards messages/tools/max_tokens, and thinking is fixed
  // upstream via modelConfig.is_reasoning — client thinking intent is dropped,
  // so "none" must never be offered as an option.
  "qoder": {
    "ultimate":       { vision: true, reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 }, // Claude Opus 5
    "performance":    { vision: true, reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 }, // Claude Sonnet 5
    "dmodel":         { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // DeepSeek-V4-Pro
    "dfmodel":        { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // DeepSeek-V4-Flash
    "gmodel":         { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },      // GLM-5.3
    "gfmodel":        { vision: true, reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 }, // GLM-5.3-Flash
    "kmodel_latest":  { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },      // Kimi-K3
    "kmodel":         { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 65536 },  // Kimi-K2.7-Code
    "mmodel":         { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 512000 }, // MiniMax-M3
    "qmodel_latest":  { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // Qwen3.7-Max
    "qmodel":         { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // Qwen3.7-Plus
    "qfmodel":        { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // Qwen3.8-Flash
    "qmodel_38max":   { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },      // Qwen3.8-Max
  },
  // xKiro — generated from the LIVE /v1/models snapshot (2026-09-06, all 112
  // chat models). Models WITHOUT a reasoning_efforts object ignore reasoning
  // parameters entirely (xKiro docs) → reasoning:false hides the thinking
  // picker instead of advertising controls that do nothing.
  // Two-position switch shapes are remapped to our enum faithfully:
  //   off/on           → [none, low]      (none = off; positive = switch on)
  //   adaptive/disabled → [none, medium]  (none = off; positive = model decides)
  // For graded sets without an off position a none-intent clamps to the
  // cheapest advertised step, matching xKiro's below-lowest semantics.
  "xkiro": {
    "anthropic/claude-fable-5": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "anthropic/claude-fable-5-1": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "anthropic/claude-haiku-4.5": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high"], contextWindow: 200000, maxOutput: 65536 },
    "anthropic/claude-opus-4.6": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "anthropic/claude-opus-4.7": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "anthropic/claude-opus-4.8": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "anthropic/claude-opus-5": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "anthropic/claude-sonnet-4.6": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "anthropic/claude-sonnet-5": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "deepseek/deepseek-chat-v3.1": { vision: false, reasoning: false, contextWindow: 163840, maxOutput: 65536 },
    "deepseek/deepseek-v3.2": { vision: false, reasoning: false, contextWindow: 131072, maxOutput: 65536 },
    "deepseek/deepseek-v4-flash": { vision: false, reasoning: false, contextWindow: 1048576, maxOutput: 65536 },
    "deepseek/deepseek-v4-flash-0731": { vision: false, reasoning: false, contextWindow: 1048576, maxOutput: 65536 },
    "deepseek/deepseek-v4-flash-vision-exp": { vision: true, reasoning: false, contextWindow: 1048576, maxOutput: 65536 },
    "deepseek/deepseek-v4-pro": { vision: false, reasoning: false, contextWindow: 1048576, maxOutput: 65536 },
    "deepseek/deepseek-v4-pro-0813": { vision: false, reasoning: false, contextWindow: 1048576, maxOutput: 65536 },
    "google/gemini-2.5-flash": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "google/gemini-2.5-pro": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "google/gemini-3-flash": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "google/gemini-3.1-pro": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "google/gemini-3.5-flash": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "google/gemini-3.6-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["minimal", "low", "medium", "high"], contextWindow: 1000000, maxOutput: 65536 },
    "google/gemini-3.7-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high"], contextWindow: 1000000, maxOutput: 65536 },
    "google/gemini-3.8-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high"], contextWindow: 1000000, maxOutput: 65536 },
    "meta/muse-spark-1.2-contributor": { vision: true, reasoning: false, contextWindow: 1048576, maxOutput: 65536 },
    "minimax/minimax-m2.1-highspeed:free": { vision: false, reasoning: false, contextWindow: 204800, maxOutput: 65536 },
    "minimax/minimax-m2.1:free": { vision: false, reasoning: false, contextWindow: 204800, maxOutput: 65536 },
    "minimax/minimax-m2.5": { vision: false, reasoning: false, contextWindow: 204800, maxOutput: 65536 },
    "minimax/minimax-m2.5-highspeed:free": { vision: false, reasoning: false, contextWindow: 204800, maxOutput: 65536 },
    "minimax/minimax-m2.5:free": { vision: false, reasoning: false, contextWindow: 204800, maxOutput: 65536 },
    "minimax/minimax-m2.7": { vision: false, reasoning: false, contextWindow: 204800, maxOutput: 131100 },
    "minimax/minimax-m2.7-highspeed:free": { vision: false, reasoning: false, contextWindow: 204800, maxOutput: 65536 },
    "minimax/minimax-m2.7:free": { vision: false, reasoning: false, contextWindow: 204800, maxOutput: 65536 },
    "minimax/minimax-m2:free": { vision: false, reasoning: false, contextWindow: 204800, maxOutput: 65536 },
    "minimax/minimax-m3": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "minimax/minimax-m3:free": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "medium"], contextWindow: 1000000, maxOutput: 65536 },
    "mistralai/codestral-2508": { vision: false, reasoning: false, contextWindow: 256000, maxOutput: 16384 },
    "mistralai/devstral-medium": { vision: false, reasoning: false, contextWindow: 256000, maxOutput: 16384 },
    "mistralai/ministral-14b": { vision: true, reasoning: false, contextWindow: 256000, maxOutput: 8192 },
    "mistralai/ministral-3b": { vision: true, reasoning: false, contextWindow: 128000, maxOutput: 8192 },
    "mistralai/ministral-8b": { vision: true, reasoning: false, contextWindow: 256000, maxOutput: 8192 },
    "mistralai/mistral-large-2512": { vision: true, reasoning: false, contextWindow: 256000, maxOutput: 16384 },
    "mistralai/mistral-medium-3.5": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "high"], contextWindow: 256000, maxOutput: 65536 },
    "mistralai/mistral-small-2603": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "high"], contextWindow: 256000, maxOutput: 65536 },
    "moonshotai/kimi-k2.5": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "moonshotai/kimi-k2.6": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "moonshotai/kimi-k2.7-code": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "moonshotai/kimi-k3": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "high", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "nvidia/llama-3.3-nemotron-super-49b": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 131072, maxOutput: 65536 },
    "nvidia/nemotron-3-nano": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 1000000, maxOutput: 65536 },
    "nvidia/nemotron-3-nano-omni": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 256000, maxOutput: 65536 },
    "nvidia/nemotron-3-super": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 1000000, maxOutput: 65536 },
    "nvidia/nemotron-3-ultra": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 1000000, maxOutput: 65536 },
    "openai/gpt-5.3-codex-spark": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh"], contextWindow: 128000, maxOutput: 65536 },
    "openai/gpt-5.4": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh"], contextWindow: 1000000, maxOutput: 65536 },
    "openai/gpt-5.4-mini": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh"], contextWindow: 400000, maxOutput: 65536 },
    "openai/gpt-5.5": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh"], contextWindow: 1000000, maxOutput: 65536 },
    "openai/gpt-5.6-luna": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "openai/gpt-5.6-sol": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "openai/gpt-5.6-terra": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "openai/gpt-6-astra": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1050000, maxOutput: 65536 },
    "qwen/qwen-plus-2025-07-28:free": { vision: true, reasoning: false, contextWindow: 131072, maxOutput: 65536 },
    "qwen/qwen3-coder-plus:free": { vision: true, reasoning: false, contextWindow: 1048576, maxOutput: 65536 },
    "qwen/qwen3-max:free": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "qwen/qwen3-omni-flash:free": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "qwen/qwen3-vl-plus:free": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "qwen/qwen3.5-397b-a17b:free": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "qwen/qwen3.5-flash:free": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.5-omni-flash:free": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "qwen/qwen3.5-omni-plus:free": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "qwen/qwen3.5-plus": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.5-plus:free": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.6-27b:free": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "qwen/qwen3.6-35b-a3b:free": { vision: true, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "qwen/qwen3.6-max-preview:free": { vision: false, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "qwen/qwen3.6-plus": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.6-plus:free": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.7-max": { vision: false, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.7-max:free": { vision: false, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.7-plus": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.7-plus:free": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.8-max": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "qwen/qwen3.8-max:free": { vision: true, reasoning: false, contextWindow: 1000000, maxOutput: 65536 },
    "sensenova/sensenova-6.7-flash-lite": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low", "medium", "high"], contextWindow: 262144, maxOutput: 65536 },
    "sensenova/sensenova-6.8-flash-lite": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low", "medium", "high"], contextWindow: 262144, maxOutput: 65536 },
    "tencent/hy3": { vision: false, reasoning: false, contextWindow: 262144, maxOutput: 65536 },
    "tencent/hy4-preview": { vision: false, reasoning: false, contextWindow: 1048576, maxOutput: 65536 },
    "x-ai/grok-4.5": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high"], contextWindow: 500000, maxOutput: 65536 },
    "x-ai/grok-4.6": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "medium", "high", "xhigh"], contextWindow: 500000, maxOutput: 65536 },
    "x-ai/grok-build-0.1": { vision: true, reasoning: false, contextWindow: 256000, maxOutput: 16384 },
    "xiaomi/mimo-v2.5": { vision: true, reasoning: false, contextWindow: 1050000, maxOutput: 65536 },
    "xiaomi/mimo-v2.5-pro": { vision: false, reasoning: false, contextWindow: 1050000, maxOutput: 65536 },
    "z-ai/glm-4.5": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 131072, maxOutput: 65536 },
    "z-ai/glm-4.5-air": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 131072, maxOutput: 65536 },
    "z-ai/glm-4.5-airx": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 131072, maxOutput: 65536 },
    "z-ai/glm-4.5-flash": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 131072, maxOutput: 65536 },
    "z-ai/glm-4.5-x": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 131072, maxOutput: 65536 },
    "z-ai/glm-4.5v": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 65536, maxOutput: 65536 },
    "z-ai/glm-4.6": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 200000, maxOutput: 65536 },
    "z-ai/glm-4.6v": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 128000, maxOutput: 65536 },
    "z-ai/glm-4.6v-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 128000, maxOutput: 65536 },
    "z-ai/glm-4.6v-flashx": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 128000, maxOutput: 65536 },
    "z-ai/glm-4.7": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 200000, maxOutput: 65536 },
    "z-ai/glm-4.7-flash": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 200000, maxOutput: 65536 },
    "z-ai/glm-4.7-flashx": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 200000, maxOutput: 65536 },
    "z-ai/glm-5": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 200000, maxOutput: 65536 },
    "z-ai/glm-5-turbo": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 200000, maxOutput: 65536 },
    "z-ai/glm-5.1": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 200000, maxOutput: 65536 },
    "z-ai/glm-5.2": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "z-ai/glm-5.3": { vision: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "high", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "z-ai/glm-5.3-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "high", "max"], contextWindow: 1000000, maxOutput: 65536 },
    "z-ai/glm-5v-turbo": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, thinkingLevels: ["none", "low"], contextWindow: 200000, maxOutput: 65536 },
  },
};

/**
 * Pattern fallback — glob (* = wildcard), matched case-insensitively and
 * anchored (^...$) so a pattern must match the full model id. ORDER MATTERS:
 * vision/specific variants first, text-only/generic families last, to avoid
 * a broad family pattern swallowing an exception (e.g. glm-4.6v vs glm-5).
 */
export const PATTERN_CAPABILITIES = [
  // ── Claude (4.6+ = adaptive thinking; older/haiku = budget) ──────
  { pattern: "*claude*opus-4.6*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*opus-4.7*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*opus-4.8*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*sonnet-4.6*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*sonnet-4.7*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*haiku*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*opus*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*sonnet*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*fable*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*mythos*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude-3*",      caps: { vision: true } },
  // M5 FIX: Tightened from bare *claude* to require a dash separator, avoiding
  // false-positives on custom models that happen to contain "claude" (e.g.
  // "my-claude-finetune"). Real Claude model IDs always contain "claude-".
  { pattern: "*claude-*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },

  // ── Gemini (all 2.0+ multimodal + google_search grounding, 1M ctx) ─
  { pattern: "*gemini*image*",  caps: { vision: true, imageOutput: true, contextWindow: 1048576 } },
  { pattern: "*gemini-3.8*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-3.7*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-3*pro*",  caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65535 } },
  { pattern: "*gemini-3*",      caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2.5*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-budget", thinkingRange: { min: 1024, max: 24576 }, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2*",      caps: { vision: true, audioInput: true, videoInput: true, search: true, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini*",        caps: { vision: true, search: true, contextWindow: 1048576 } },
  { pattern: "*gemma*",         caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*nanobanana*",    caps: { vision: true, imageOutput: true } },

  // ── OpenAI GPT-5.x (vision + thinking + web search) ──────────────
  { pattern: "*gpt-5*image*",   caps: { imageOutput: true } },
  { pattern: "*gpt-5.6-sol*",  caps: { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000, thinkingMaxEffort: true } },
  { pattern: "*gpt-5.6-terra*", caps: { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 } },
  { pattern: "*gpt-5.6-luna*", caps: { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 } },

  // ── Moonshot / Kimi K3 (reasoning, supports max effort) ──────────
  // K3 reasoning + Preserved Thinking always on (can't disable), native tiers
  // low/high/max only (default max). See moonshot.js registry note.
  { pattern: "*kimi-k3*",      caps: { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["low", "high", "max"], thinkingMaxEffort: true, contextWindow: 1048576, maxOutput: 1048576 } },
  // ── OpenAI GPT-6.x (vision + thinking + web search) ──────────────
  { pattern: "*gpt-6*",         caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 } },
  { pattern: "*gpt-5*codex*",   caps: { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5*",         caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-4o*",        caps: { vision: true, search: true, contextWindow: 128000, maxOutput: 16384 } },
  // MAI-Code-1-Flash (Microsoft via GitHub Copilot) — code-generation model.
  { pattern: "*mai-code*",      caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 256000, maxOutput: 128000 } },
  { pattern: "*gpt-4.1*",       caps: { vision: true, contextWindow: 1000000, maxOutput: 32768 } },
  { pattern: "*gpt-4-turbo*",   caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*gpt-4*",         caps: { contextWindow: 128000 } },
  { pattern: "*gpt-3.5*",       caps: { contextWindow: 16385, maxOutput: 4096 } },
  { pattern: "*gpt-oss*",       caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },

  // ── OpenAI o-series (reasoning, vision) ──────────────────────────
  // M4 FIX: Tightened from *o1* (matches any model containing "o1") to *o1-* /
  // *o1_* to avoid false-positives on unrelated models. The prefix "o" + digit +
  // separator is OpenAI's naming convention; generic "o1" substrings are too broad.
  { pattern: "*o1-mini*",       caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },
  { pattern: "*o1-*",           caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o1_*",           caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o3-*",           caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o3_*",           caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o4-*",           caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o4_*",           caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  // Bare o1/o3/o4 ids (openai/o1, openai/o3, chatgpt-web/o3, copilot-web/o3, …)
  // contain no dash/underscore, so the *o1-* / *o3_* patterns never match them
  // and they silently lost reasoning+vision. models.dev: reasoning, image/pdf
  // input, 200k ctx / 100k output. Specific variants (o1-mini, o3-mini, o4-mini)
  // are still caught by the earlier patterns.
  { pattern: "o1*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "o3*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "o4*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },

  // ── Grok (vision + Live Search) ──────────────────────────────────
  { pattern: "*grok-imagine-video*", caps: { videoOutput: true } },
  { pattern: "*grok*image*",    caps: { imageOutput: true } },
  { pattern: "*grok-code*",     caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 256000 } },
  // Grok 4.6: 500k context + effort levels low/medium/high/xhigh (docs.x.ai 2026-08).
  // thinkingMaxEffort stays false: "max" is not in the level list, and setting
  // it would make ThinkingLevelPicker / ComboCard offer an effort the endpoint
  // rejects. thinkingLevels is the authoritative list for this family.
  { pattern: "*grok-4.6*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000, thinkingLevels: ["low", "medium", "high", "xhigh"] } },
  // Grok 4.5: 500k context + effort levels low/medium/high only (no minimal).
  { pattern: "*grok-4.5*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000, thinkingLevels: ["low", "medium", "high"] } },
  { pattern: "*grok-4*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 } },
  { pattern: "*grok-3*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 131072 } },
  { pattern: "*grok*",          caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 } },

  // ── Qwen (3.5+ = native vision/video; coder & max = text-only; QwQ = thinking-only) ─
  // TokenRouter qwen family (provider-qualified, must precede the generic
  // patterns below): the backing endpoint only accepts reasoning_effort
  // low|medium — high/max/none/auto are rejected by the validator and xhigh
  // 422s upstream. Thinking is always on by default, so "none"/"auto" must not
  // reach it as an invalid enum: clamp every request to low|medium and
  // disable-requests to low (minimal).
  { provider: "tokenrouter", pattern: "*qwen*", caps: { vision: true, reasoning: true, thinkingFormat: "openai", thinkingLevels: ["low", "medium"], thinkingCanDisable: false, thinkingMaxEffort: false, contextWindow: 262144, maxOutput: 65536 } },
  // opencode — generic Muse Spark pattern (covers passthrough discoveries the free
  // lane returns, e.g. muse-spark-1.x-contributor-free). Provider-scoped so it can't
  // leak onto muse-spark-web (which doesn't speak OpenAI-compatible effort). Matches
  // isMuseSparkModel() routing: any Muse Spark on opencode is Responses-API + multimodal.
  { provider: "opencode", pattern: "*muse*spark*", caps: { vision: true, pdf: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 } },
  // opencode-go — same Muse Spark family on the Go lane (/zen/go/v1/responses
  // only, see OpenCodeGoExecutor). Provider-scoped for the same muse-spark-web guard.
  { provider: "opencode-go", pattern: "*muse*spark*", caps: { vision: true, pdf: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*qwen*vl*",       caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },
  { pattern: "*qwen*omni*",     caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262144, maxOutput: 65536 } },
  { pattern: "*qwen*coder*",    caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 } },
  { pattern: "*qwen*max*",      caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen3.5*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen3.6*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen3.7*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  // Qwen3.8 dense (OrcaRouter self-host + Alibaba) — reasoning + tools; vision
  // not guaranteed on every host (Orca free card is text-only 64k). Keep
  // family-level reasoning; provider-scoped orcarouter pin overrides ctx/vision.
  { pattern: "*qwen3.8*",       caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144, maxOutput: 65536 } },
  { pattern: "*qwen*plus*",     caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen*235b*",     caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },
  { pattern: "*qwq*",           caps: { reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 131072 } },
  { pattern: "*qwen*",          caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },

  // ── Kimi (enabled→reasoning_effort; K2.7-code cannot disable) ─────
  { pattern: "*kimi*k2.7*code*", caps: { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "*kimi*k2*",       caps: { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144, maxOutput: 262144 } },
  // kimi-latest (Moonshot chat) accepts image input (models.dev).
  { pattern: "*kimi-latest*",   caps: { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144 } },
  { pattern: "*kimi*",          caps: { reasoning: true, thinkingFormat: "kimi", contextWindow: 262144 } },

  // ── GLM / Z.ai (thinking.enabled; disable via enable_thinking:false) ─
  // GLM-5.3 exposes 1M context + reasoning_effort low|high|max (default max;
  // https://z.ai/blog/glm-5.3). GLM-5.2 exposes 1M context + reasoning_effort
  // high|max (Z.ai docs); the generic *glm-5* caps at 200k and advertises the
  // full effort range.
  { pattern: "*glm-5.3*",       caps: { reasoning: true, thinkingFormat: "zai", thinkingLevels: ["low", "high", "max"], contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*glm-5.2*",       caps: { reasoning: true, thinkingFormat: "zai", thinkingLevels: ["high", "max"], contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*glm-5*",         caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 128000 } },
  { pattern: "*glm-4.7*",       caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 128000 } },
  { pattern: "*glm-4*",         caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 } },
  { pattern: "*glm*",           caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 } },

  // ── DeepSeek (thinking.enabled + reasoning_effort; r1 = thinking-only) ─
  // V4 tiers are low/high/max natively (no medium on the wire). thinkingMaxEffort
  // unhides "max" in the dashboard picker + getThinkingLevels().
  { pattern: "*deepseek-v4*",   caps: { reasoning: true, thinkingFormat: "deepseek", thinkingMaxEffort: true, contextWindow: 1000000, maxOutput: 384000 } },
  { pattern: "*reasoner*",      caps: { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 } },
  { pattern: "*deepseek-r*",    caps: { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 } },
  { pattern: "*deepseek-chat*", caps: { contextWindow: 128000 } },
  { pattern: "*deepseek*",      caps: { reasoning: true, thinkingFormat: "deepseek", contextWindow: 128000 } },

  // ── MiniMax (M3 = adaptive; M2.x cannot disable) ─────────────────
  { pattern: "*minimax*image*", caps: { imageOutput: true } },
  { pattern: "*minimax-m3*",    caps: { vision: true, reasoning: true, thinkingFormat: "minimax", contextWindow: 1048576, maxOutput: 512000 } },
  { pattern: "*minimax-m2.7*",  caps: { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 204800, maxOutput: 131072 } },
  { pattern: "*minimax*",       caps: { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 } },

  // ── Xiaomi MiMo (vision, 1M / 262K ctx) ──────────────────────────
  // MiMo-V2.5 family — native reasoning (models.dev: reasoning:true, input
  // text+image+audio+video, 1M ctx). OpenAI-compatible API → openai effort.
  { pattern: "*mimo*v2.5*",     caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*mimo*auto*",     caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 131072 } },
  { pattern: "*mimo*omni*",     caps: { vision: true, audioInput: true, contextWindow: 262144, maxOutput: 131072 } },
  { pattern: "*mimo*",          caps: { vision: true, contextWindow: 262144, maxOutput: 131072 } },

  // ── Llama (4 = vision/1M; 3.x = text-only/128K) ──────────────────
  { pattern: "*llama-4*",       caps: { vision: true, contextWindow: 1000000 } },
  { pattern: "*llama*",         caps: { contextWindow: 128000 } },

  // ── Mistral (Large 3 = vision/256K; codestral text) ──────────────
  { pattern: "*codestral*",     caps: { contextWindow: 256000 } },
  { pattern: "*mistral-large*", caps: { vision: true, contextWindow: 256000 } },
  { pattern: "*mistral*",       caps: { contextWindow: 128000 } },

  // ── Cohere (Command A Vision = vision; others text) ──────────────
  // Cohere Command A Reasoning — explicit reasoning model (models.dev: 256k ctx).
  { pattern: "*command-a-reasoning*", caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 256000, maxOutput: 32000 } },
  { pattern: "*command-a-vision*", caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*command*",       caps: { contextWindow: 128000 } },

  // ── Perplexity (web search native) ───────────────────────────────
  { pattern: "*sonar*",         caps: { search: true, contextWindow: 128000 } },
  { pattern: "*pplx*",          caps: { search: true, contextWindow: 128000 } },
  { pattern: "*perplexity*",    caps: { search: true, contextWindow: 128000 } },

  // ── Others ───────────────────────────────────────────────────────
  // Laguna S 2.1 family (incl. :free / -free variants): OpenAI-compatible thinking.
  { pattern: "*laguna*",       caps: { reasoning: true, thinkingFormat: "openai", thinkingLevels: ["low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 } },
  // 0x-Alpha family (covers bare, slashed, stealth prefix, and -free forms).
  // Must be before *x-preview* so stealth/ox-alpha doesn't fall through.
  { pattern: "*ox-alpha*",     caps: { reasoning: true, thinkingFormat: "openai", thinkingLevels: ["low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*0x*alpha*",     caps: { reasoning: true, thinkingFormat: "openai", thinkingLevels: ["low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*x-preview*",    caps: { reasoning: true, thinkingFormat: "openai", thinkingLevels: ["low", "medium", "high", "xhigh"], contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*step-3.7*",      caps: { reasoning: true, thinkingFormat: "step", thinkingLevels: ["low", "medium", "high"], contextWindow: 256000, maxOutput: 256000 } },
  { pattern: "*hunyuan*",       caps: { reasoning: true, thinkingFormat: "hunyuan", contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "hy3*",            caps: { reasoning: true, thinkingFormat: "hunyuan", contextWindow: 262144, maxOutput: 262144 } },
  // Hy4 preview (Tencent Hunyuan, OpenCode Go / CodeBuddy / WorkBuddy).
  // Vendor reports vision + always-on reasoning; large context/output.
  { pattern: "hy4*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 } },
  // LongCat-2.0 (Meituan) — OpenCode Go cheap coding lane. Large context
  // (Go usage table: ~89K cached tokens/request); reasoning format unknown.
  { pattern: "*longcat*",       caps: { contextWindow: 131072, maxOutput: 32768 } },
  { pattern: "*step-*",         caps: { reasoning: true, thinkingFormat: "step", contextWindow: 128000 } },
  // NVIDIA Nemotron / Inclusion Ling — OpenAI-compatible reasoning formats.
  { pattern: "*nemotron*",      caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },
  { pattern: "*ling-*",         caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },
];

/**
 * Where the runtime-critical limits in a resolved result came from.
 *
 * Ordered most specific first. `sourceType` names the origin of
 * contextWindow/maxOutput — the two fields Token Budget enforces — because a
 * result can draw features from one tier and limits from another (a family
 * pattern supplying `reasoning` while a provider catalog supplies the ceiling).
 */
export const CAPABILITY_SOURCE = {
  /** PROVIDER_CAPABILITIES[provider][model] — exact provider + exact model. */
  PROVIDER_MODEL: "provider-model",
  /** registryLimits.js — provider catalog entry, provider + model scoped. */
  PROVIDER_REGISTRY: "provider-registry",
  /** MODEL_CAPABILITIES[model] — canonical exact model id. */
  MODEL_EXACT: "model-exact",
  /** PATTERN_CAPABILITIES — verified family rule, applied by glob. */
  FAMILY_PATTERN: "family-pattern",
  /** Synced models.dev catalog — external evidence, below all hand-written tiers. */
  DYNAMIC_CATALOG: "dynamic-catalog",
  /** DEFAULT_CAPABILITIES — no evidence; a conservative assumption. */
  DEFAULT_FLOOR: "default-floor",
};

/**
 * How much weight a resolved result carries.
 *
 *   verified  a source names this exact model (provider entry or exact id)
 *   inferred  a family rule or a provider catalog listing, not model-specific
 *   unknown   nothing matched; the numbers are the safety floor's assumption
 *
 * `known` is derived from this (`confidence !== "unknown"`) so the two can never
 * disagree. Note that `known: true` spans BOTH verified and inferred — it means
 * "some evidence applied", never "this is confirmed". Consumers that need
 * confirmed data must test `confidence === "verified"`.
 */
export const CAPABILITY_CONFIDENCE = {
  VERIFIED: "verified",
  INFERRED: "inferred",
  UNKNOWN: "unknown",
};

// sourceType -> confidence. Single mapping so a new source cannot be introduced
// without deciding how much it is trusted.
const CONFIDENCE_BY_SOURCE = {
  [CAPABILITY_SOURCE.PROVIDER_MODEL]: CAPABILITY_CONFIDENCE.VERIFIED,
  [CAPABILITY_SOURCE.MODEL_EXACT]: CAPABILITY_CONFIDENCE.VERIFIED,
  [CAPABILITY_SOURCE.PROVIDER_REGISTRY]: CAPABILITY_CONFIDENCE.INFERRED,
  [CAPABILITY_SOURCE.FAMILY_PATTERN]: CAPABILITY_CONFIDENCE.INFERRED,
  [CAPABILITY_SOURCE.DYNAMIC_CATALOG]: CAPABILITY_CONFIDENCE.INFERRED,
  [CAPABILITY_SOURCE.DEFAULT_FLOOR]: CAPABILITY_CONFIDENCE.UNKNOWN,
};

// ── Synced catalog injection (server installs; browser bundle stays fs-free) ─
// External models.dev evidence. Strictly BELOW the hand-written tiers: it can
// fill a capability the tables did not explicitly declare and can replace a
// limit that differs meaningfully from the resolved one — it can never touch
// tier 1, never flip an explicitly declared value, and never claim VERIFIED.
let catalogSource = null;

/**
 * Install the synced catalog reader (server at startup; tests install fakes).
 * @param {{ getModalities: Function, getLimits: Function } | null} source
 */
export function setCatalogSource(source) {
  catalogSource = source && typeof source.getLimits === "function" ? source : null;
}

// Catalog-supplied limits apply only when they meaningfully differ from the
// tier-resolved value: gateways round (200000 vs 202752) and churning every
// entry would relabel provenance without changing behavior.
const CATALOG_LIMIT_TOLERANCE = 0.1;

/**
 * Refine a tier-resolved result with synced catalog evidence.
 *
 * Precedence contract (§3): explicit > manual registry > catalog > heuristic > default.
 *   - `explicitKeys` lists the fields the matched hand-written tier declared —
 *     those are NEVER touched, so `manual vision:false + catalog vision:true`
 *     stays false (and vice versa).
 *   - Modalities (model-level) are filled when the catalog positively declares
 *     them. Unknown stays unknown otherwise — the catalog never manufactures a
 *     false, and a missing entry contributes nothing (§18).
 *   - Limits (gateway-level) are replaced only on a >10% divergence.
 *
 * @returns {{ result: object, catalogLimits: object|null, catalogProvenance: object|null }}
 */
function refineWithCatalog(result, explicitKeys, provider, model, baseModel) {
  if (!catalogSource) return { result, catalogLimits: null, catalogProvenance: null };

  const provenance = { modalities: [], limits: false };
  let contributed = false;
  const refined = { ...result };

  const modalities = catalogSource.getModalities?.(baseModel) || catalogSource.getModalities?.(model) || null;
  if (modalities) {
    for (const key of ["vision", "pdf", "audioInput", "videoInput"]) {
      if (modalities[key] !== true) continue;              // unknown/absent → contributes nothing
      if (explicitKeys.includes(key)) continue;            // hand-written statement wins
      if (refined[key] === true) continue;                 // already true — nothing to add
      refined[key] = true;
      provenance.modalities.push(key);
      contributed = true;
    }
  }

  let catalogLimits = null;
  const limits = catalogSource.getLimits?.(provider, model) || null;
  if (limits) {
    const delta = {};
    for (const key of ["contextWindow", "maxOutput"]) {
      if (explicitKeys.includes(key)) continue;            // hand-written value wins
      const next = limits[key];
      if (typeof next !== "number" || next <= 0) continue;
      const current = refined[key];
      if (typeof current !== "number" || !Number.isFinite(current) || current <= 0
        || Math.abs(next - current) / current > CATALOG_LIMIT_TOLERANCE) {
        delta[key] = next;
      }
    }
    if (Object.keys(delta).length) {
      catalogLimits = delta;
      Object.assign(refined, delta);
      provenance.limits = true;
      contributed = true;
    }
  }

  return { result: refined, catalogLimits, catalogProvenance: contributed ? provenance : null };
}

/** Attach provenance to a resolved capability object. */
function withProvenance(caps, sourceType) {
  const confidence = CONFIDENCE_BY_SOURCE[sourceType];
  return { ...caps, sourceType, confidence, known: confidence !== CAPABILITY_CONFIDENCE.UNKNOWN };
}

// Merge a resolved tier with whichever limits overlay won (registry > catalog).
//
// The overlay can narrow only one side of the pair — forge declares a 1M window
// for kimi-k3 while the *kimi-k3* pattern declares a 1,048,576 output — which
// would leave the merged result claiming more output than its window holds.
// Clamping here keeps every resolved result self-consistent, so Token Budget
// never receives an unreachable ceiling.
//
// When an overlay applies it becomes the source of record for the limits, so
// an exact-id match whose ceiling came from a registry entry reports
// `provider-registry`, and one whose ceiling came from the synced catalog
// reports `dynamic-catalog` — both `inferred`, never `verified`.
function withLimits(base, limits, sourceType, limitsSourceType = CAPABILITY_SOURCE.PROVIDER_REGISTRY) {
  if (!limits) return withProvenance(base, sourceType);
  const merged = { ...base, ...limits };
  if (merged.maxOutput > merged.contextWindow) merged.maxOutput = merged.contextWindow;
  return withProvenance(merged, limitsSourceType);
}

/**
 * Resolve capabilities for a model.
 *
 * Tiers, most specific first. Each returns immediately, so an earlier tier can
 * never be widened by a later one:
 *   1. PROVIDER_CAPABILITIES[provider][model] — provider-specific override
 *   2. MODEL_CAPABILITIES[model]              — canonical exact id
 *   3. PATTERN_CAPABILITIES                   — glob, ordered specific -> generic
 *   4. DEFAULT_CAPABILITIES                   — unverified safety floor
 *
 * Two limits/modalities overlays apply to tiers 2-4, most specific first:
 *   a. registryLimits.js — provider+model declared in the registry (wins)
 *   b. synced models.dev catalog — provider+model limits + model modalities,
 *      filling only what the hand-written tier did not explicitly declare
 *
 * Every result carries `sourceType`, `confidence` and `known` — see
 * CAPABILITY_SOURCE and CAPABILITY_CONFIDENCE. `known: true` means evidence
 * applied, NOT that the data is confirmed; inferred results are also `known`.
 * When the synced catalog contributed, `catalog: { modalities, limits }`
 * records exactly what it contributed.
 *
 * @param {string} provider
 * @param {string} model
 * @returns {object} full capabilities object
 */
export function getCapabilitiesForModel(provider, model) {
  if (!model) return withProvenance({ ...DEFAULT_CAPABILITIES }, CAPABILITY_SOURCE.DEFAULT_FLOOR);
  // Providers arrive as registry ids at runtime (parseModel → resolveProviderAlias)
  // but as aliases from UI call sites (AI_MODELS, /api/models, useModelCaps,
  // StatsBar). Normalize alias → id here so both keys resolve the same table.
  provider = resolveProviderAlias(provider);

  // 1. Provider-specific override — the most specific statement available about
  //    this provider serving this model. Short-circuits: neither registry nor
  //    catalog evidence may override an explicit hand-written entry.
  if (provider && PROVIDER_CAPABILITIES[provider]?.[model]) {
    return withProvenance(
      { ...DEFAULT_CAPABILITIES, ...PROVIDER_CAPABILITIES[provider][model] },
      CAPABILITY_SOURCE.PROVIDER_MODEL,
    );
  }

  // Registry limits are provider+model scoped, so they win over tiers 2-4.
  const registryLimits = getRegistryLimits(provider, model);

  // 2. Canonical exact (strip vendor prefix: "anthropic/claude-opus-4.7" -> "claude-opus-4.7")
  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  const exact = MODEL_CAPABILITIES[baseModel] ?? MODEL_CAPABILITIES[model];
  if (exact) {
    const { result, catalogLimits, catalogProvenance } = refineWithCatalog(
      { ...DEFAULT_CAPABILITIES, ...exact }, Object.keys(exact), provider, model, baseModel,
    );
    const limits = registryLimits ?? catalogLimits;
    const resolved = withLimits(result, limits, CAPABILITY_SOURCE.MODEL_EXACT,
      registryLimits ? CAPABILITY_SOURCE.PROVIDER_REGISTRY : CAPABILITY_SOURCE.DYNAMIC_CATALOG);
    return catalogProvenance ? { ...resolved, catalog: catalogProvenance } : resolved;
  }

  // 3. Pattern match (first match wins). Entries may carry an optional
  // `provider` qualifier so a glob only applies under one provider (e.g.
  // tokenrouter's qwen backend clamps reasoning_effort to low|medium).
  for (const { pattern, caps, provider: patternProvider } of PATTERN_CAPABILITIES) {
    if (patternProvider && patternProvider !== provider) continue;
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      const { result, catalogLimits, catalogProvenance } = refineWithCatalog(
        { ...DEFAULT_CAPABILITIES, ...caps }, Object.keys(caps), provider, model, baseModel,
      );
      const limits = registryLimits ?? catalogLimits;
      const resolved = withLimits(result, limits, CAPABILITY_SOURCE.FAMILY_PATTERN,
        registryLimits ? CAPABILITY_SOURCE.PROVIDER_REGISTRY : CAPABILITY_SOURCE.DYNAMIC_CATALOG);
      return catalogProvenance ? { ...resolved, catalog: catalogProvenance } : resolved;
    }
  }

  // 4. Floor. Registry/catalog limits still count as evidence for the fields
  // they cover; everything else remains an unverified assumption. A floor
  // result the catalog contributed to (modalities or limits) is upgraded to
  // `dynamic-catalog` / inferred — evidence applied, not a bare assumption.
  const { result, catalogLimits, catalogProvenance } = refineWithCatalog(
    { ...DEFAULT_CAPABILITIES }, [], provider, model, baseModel,
  );
  const limits = registryLimits ?? catalogLimits;
  const floorSource = registryLimits
    ? CAPABILITY_SOURCE.PROVIDER_REGISTRY
    : catalogProvenance ? CAPABILITY_SOURCE.DYNAMIC_CATALOG : CAPABILITY_SOURCE.DEFAULT_FLOOR;
  const resolved = withLimits(result, limits, floorSource, floorSource);
  return catalogProvenance ? { ...resolved, catalog: catalogProvenance } : resolved;
}
