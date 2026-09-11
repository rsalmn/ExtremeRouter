import { PROVIDERS } from "./providers.js";
import REGISTRY from "../providers/registry/index.js";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX, isMuseSparkModel } from "../providers/models/helpers.js";
import { FORMATS } from "../translator/formats.js";

export { PROVIDER_MODELS };


// Helper functions
export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return models.some(m => m.id === modelId);
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = models.find(m => m.id === modelId);
  return found?.name || modelId;
}

// Any registry id / alias / aliases[] token → PROVIDER_MODELS key (alias||id).
// Secondary aliases like "ocg" are not themselves PROVIDER_MODELS keys.
const MODELS_KEY_BY_TOKEN = (() => {
  const map = {};
  for (const entry of REGISTRY) {
    const key = entry.alias || entry.id;
    map[entry.id] = key;
    if (entry.alias) map[entry.alias] = key;
    for (const a of entry.aliases || []) map[a] = key;
  }
  return map;
})();

export function getModelTargetFormat(aliasOrId, modelId) {
  // Muse Spark family is Responses-only on every OpenCode lane (zen + zen/go).
  // Alias-scoped so muse-spark-web (cookie bridge, chat-only) stays untouched.
  if ((!aliasOrId || aliasOrId === "oc" || aliasOrId === "opencode" || aliasOrId === "ocg" || aliasOrId === "opencode-go") && isMuseSparkModel(modelId)) {
    return FORMATS.OPENAI_RESPONSES;
  }
  const key = MODELS_KEY_BY_TOKEN[aliasOrId] || aliasOrId;
  const models = PROVIDER_MODELS[key];
  if (!models) return null;
  return modelTargetFormat(models.find(m => m.id === modelId));
}

export function getModelType(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = models.find(m => m.id === modelId);
  return found?.kind || found?.type || null;
}

export function getModelUpstreamId(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  const found = models?.find(m => m.id === modelId);
  if (found?.upstreamModelId) {
    // Tier-preset suffix support: a model entry can carry a preset tag in its
    // upstreamModelId, e.g. "gemini-3.6-flash-tiered(high)" for tiered routing.
    // When the caller appended an effort/tier suffix (e.g. "-high"), we merge
    // the caller's suffix with the preset; otherwise the preset wins on its own.
    // Port of decolua/9router commit 190020c (isolates tiered model routing).
    const resolvedId = found.upstreamModelId;
    const presetMatch = resolvedId.match(/\([^()]+\)\s*$/);
    const presetSuffix = presetMatch?.[0] || "";
    if (presetSuffix) {
      const resolvedBase = resolvedId.slice(0, presetMatch.index).trim();
      // Caller suffix (passed as modelId tail) takes precedence if present.
      const callerSuffixMatch = typeof modelId === "string" ? modelId.match(/-(high|medium|low)$/i) : null;
      const callerTier = callerSuffixMatch?.[0] ? `(${callerSuffixMatch[0].slice(1).toLowerCase()})` : "";
      return resolvedBase + (callerTier || presetSuffix);
    }
    return resolvedId;
  }
  if (aliasOrId === "cx" && typeof modelId === "string" && modelId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return modelId.slice(0, -CODEX_REVIEW_SUFFIX.length);
  }
  return modelId;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return modelQuotaFamily(models?.find(m => m.id === modelId));
}

// OAuth short aliases — derived from registry `alias` (single source). everything else: alias = id.
// vertex/vertex-partner keep alias=id (kept via the `|| id` fallback in consumers).
export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter(r => r.alias && r.alias !== r.id).map(r => [r.id, r.alias])
);

// Derived from PROVIDERS — no need to maintain manually
export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  Object.keys(PROVIDERS).map(id => [id, OAUTH_ALIASES[id] || id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias, modelId) {
  return modelStrip(PROVIDER_MODELS[alias]?.find(m => m.id === modelId));
}
