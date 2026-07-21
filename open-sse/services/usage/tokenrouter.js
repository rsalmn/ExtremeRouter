// TokenRouter usage handler for Quota Tracker.
//
// Pulls wallet balance from the management API:
//   GET /api/management/self/wallet
//   Authorization: Bearer <management key>
//
// Returns:
//   {
//     topUpBalance: 120.50,         // remaining topped-up balance
//     voucherEfficientAmount: 30.00,// valid voucher balance
//     toppedUpSpent: 80.25,         // amount consumed from top-ups
//     voucherSpent: 10.00           // amount consumed from vouchers
//   }
//
// The management key is SEPARATE from the chat API key — it lives in
// connection.providerSpecificData.mgmtKey. Without it, we return null and the
// Quota Tracker simply shows nothing for this connection (no error).

import { U, toFiniteNumber } from "./shared.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export async function getTokenRouterUsage(credentials, providerSpecificData = {}, proxyOptions = null) {
  // The management key is intentionally NOT the chat API key. It must be set
  // separately on the connection (providerSpecificData.mgmtKey).
  const mgmtKey = providerSpecificData?.mgmtKey || credentials?.providerSpecificData?.mgmtKey;
  if (!mgmtKey) {
    // Return an empty (but non-null) result with a message explaining what's
    // missing. Returning `null` would make the Quota UI crash on `data.plan`.
    return {
      quotas: {},
      plan: null,
      message: "No management key set. Edit the connection and add your TokenRouter management key (separate from the chat API key) to enable wallet tracking.",
    };
  }

  const cfg = U("tokenrouter");
  const walletUrl = cfg.walletUrl;
  if (!walletUrl) return null;

  const headers = {
    Authorization: `Bearer ${mgmtKey}`,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };

  let res;
  try {
    res = await proxyAwareFetch(walletUrl, { method: "GET", headers }, proxyOptions);
  } catch {
    return { quotas: {}, plan: null, message: "Could not reach TokenRouter wallet API (network error)." };
  }
  if (!res?.ok) {
    const status = res?.status ?? 0;
    const hint = status === 401 || status === 403
      ? "Authentication failed — check that your management key is correct and hasn't expired."
      : `Wallet API returned HTTP ${status}.`;
    return { quotas: {}, plan: null, message: hint };
  }

  const body = await res.json().catch(() => null);
  if (!body?.success || !body.data) {
    return { quotas: {}, plan: null, message: "Wallet API returned an unexpected response shape." };
  }

  const w = body.data;
  // Aggregate topped-up + voucher into a single "wallet" quota row.
  const topUpBalance = toFiniteNumber(w.topUpBalance);
  const voucherBalance = toFiniteNumber(w.voucherEfficientAmount);
  const toppedUpSpent = toFiniteNumber(w.toppedUpSpent);
  const voucherSpent = toFiniteNumber(w.voucherSpent);

  const totalBalance = topUpBalance + voucherBalance;
  const totalSpent = toppedUpSpent + voucherSpent;
  const total = totalBalance + totalSpent;

  const quotas = {
    Wallet: {
      used: totalSpent,
      total,
      remaining: totalBalance,
      remainingPercentage: total > 0 ? Math.round((totalBalance / total) * 100) : null,
      resetAt: null,
    },
  };

  // Break down top-up vs voucher as separate rows when both are present, so the
  // user can see where their credit comes from.
  if (topUpBalance > 0 || toppedUpSpent > 0) {
    const topUpTotal = topUpBalance + toppedUpSpent;
    quotas["Top-up"] = {
      used: toppedUpSpent,
      total: topUpTotal,
      remaining: topUpBalance,
      remainingPercentage: topUpTotal > 0 ? Math.round((topUpBalance / topUpTotal) * 100) : null,
      resetAt: null,
    };
  }
  if (voucherBalance > 0 || voucherSpent > 0) {
    const voucherTotal = voucherBalance + voucherSpent;
    quotas["Voucher"] = {
      used: voucherSpent,
      total: voucherTotal,
      remaining: voucherBalance,
      remainingPercentage: voucherTotal > 0 ? Math.round((voucherBalance / voucherTotal) * 100) : null,
      resetAt: null,
    };
  }

  return {
    quotas,
    plan: null,
    credits: { remaining: totalBalance, used: totalSpent, total },
  };
}
