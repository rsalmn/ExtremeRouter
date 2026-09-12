/**
 * Xiaomi MiMo usage — weekly quota from the Xiaomi account session.
 *
 * Primary path: GET {mimo-server}/api/user/usage authorized by the account-session
 * cookie (see shared/mimoAccount.js). Response: { code: 0, data: { percent (remaining
 * %), resetDate, resetAt } }.
 *
 * Fallback: the sk- API key cannot read the quota, so when no account session is
 * available we surface a graceful message instead of failing.
 */
import { getMimoAccountUsage } from "../../shared/mimoAccount.js";

/**
 * @param {string|null|undefined} accessToken - sk- API key
 * @param {object|null} providerSpecificData - may contain mimoPassToken, mimoUserId, etc.
 * @param {object|null} proxyOptions
 */
export async function getXiaomiMimoUsage(accessToken = null, providerSpecificData = null, proxyOptions = null) {
  // Preferred path: the weekly quota comes from the account service session
  // (mimo-server /api/user/usage), which the sk- key cannot reach. The session is
  // derived from a persisted passToken via the SSO/sts handshake.
  const account = await getMimoAccountUsage(providerSpecificData, proxyOptions);
  if (typeof account.percent === "number" && Number.isFinite(account.percent)) {
    return formatQuota(account);
  }

  // Fallback: no account session available (Desktop never logged in, or its cookie
  // store is locked). The sk- key cannot read the quota, so surface a clear message.
  const key = accessToken || providerSpecificData?.apiKey;
  if (!key || typeof key !== "string" || !key.trim()) {
    return { message: "Xiaomi MiMo Desktop not connected. Add credentials to view usage." };
  }
  return {
    plan: "Xiaomi MiMo",
    message:
      account.error === "no-session"
        ? "Weekly quota requires a Xiaomi account session. API key alone is insufficient."
        : `Weekly quota unavailable (${account.error || "session-failed"}).`,
  };
}

function formatQuota(account) {
  // percent = remaining percentage (e.g. 94 means 94% remaining)
  const remaining = Math.max(0, Math.min(100, Math.round(account.percent)));
  const used = 100 - remaining;
  let resetAt = null;
  if (typeof account.resetAt === "number" && account.resetAt > 0) {
    resetAt = new Date(account.resetAt * 1000).toISOString();
  } else if (typeof account.resetDate === "string") {
    // Expected format "2026-09-16"
    const parsed = new Date(`${account.resetDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) resetAt = parsed.toISOString();
  }
  return {
    plan: "Xiaomi MiMo",
    quotas: {
      Weekly: { used, total: 100, remainingPercentage: remaining, resetAt, unlimited: false },
    },
  };
}
