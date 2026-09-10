/**
 * Combo-member ref resolver — the server-side single source of truth for
 * resolving arbitrary model-reference strings (exactly as users store them
 * in combo members) into a canonical provider + capability record.
 *
 * The dashboard previously looked up capabilities by exact string match
 * against /api/models `fullModel` keys ("alias/model" built from the STATIC
 * registry). Three reference shapes silently miss that map:
 *   1. bare model ids with no provider prefix ("glm-5.3-flash-free"),
 *   2. alias prefixes that differ from the static-list key the catalog was
 *      built from ("cbai/hy3" where the model is listed under another lane),
 *   3. DYNAMIC providers whose live models are not in the static registry at
 *      all (bynara/tokenharbor passthrough discoveries).
 * That caused missing capability badges/provider icons on the combos page.
 *
 * Resolution order (mirrors runtime parseModel + provider-alias handling):
 *   - "prefix/rest"  → provider = resolveProviderAlias(prefix), model = rest
 *     (works for alias AND canonical prefixes; nested ids keep full `rest`).
 *   - "bare"         → provider inferred from the static registry (exact id
 *     match, preferring a provider with a hand-written capability entry on
 *     collision), then from PROVIDER_CAPABILITIES keys (covers dynamic-provider
 *     models like bynara that are absent from the static lists), then null
 *     (generic tiers still apply via getCapabilitiesForModel).
 *
 * Read-only: never mutates the capability tables. Exported for the
 * /api/models/refs route + unit tests.
 */

import { PROVIDER_MODELS } from "../config/providerModels.js";
import { resolveProviderAlias } from "../services/model.js";
import { PROVIDER_CAPABILITIES, getCapabilitiesForModel } from "./capabilities.js";

// Providers carrying a hand-written entry for this exact bare id.
function capabilityProvidersForId(modelId) {
  return Object.keys(PROVIDER_CAPABILITIES).filter((pid) => PROVIDER_CAPABILITIES[pid]?.[modelId]);
}

// Providers whose STATIC model list carries this exact id.
function staticProvidersForId(modelId) {
  const out = [];
  for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
    if (Array.isArray(models) && models.some((m) => m?.id === modelId)) {
      out.push(resolveProviderAlias(alias));
    }
  }
  return [...new Set(out)];
}

/**
 * Resolve one combo-member reference string to { provider, model }.
 * provider is the canonical registry id (icon/caps lookup key) or null.
 */
export function resolveModelRef(ref) {
  if (typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;

  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const prefix = trimmed.slice(0, slash);
    const model = trimmed.slice(slash + 1);
    if (!model) return null;
    return { provider: resolveProviderAlias(prefix), model };
  }

  // Bare id: prefer a static-registry provider that also has a hand-written
  // capability entry (most specific), then any static provider, then a
  // capability-table provider (covers dynamic providers), else generic.
  const statics = staticProvidersForId(trimmed);
  const capsProviders = capabilityProvidersForId(trimmed);
  const provider =
    statics.find((p) => capsProviders.includes(p)) ?? statics[0] ?? capsProviders[0] ?? null;
  return { provider, model: trimmed };
}

/**
 * Full resolution for a ref: canonical identity + capability object.
 * Returns { ref, provider, model, caps } or null for unusable refs.
 */
export function resolveModelRefCaps(ref) {
  const r = resolveModelRef(ref);
  if (!r) return null;
  return { ref, provider: r.provider, model: r.model, caps: getCapabilitiesForModel(r.provider, r.model) };
}
