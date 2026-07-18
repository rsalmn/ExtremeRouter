// xAI (Grok) usage handler for Quota Tracker.
//
// Uses two read-only endpoints with the OAuth access token:
//   1. GET /v1/billing?format=credits — on-demand credits (remaining, used, total)
//   2. GET /v1/user?include=subscription — active subscription plan name
//
// Only OAuth connections are eligible (the token scope includes grok-cli:access).
// API-key xAI connections are excluded by the USAGE_SUPPORTED_PROVIDERS gate.
//
// Reference: github.com/decolua/9router PR #2672

import { U, parseResetTime, toFiniteNumber } from "./shared.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export async function getXaiUsage(credentials, proxyOptions = null) {
  const token = credentials?.accessToken;
  if (!token) return null;

  const cfg = U("xai");
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };

  // Fetch billing + subscription in parallel
  const [billingRes, subRes] = await Promise.allSettled([
    cfg.billingUrl
      ? proxyAwareFetch(cfg.billingUrl, { method: "GET", headers }, proxyOptions)
      : Promise.reject(new Error("no billingUrl")),
    cfg.subscriptionUrl
      ? proxyAwareFetch(cfg.subscriptionUrl, { method: "GET", headers }, proxyOptions)
      : Promise.reject(new Error("no subscriptionUrl")),
  ]);

  let credits = null;
  let plan = null;

  // Parse billing response (credits data)
  if (billingRes.status === "fulfilled" && billingRes.value?.ok) {
    const billingData = await billingRes.value.json().catch(() => null);
    if (billingData) {
      const remaining = toFiniteNumber(billingData.credits ?? billingData.remaining_credits);
      const used = toFiniteNumber(billingData.used_credits ?? billingData.used);
      const total = toFiniteNumber(billingData.total_credits ?? billingData.total);

      if (remaining > 0 || total > 0 || used > 0) {
        credits = {
          remaining,
          used,
          total: total || (remaining + used),
          remainingPercentage: total > 0 ? Math.round((remaining / total) * 100) : null,
          resetAt: parseResetTime(billingData.reset_at ?? billingData.reset_date) || null,
        };
      }
    }
  }

  // Parse subscription response (plan name)
  if (subRes.status === "fulfilled" && subRes.value?.ok) {
    const subData = await subRes.value.json().catch(() => null);
    if (subData) {
      const sub = subData.subscription || subData;
      plan = sub.plan || sub.tier || sub.name || null;
    }
  }

  // Build quotas object
  const quotas = {};

  if (credits) {
    quotas["Credits"] = {
      used: credits.used,
      total: credits.total,
      remaining: credits.remaining,
      remainingPercentage: credits.remainingPercentage,
      resetAt: credits.resetAt,
    };
  }

  // If no numeric credit data but we have a plan, show it as info-only quota
  if (Object.keys(quotas).length === 0 && plan) {
    quotas[plan] = {
      used: 0,
      total: 0,
      unlimited: true,
      remainingPercentage: null,
    };
  }

  return {
    quotas,
    plan,
    credits,
  };
}
