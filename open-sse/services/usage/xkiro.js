// xKiro usage handler for Quota Tracker.
//
// Uses the SAME sk-xt- key used for chat:
//   GET https://api.xkiro.com/v1/usage
//   Authorization: Bearer <api key>
//
// xKiro docs: this endpoint is free to call — it costs nothing, consumes no
// tokens, and does not count against rate limits or spend windows.
//
// Response shape (USD amounts are fixed-point STRINGS with six decimals —
// parse as numbers for display, never accumulate floats for accounting):
// {
//   object: "usage",
//   plan: "ultra" | null,            // null = pay-as-you-go
//   windows: [                       // empty on PAYG (wallet is the only limit)
//     { kind: "short"|"long", window_sec: 18000|604800, spent_usd, cap_usd,
//       remaining_usd, resets_in_sec }
//   ],
//   free_tokens: { used_today, limit_per_day|null, remaining|null },
//   wallet: { balance_usd, held_usd } | null   // null until first top-up
// }
//
// Free tokens and paid spend are INDEPENDENT budgets (docs): exhausting the
// daily free allowance never blocks paid models, so they render as separate
// quota rows.

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const USAGE_URL = "https://api.xkiro.com/v1/usage";

// Humanize a window length: 18000 → "5h", 604800 → "7d", 3600 → "1h".
function windowLabel(windowSec) {
  if (!Number.isFinite(windowSec) || windowSec <= 0) return "Spend window";
  if (windowSec % 86400 === 0) return `Spend window (${windowSec / 86400}d)`;
  if (windowSec % 3600 === 0) return `Spend window (${windowSec / 3600}h)`;
  return `Spend window (${Math.round(windowSec / 60)}m)`;
}

// USD fixed-point string → number. parseFloat is display-safe here; the
// handler never accumulates or does math beyond used/total/remaining.
const usd = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Free tokens reset at 00:00 UTC (docs: "used since 00:00 UTC").
function nextUtcMidnight() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

export async function getXkiroUsage(credentials, proxyOptions = null) {
  const token = credentials?.apiKey || credentials?.accessToken;
  if (!token) return null;

  let res;
  try {
    res = await proxyAwareFetch(
      USAGE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
  } catch {
    return { quotas: {}, plan: null, message: "Failed to reach xKiro usage API." };
  }

  if (!res?.ok) {
    const status = res?.status || "no response";
    return {
      quotas: {},
      plan: null,
      message: status === 401 ? "xKiro key invalid or disabled (401)." : `xKiro usage request failed (${status}).`,
    };
  }

  const data = await res.json().catch(() => null);
  if (!data || data.object !== "usage") {
    return { quotas: {}, plan: null, message: "xKiro returned no usage data." };
  }

  const quotas = {};

  // Spend windows, in payload order (short/long — read the length from
  // window_sec rather than assuming which is which, per docs).
  for (const w of Array.isArray(data.windows) ? data.windows : []) {
    const cap = usd(w?.cap_usd);
    const remaining = usd(w?.remaining_usd);
    quotas[windowLabel(w?.window_sec)] = {
      used: usd(w?.spent_usd),
      total: cap,
      remaining,
      // cap 0 must not divide-by-zero; null renders as an uncapped row.
      remainingPercentage: cap > 0 ? Math.max(0, Math.min(100, (remaining / cap) * 100)) : null,
      resetAt: Number.isFinite(w?.resets_in_sec) && w.resets_in_sec > 0
        ? new Date(Date.now() + w.resets_in_sec * 1000).toISOString()
        : null,
    };
  }

  // Daily free-model allowance — a separate budget from paid spend.
  const free = data.free_tokens;
  if (free && free.limit_per_day != null) {
    const limit = Number(free.limit_per_day) || 0;
    const remaining = free.remaining != null ? Number(free.remaining) : Math.max(0, limit - (Number(free.used_today) || 0));
    quotas["Free tokens (today)"] = {
      used: Number(free.used_today) || 0,
      total: limit,
      remaining,
      remainingPercentage: limit > 0 ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : null,
      resetAt: nextUtcMidnight(),
    };
  }

  // Wallet balance — prepaid dollars, wallet-style unlimited row. held_usd is
  // money reserved for in-flight requests (settled later), NOT a deduction.
  const wallet = data.wallet;
  if (wallet && wallet.balance_usd != null) {
    const balance = usd(wallet.balance_usd);
    quotas.Wallet = {
      used: 0,
      total: balance,
      remaining: balance,
      remainingPercentage: null,
      resetAt: null,
    };
  }

  if (Object.keys(quotas).length === 0) {
    return {
      quotas: {},
      plan: null,
      message: "xKiro returned no spend windows, free-token allowance, or wallet.",
    };
  }

  return {
    quotas,
    plan: data.plan || "pay-as-you-go",
  };
}
