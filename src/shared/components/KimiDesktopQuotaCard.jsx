"use client";

import { useState, useEffect } from "react";

function fmt(v) {
  if (v == null || v === "") return "—";
  return String(v);
}

export default function KimiDesktopQuotaCard() {
  const [quota, setQuota] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/oauth/kimi-desktop/quota", { cache: "no-store" });
        if (!res.ok) throw new Error("Quota endpoint unavailable");
        const data = await res.json();
        if (!data.found) throw new Error(data.error || "Token store not found");
        if (!cancelled) setQuota(data.quota);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-black/[0.02] px-4 py-3 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
        <span className="material-symbols-outlined text-[14px] align-middle mr-1">info</span>
        {error}
      </div>
    );
  }

  if (!quota) {
    return (
      <div className="rounded-xl border border-border bg-black/[0.02] px-4 py-3 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
        Loading quota…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-black/[0.02] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Kimi Desktop Quota
      </h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Tier */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Tier</p>
          <p className="mt-0.5 text-sm font-medium text-text-primary">{fmt(quota.tier)}</p>
        </div>

        {/* Usage Detail */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Usage Detail</p>
          <p className="mt-0.5 text-xs text-text-primary">
            Subscription Quota: <span className="font-medium">{fmt(quota.usageDetail?.subscriptionQuota)}</span>
          </p>
          <p className="text-xs text-text-primary">
            Gift Quota: <span className="font-medium">{fmt(quota.usageDetail?.giftQuota)}</span>
          </p>
        </div>

        {/* My Quota */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">My Quota</p>
          <p className="mt-0.5 text-xs text-text-primary">
            Total Usage: <span className="font-medium">{fmt(quota.myQuota?.totalUsage)}</span>
          </p>
          <p className="text-xs text-text-primary">
            Gift Usage: <span className="font-medium">{fmt(quota.myQuota?.giftUsage)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
