// Cline / ClinePass usage handler for Quota Tracker.
//
// Both providers share the same upstream API host (api.cline.bot) and the same
// plan-limits endpoint:
//   GET /api/v1/users/me/plan/usage-limits
//   Authorization: Bearer <accessToken | apiKey>
//
// Response shape:
//   { data: { limits: [
//     { type: "five_hour", percentUsed: 0 },
//     { type: "weekly",    percentUsed: 51, resetsAt: "2026-07-25T..." },
//     { type: "monthly",   percentUsed: 100, resetsAt: "2026-08-03T..." },
//   ] }, success: true }
//
// The API only exposes percentUsed (no absolute token/request counts), so each
// quota is normalized as used=percentUsed / total=100. The Quota Tracker UI
// derives the remaining% from these and renders the bar accordingly. The
// "N / 100" text under the bar reads naturally as "percent used of cap".
//
// Works with BOTH auth modes:
//   - OAuth connections: uses the OAuth access token (preferred)
//   - API-key connections: uses the sk-... API key directly
// `features.usage` + `features.usageApikey` are both set on the registry so
// either connection type is eligible for tracking.

import { U, parseResetTime, toFiniteNumber } from "./shared.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// Human-readable labels for each limit window Cline exposes. Order matters for
// stable card layout (shortest window first — matches the API array order).
const LIMIT_LABELS = {
  five_hour: "5-Hour",
  weekly: "Weekly",
  monthly: "Monthly",
};

export async function getClineUsage(credentials, proxyOptions = null) {
  // Prefer OAuth access token, fall back to API key for api-key connections.
  // Both are sent as Bearer tokens against the same Cline endpoint.
  const token = credentials?.accessToken || credentials?.apiKey;
  if (!token) return null;

  const cfg = U("cline");
  const url = cfg.url || "https://api.cline.bot/api/v1/users/me/plan/usage-limits";

  const res = await proxyAwareFetch(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    },
    proxyOptions,
  );

  if (!res?.ok) {
    // Non-fatal: the Quota Tracker shows an empty card on failure. Keep a
    // concise reason in the message field so the card isn't silently blank.
    return {
      quotas: {},
      plan: null,
      message: `Cline usage request failed (${res?.status || "no response"})`,
    };
  }

  const body = await res.json().catch(() => null);
  const limits = Array.isArray(body?.data?.limits) ? body.data.limits : [];

  const quotas = {};
  for (const limit of limits) {
    const key = LIMIT_LABELS[limit?.type] || limit?.type || "Unknown";
    const percentUsed = toFiniteNumber(limit?.percentUsed, 0);
    // Clamp 0–100 — the API has been observed returning values outside range
    // during edge cases (e.g. 100 for an exhausted monthly cap). Defensive.
    const clamped = Math.max(0, Math.min(100, percentUsed));

    quotas[key] = {
      // Percentage-carrier shape: used/total out of 100. The UI's
      // getRemainingPercentage() derives `100 - used` from this directly.
      used: clamped,
      total: 100,
      // Explicit remaining so the table never falls back to calculatePercentage
      // (which would re-derive the same number, but be explicit).
      remainingPercentage: 100 - clamped,
      resetAt: parseResetTime(limit?.resetsAt) || null,
    };
  }

  if (Object.keys(quotas).length === 0) {
    return {
      quotas: {},
      plan: null,
      message: "Cline returned no usage limits for this account.",
    };
  }

  return {
    quotas,
    plan: null,
  };
}
