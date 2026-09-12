/**
 * Model-consistency quality gate (CI).
 *
 * Enforces the audit invariants across the ENTIRE registry:
 *   1. Every LLM model on a paid provider (apikey/oauth) resolves non-null pricing
 *      (free/web providers are exempt — they are free by definition).
 *   2. Thinking consistency: reasoning ⇔ advertised levels, reasoning ⇒ format,
 *      and every advertised level is a known enum value.
 *   3. Every reasoning model must carry a thinkingFormat (except Kiro's legacy
 *      families, which reason via the <thinking_mode> system tag by design).
 *
 * Media models (kind: image|tts|stt|embedding|...) are exempt from pricing —
 * they are billed per-media, not per-token.
 */
import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS } from "open-sse/providers/index.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { modelKind } from "open-sse/providers/models/schema.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getPricingForModel } from "open-sse/providers/pricing.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { resolveKiroEffortPath } from "open-sse/config/kiroConstants.js";
import { resolveProviderAlias } from "open-sse/services/model.js";

const PAID_CATEGORIES = new Set(["apikey", "oauth"]);
// "none" is a legitimate explicit value in the codex GPT-5.6 override matrix
// (getThinkingLevels returns it for sol/terra/luna) — thinking-off as a level.
const KNOWN_LEVELS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

// Media model id hints — models that carry a kind or a media-looking id are not
// billed as chat LLMs, so the pricing gate must not demand per-token rates for them.
const MEDIA_ID_HINT = /(^|\/)(flux|sdxl|sd3|dall-e|whisper|speech|tts|stt|embed|recraft|veo|seedance|gen[0-9]|polly|nova-|runway|music|image|audio|video|fastpitch|tacotron|search|midijourney)/i;

function isLlmModel(m) {
  const kind = modelKind(m);
  if (kind && kind !== "llm") return false;
  return !MEDIA_ID_HINT.test(m.id);
}

/**
 * Models with NO public per-token price — subscription/agent/proprietary or
 * unpublished. Cost tracking falls back to $0 for these. Do NOT grow this list
 * casually: a new model must either get a real price in pricing.js or carry a
 * documented reason here.
 */
const NO_PUBLIC_RATE = new Map([
  // Sourcegraph Cody (oauth subscription — no per-token rate)
  ["cody/anthropic::new::claude-sonnet-4", "Cody subscription"],
  ["cody/anthropic::new::claude-haiku-4", "Cody subscription"],
  ["cody/anthropic::new::claude-3.7-sonnet", "Cody subscription"],
  ["cody/openai::new::gpt-4o", "Cody subscription"],
  ["cody/openai::new::o3-mini", "Cody subscription"],
  ["cody/google::new::gemini-2.5-pro", "Cody subscription"],
  ["cody/google::new::gemini-2.0-flash", "Cody subscription"],
  ["cody/mixtral-8x22B", "Cody subscription"],
  // Subscription / agent-native models
  ["cursor/default", "Cursor subscription"],
  ["devin/devin-normal", "Devin subscription"],
  ["devin/devin-fast", "Devin subscription"],
  ["devin/devin-lite", "Devin subscription"],
  ["devin/devin-ultra", "Devin subscription"],
  ["trae/work", "Trae subscription"],
  ["windsurf/swe-1.6-fast", "Windsurf subscription"],
  ["windsurf/swe-1.6", "Windsurf subscription"],
  ["windsurf/swe-1.5-fast", "Windsurf subscription"],
  ["windsurf/swe-1.5", "Windsurf subscription"],
  ["qoder/qmodel_latest", "Qoder subscription"],
  // Qoder catalog refresh (2026-09) — the whole gateway bills through the plan
  // quota; opaque internal ids have no per-token rates.
  ["qoder/auto", "Qoder subscription"],
  ["qoder/performance", "Qoder subscription"],
  ["qoder/efficient", "Qoder subscription"],
  ["qoder/lite", "Qoder subscription"],
  ["qoder/qmodel_38max", "Qoder subscription"],
  ["qoder/qmodel", "Qoder subscription"],
  ["qoder/qfmodel", "Qoder subscription"],
  ["qoder/kmodel_latest", "Qoder subscription"],
  ["qoder/kmodel", "Qoder subscription"],
  ["qoder/gmodel", "Qoder subscription"],
  ["qoder/gfmodel", "Qoder subscription"],
  ["qoder/dmodel", "Qoder subscription"],
  ["qoder/dfmodel", "Qoder subscription"],
  ["qoder/mmodel", "Qoder subscription"],
  ["agnes-api/agnes-2.5-pro-alpha", "Agnes API unpublished rate"],
  ["agnes-api/agnes-2.5-flash", "Agnes API unpublished rate"],
  ["agnes-api/agnes-2.0", "Agnes API unpublished rate"],
  ["iflow/iflow-rome-30ba3b", "iFlow unpublished rate"],
  // Copilot MAI Code / coding-agent models without published per-token rates
  ["github/mai-code-1-flash", "GitHub Copilot MAI — unpublished rate"],
  ["opencode-go/mimo-v2.5-high", "opencode-go effort tier — unpublished"],
  ["opencode-go/mimo-v2.5-max", "opencode-go effort tier — unpublished"],
  ["opencode-go/muse-spark-1.2-contributor", "opencode-go subscription"],
  ["xiaomi-tokenplan/mimo-v2.5-pro-claude", "Xiaomi token plan — unpublished"],
  // MiMo Desktop Preview models — billed through the Xiaomi account session
  // (weekly quota), not a public per-token API rate.
  ["xiaomi-mimo/mimo-x-pro-preview", "MiMo Desktop Preview — account-session quota"],
  ["xiaomi-mimo/mimo-x-flash-preview", "MiMo Desktop Preview — account-session quota"],
  ["kimchi/nemotron-3-ultra-fp4", "Kimchi — unpublished rate"],
  // Small hosts / resellers not covered by models.dev
  ["groq/meta-llama/llama-4-maverick-17b-128e-instruct", "Groq — unpublished for this id"],
  ["siliconflow/inclusionAI/Ling-flash-2.0", "SiliconFlow — unpublished"],
  ["volcengine-ark/Doubao-Seed-2.0-Code", "Volcengine — unpublished rate"],
  ["volcengine-ark/Doubao-Seed-2.0-pro", "Volcengine — unpublished rate"],
  ["volcengine-ark/Doubao-Seed-2.0-lite", "Volcengine — unpublished rate"],
  ["volcengine-ark/Doubao-Seed-Code", "Volcengine — unpublished rate"],
  ["featherless/meta-llama/Meta-Llama-3.1-8B-Instruct", "Featherless — unpublished"],
  ["featherless/meta-llama/Meta-Llama-3.1-70B-Instruct", "Featherless — unpublished"],
  ["featherless/google/gemma-2-9b-it", "Featherless — unpublished"],
  ["featherless/mistralai/Mistral-7B-Instruct-v0.3", "Featherless — unpublished"],
  ["featherless/mistralai/Mixtral-8x7B-Instruct-v0.1", "Featherless — unpublished"],
  ["featherless/microsoft/Phi-3.5-mini-instruct", "Featherless — unpublished"],
  ["moonshot/moonshot-v1-8k-vision-preview", "Moonshot v1 legacy — unpublished"],
  ["moonshot/moonshot-v1-32k-vision-preview", "Moonshot v1 legacy — unpublished"],
  ["moonshot/moonshot-v1-128k-vision-preview", "Moonshot v1 legacy — unpublished"],
  ["databricks/databricks-meta-llama-3-3-70b-instruct", "Databricks — unpublished"],
  ["inferx/gemma-4-31B-it-fp8", "InferX — unpublished"],
  ["inferx/Agents-A1", "InferX — unpublished"],
  ["inferx/Devstral-2-123B-Instruct-2512-int4-AutoRound", "InferX — unpublished"],
  ["inferx/Ornith-1.0-35B-FP8", "InferX — unpublished"],
  ["novita/meta-llama/llama-3.1-405b-instruct", "Novita — unpublished"],
  // 2026-08 OmniRoute enterprise + frontier import — no public per-token rate
  // exists for these (rates live behind auth / regional / credits-based billing).
  // Do NOT add prices here without a published source — cost falls back to $0.
  ["meta-llama/Llama-3.3-8B-Instruct", "Meta llama.com — no published per-token rate"],
  ["oci/cohere.command-r-plus", "Deprecated on OCI — no published OCI rate"],
  ["pioneer/meta-llama/Llama-3.1-8B-Instruct", "Pioneer per-model rates via authenticated /base-models API"],
  ["pioneer/meta-llama/Llama-3.2-1B-Instruct", "Pioneer per-model rates via authenticated /base-models API"],
  ["pioneer/google/gemma-3-4b-pt", "Pioneer per-model rates via authenticated /base-models API"],
  ["pioneer/HuggingFaceTB/SmolLM3-3B-Base", "Pioneer per-model rates via authenticated /base-models API"],
  ["snowflake/llama3.1-70b", "Snowflake Cortex bills per credit — no per-token USD rate"],
  ["snowflake/llama3.3-70b", "Snowflake Cortex bills per credit — no per-token USD rate"],
  ["watsonx/ibm/granite-3-8b-instruct", "granite-3-8b-instruct no longer pay-per-token on watsonx (deploy-on-demand only)"],
  // 2026-08 OmniRoute gateways + inference-hosts import — small resellers without
  // published per-token rates (verified against models.dev / OpenRouter / vendor docs).
  ["aimlapi/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", "AIMLAPI — no published rate for this legacy id"],
  ["ainative/llama3.1-8b-cerebras", "AiNative — unpublished rate"],
  ["ainative/nous-coder", "AiNative — unpublished rate"],
  ["aion/aion-labs/aion-3.0", "Aion Labs — free tier only, no published per-token rate"],
  ["aion/aion-labs/aion-3.0-mini", "Aion Labs — free tier only, no published per-token rate"],
  ["aion/aion-labs/aion-2.5", "Aion Labs — free tier only, no published per-token rate"],
  ["aion/aion-labs/aion-2.0", "Aion Labs — free tier only, no published per-token rate"],
  ["aion/aion-labs/aion-rp-llama-3.1-8b", "Aion Labs — free tier only, no published per-token rate"],
  ["crof/mimo-v2.5-pro-precision", "CrofAI — unpublished rate"],
  ["llm-kiwi/hrLLM", "LLM Kiwi — unpublished rate"],
  ["navy/mistral-small-latest", "Navy — unpublished rate"],
  ["ollama-cloud/gpt-oss:20b", "Ollama Cloud bills via subscription usage tiers — no public per-token rate"],
  ["ollama-cloud/gpt-oss:120b", "Ollama Cloud bills via subscription usage tiers — no public per-token rate"],
  ["ollama-cloud/nemotron-3-super", "Ollama Cloud bills via subscription usage tiers — no public per-token rate"],
  ["regolo/regolo-chat", "Regolo AI — unpublished rate"],
  ["regolo/regolo-fast", "Regolo AI — unpublished rate"],
]);

// provider-model-key (alias||id) → registry entry
const ENTRY_BY_KEY = new Map();
for (const e of REGISTRY) {
  ENTRY_BY_KEY.set(e.alias || e.id, e);
}

function collectIssues() {
  const issues = [];

  for (const [key, models] of Object.entries(PROVIDER_MODELS)) {
    const entry = ENTRY_BY_KEY.get(key);
    if (!entry) continue; // TTS voice tables / custom keys — not registry models
    const pid = entry.id;

    for (const m of models) {
      const modelId = typeof m === "string" ? m : m.id;
      if (!modelId || !isLlmModel(m)) continue;

      // 1. Pricing completeness for paid providers
      if (PAID_CATEGORIES.has(entry.category)) {
        if (!getPricingForModel(pid, modelId) && !NO_PUBLIC_RATE.has(`${pid}/${modelId}`)) {
          issues.push(`pricing: ${pid}/${modelId}`);
        }
      }

      // 2. Thinking consistency
      const caps = getCapabilitiesForModel(pid, modelId);
      const levels = getThinkingLevels(pid, modelId);

      if (caps.reasoning && levels === null) {
        const kiroLegacy = pid === "kiro" && resolveKiroEffortPath(modelId) === null;
        if (!kiroLegacy) issues.push(`levels: ${pid}/${modelId} (reasoning but no levels)`);
      }
      if (levels !== null && !caps.reasoning) {
        issues.push(`levels: ${pid}/${modelId} (levels but no reasoning)`);
      }
      if (caps.reasoning && !caps.thinkingFormat) {
        issues.push(`format: ${pid}/${modelId} (reasoning without thinkingFormat)`);
      }
      if (Array.isArray(caps.thinkingLevels)) {
        for (const lv of caps.thinkingLevels) {
          if (!KNOWN_LEVELS.has(lv)) issues.push(`level: ${pid}/${modelId} (invalid level "${lv}")`);
        }
      }
    }
  }
  return issues;
}

describe("model-consistency gate (CI)", () => {
  // Iterates the FULL registry (~1352 models) — needs more than vitest's 5s
  // default under 60-way batch concurrency.
  it("every registry LLM model satisfies pricing + capabilities + thinking invariants", { timeout: 30_000 }, () => {
    const issues = collectIssues();
    expect(issues, `model-consistency violations:\n${issues.join("\n")}`).toEqual([]);
  });

  it("provider identity tokens (id/alias/aliases) never collide", () => {
    // A duplicate token makes resolveProviderAlias() return whichever provider
    // the registry imported last, silently routing model strings like
    // "tr/gemini-3.1-pro" (trae) to the other provider (tokenrouter).
    const tokens = new Map(); // token -> provider id
    const collisions = [];
    for (const entry of REGISTRY) {
      const claim = (token, kind) => {
        if (!token) return;
        if (tokens.has(token) && tokens.get(token) !== entry.id) {
          collisions.push(`${token} (${kind} of ${entry.id} vs ${tokens.get(token)})`);
        } else {
          tokens.set(token, entry.id);
        }
      };
      claim(entry.id, "id");
      claim(entry.alias, "alias");
      for (const a of entry.aliases || []) claim(a, "alias");
    }
    expect(collisions, `alias collisions:\n${collisions.join("\n")}`).toEqual([]);
  });

  it("every provider's canonical alias resolves back to itself (round-trip)", () => {
    // Emitted model strings are built as "<alias>/<model>" (PROVIDER_MODELS
    // is keyed by alias). If another provider shadows that alias, every such
    // string silently routes to the wrong provider.
    const broken = [];
    for (const entry of REGISTRY) {
      const token = entry.alias || entry.id;
      if (resolveProviderAlias(token) !== entry.id) {
        broken.push(`${entry.id}: alias "${token}" resolves to ${resolveProviderAlias(token)}`);
      }
    }
    expect(broken, `alias round-trip violations:\n${broken.join("\n")}`).toEqual([]);
  });
});
