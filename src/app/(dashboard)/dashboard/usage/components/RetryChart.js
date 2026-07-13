"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";

// RetryChart — shows retry statistics (total retries, retried requests, retry rate,
// and top providers by retry count) fetched from /api/usage/retry-stats.
export default function RetryChart({ period = "7d" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/usage/retry-stats?period=${period}`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setData(json);
        }
      } catch { /* non-fatal */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [period]);

  if (loading) {
    return (
      <Card>
        <div className="h-24 animate-pulse rounded bg-sidebar" />
      </Card>
    );
  }

  if (!data || data.totalRequests === 0) {
    return (
      <Card>
        <div className="flex items-center gap-3 py-4">
          <span className="material-symbols-outlined text-text-muted">replay</span>
          <span className="text-sm text-text-muted">No retry data for this period.</span>
        </div>
      </Card>
    );
  }

  const maxRetries = Math.max(...data.byProvider.map((p) => p.retries), 1);

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-main">Retry Activity</h3>
        <span className="text-xs text-text-muted">{period}</span>
      </div>

      {/* KPI row */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Retried Requests</p>
          <p className="font-mono text-lg font-bold text-text-main">{data.retriedRequests}</p>
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Total Retries</p>
          <p className="font-mono text-lg font-bold text-text-main">{data.totalRetries}</p>
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Retry Rate</p>
          <p className={`font-mono text-lg font-bold ${data.retryRate > 10 ? "text-warning" : "text-success"}`}>
            {data.retryRate}%
          </p>
        </div>
      </div>

      {/* Top providers by retry count */}
      {data.byProvider.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Top Providers by Retries</p>
          {data.byProvider.slice(0, 5).map((p) => (
            <div key={p.provider} className="flex items-center gap-3">
              <span className="w-28 truncate text-xs text-text-main">{p.provider}</span>
              <div className="flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-2 rounded-full bg-warning/60 transition-all"
                  style={{ width: `${(p.retries / maxRetries) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono text-xs text-text-muted">{p.retries}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
