/**
 * Kimi Desktop quota service.
 *
 * Ground truth from the desktop token store (verified against a live install):
 *   - access_token JWT claims carry `membership: { level }` + `typ/app_id/...`
 *   - `msh_user_subscription_data` is a JSON STRING like
 *       {"currentMembershipLevel": 10}
 *   - There is NO exposed user-info / quota endpoint — the desktop app only
 *     writes the token store; usage/Gift/Total counters are not written locally.
 *
 * Strategy (ponytail: local-store only; upgrade to a live `www.kimi.com`
 * user-info endpoint when one is found — currently the desktop app never
 * fetches/submits one):
 *   Tier           → map membership level (0..11) → label.
 *   Usage Detail   → Subscription Quota / Gift Quota  = subscription fields.
 *   My Quota       → Total Usage / Gift Usage         = subscription fields.
 *
 * `msh_user_subscription_data` parsing is defensive: string, object, or null.
 */
import { readKimiDesktopStore } from "./kimi-desktop.js";

/** Kimi membership tiers by subscription level. */
const MEMBERSHIP_LEVELS = {
  0: "Adagio (Free)",
  1: "Moderato",
  2: "Allegretto",
  3: "Allegro",
  4: "Vivace",
  10: "Kimi Code (Premium / Dev)",
};

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Parse `msh_user_subscription_data` — may be a JSON string, an object, or null.
 * Always returns a (possibly empty) object.
 */
export function parseMshUserSubscriptionData(raw) {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Resolve tier label from membership level (int) with graceful fallback.
 */
export function membershipLevelToTier(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return `Unknown (${level})`;
  return MEMBERSHIP_LEVELS[n] || `Unknown (Level ${n})`;
}

/**
 * Extract the quota shape expected by the UI card.
 *
 * @param {{ tokens?: {access_token?: string}, msh_user_subscription_data?: any }} store
 * @returns {{
 *   tier: string,
 *   membershipLevel: number|null,
 *   usageDetail: { subscriptionQuota: string, giftQuota: string },
 *   myQuota: { totalUsage: string, giftUsage: string },
 *   subscriptionData: object,
 *   tokenValid: boolean,
 * }}
 */
export function buildKimiDesktopQuota(store) {
  const tokens = store?.tokens || {};
  const accessToken = tokens.access_token;
  const claims = decodeJwtPayload(accessToken);
  const membershipLevel =
    claims?.membership?.level != null ? Number(claims.membership.level) : null;
  const tier = membershipLevel != null ? membershipLevelToTier(membershipLevel) : "Unknown";

  const sub = parseMshUserSubscriptionData(store?.msh_user_subscription_data);
  const currentLevel = sub.currentMembershipLevel;

  // The desktop app does NOT persist usage counters locally; only the tier
  // and (optionally) gift amounts are present. Report the fields that exist
  // and mark the rest as "N/A (desktop store)".
  return {
    tier,
    membershipLevel,
    usageDetail: {
      subscriptionQuota: currentLevel != null ? `Level ${currentLevel}` : "N/A (desktop store)",
      giftQuota: sub.giftQuota != null ? String(sub.giftQuota) : "N/A (desktop store)",
    },
    myQuota: {
      totalUsage: "N/A (desktop store)",
      giftUsage: "N/A (desktop store)",
    },
    subscriptionData: sub,
    tokenValid: !!claims,
  };
}

/**
 * Live quota lookup for kimi-desktop: read the desktop token store and shape
 * the data. Returns null when the store is missing.
 */
export async function getKimiDesktopQuota() {
  const store = await readKimiDesktopStore();
  if (!store) return null;
  return buildKimiDesktopQuota(store);
}
