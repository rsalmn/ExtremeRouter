// zenmuxModels — live model resolver for ZenMux Free provider.
//
// Two ZenMux API endpoints are used:
//
// 1. PUBLIC — get_all_plans (no auth required):
//      GET https://zenmux.ai/api/subscription/public/get_all_plans
//    Returns all 5 plans (free/starter/pro/max/ultra) with their full model
//    lists. Cached for 1 hour (single global entry — data is public).
//
// 2. AUTHENTICATED — get_current (requires user's ctoken):
//      GET https://zenmux.ai/api/subscription/get_current?ctoken=<token>
//    Returns the user's ACTIVE subscription plan. Used to auto-detect which
//    plan the user has, so they don't need to manually select it.
//
// Flow:
//   - getZenmuxModelsForPlan(planKey) → returns models for a given plan
//   - getZenmuxPlanForCtoken(ctoken) → auto-detects plan from user's ctoken
//   - The live resolver in /v1/models tries ctoken auto-detect first, then
//     falls back to the manually-selected plan (providerSpecificData.zenmuxPlan),
//     then to "free".
//
// Architecture follows the qoderModels.js pattern:
//   - Module-level cache (1h TTL for plans catalog, 5min TTL for per-ctoken
//     plan detection)
//   - Fail-open: returns null on any error so callers fall back gracefully

import { proxyAwareFetch } from "../utils/proxyFetch.js";

const PLANS_URL = "https://zenmux.ai/api/subscription/public/get_all_plans";
const CURRENT_PLAN_URL = "https://zenmux.ai/api/subscription/get_current";
const PLANS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — plan catalog changes rarely
const PLAN_DETECT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — per-user plan detection
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// Plan catalog cache (public data, single global entry).
// Shape: { expiresAt, plans: Map<planKey, { name, price, desc, models: [{id}] }> }
let catalogCache = null;

// Per-ctoken plan detection cache (Map<ctoken, { planKey, expiresAt }>).
const planDetectCache = new Map();

/**
 * Fetch the full plan catalog from ZenMux's public API and cache it.
 * Returns a Map<planKey, { name, price, desc, models }>.
 *
 * @param {{ forceRefresh?: boolean }} options
 * @returns {Promise<Map<string, {name:string,price:number,desc:string,models:Array<{id:string}>,modelCount:number}>|null>}
 */
export async function resolveZenmuxModels(options = {}) {
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh && catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.plans;
  }

  let res;
  try {
    res = await proxyAwareFetch(PLANS_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        Origin: "https://zenmux.ai",
        Referer: "https://zenmux.ai/platform/chat",
      },
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  if (!data?.success || !Array.isArray(data.data)) return null;

  // Build planKey → plan map with deduped model slugs.
  const plans = new Map();
  for (const plan of data.data) {
    if (!plan?.planKey) continue;
    const seen = new Set();
    const models = [];
    for (const m of plan.models || []) {
      const slug = m.model_slug;
      if (!slug || typeof slug !== "string") continue;
      if (seen.has(slug)) continue;
      seen.add(slug);
      models.push({ id: slug, name: slug });
    }
    plans.set(plan.planKey, {
      name: plan.name || plan.planKey,
      price: plan.price ?? 0,
      desc: plan.desc || "",
      modelCount: models.length,
      models,
    });
  }

  catalogCache = { expiresAt: Date.now() + PLANS_CACHE_TTL_MS, plans };
  return plans;
}

/**
 * Auto-detect the user's subscription plan from their ctoken.
 *
 * Calls ZenMux's authenticated endpoint:
 *   GET /api/subscription/get_current?ctoken=<token>
 *
 * Returns the planKey (e.g. "free", "starter", "pro", "max", "ultra") or
 * null on any failure (invalid token, network error, unexpected response).
 *
 * Cached per-ctoken for 5 minutes so repeated /v1/models calls don't hammer
 * the upstream.
 *
 * @param {string} ctoken — the user's ctoken extracted from their cookie
 * @param {{ forceRefresh?: boolean }} options
 * @returns {Promise<string|null>}
 */
export async function getZenmuxPlanForCtoken(ctoken, options = {}) {
  if (!ctoken || typeof ctoken !== "string") return null;
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh) {
    const cached = planDetectCache.get(ctoken);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.planKey;
    }
  }

  let res;
  try {
    const url = `${CURRENT_PLAN_URL}?ctoken=${encodeURIComponent(ctoken)}`;
    res = await proxyAwareFetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        Origin: "https://zenmux.ai",
        Referer: "https://zenmux.ai/platform/chat",
      },
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  if (!data?.success || !data?.data?.planKey) return null;

  const planKey = data.data.planKey;
  planDetectCache.set(ctoken, {
    planKey,
    expiresAt: Date.now() + PLAN_DETECT_CACHE_TTL_MS,
  });
  return planKey;
}

/**
 * Get the model list for a specific plan. Triggers a cache refresh if cold.
 *
 * @param {string} planKey — "free" | "starter" | "pro" | "max" | "ultra"
 * @returns {Promise<Array<{id:string,name:string}>|null>}
 */
export async function getZenmuxModelsForPlan(planKey = "free") {
  const plans = await resolveZenmuxModels();
  if (!plans) return null;
  const plan = plans.get(planKey) || plans.get("free");
  return plan?.models || null;
}

/**
 * Get a lightweight list of available plans for UI dropdown population.
 * Does NOT include model arrays — only counts + metadata.
 *
 * @returns {Promise<Array<{planKey:string,name:string,price:number,desc:string,modelCount:number}>|null>}
 */
export async function getZenmuxPlans() {
  const plans = await resolveZenmuxModels();
  if (!plans) return null;
  const out = [];
  for (const [planKey, plan] of plans) {
    out.push({
      planKey,
      name: plan.name,
      price: plan.price,
      desc: plan.desc,
      modelCount: plan.modelCount,
    });
  }
  return out;
}

/** Invalidate the cache (for testing or manual refresh). */
export function clearZenmuxCache() {
  catalogCache = null;
  planDetectCache.clear();
}
