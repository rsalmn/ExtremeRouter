"use client";

import PropTypes from "prop-types";

const fmt = (n) => {
  const num = Number(n || 0);
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
};

const CARDS = [
  { key: "tokensSaved", icon: "savings", color: "success", label: "Tokens Saved", sub: "Via RTK + Headroom" },
  { key: "requestsRouted", icon: "route", color: "primary", label: "Requests Routed", sub: "Lifetime" },
  { key: "cacheTokens", icon: "cached", color: "info", label: "Cache Tokens", sub: "From cache reads" },
];

export default function OverviewKpiCards({ data }) {
  if (!data) return null;
  const values = {
    tokensSaved: data.tokensSavedLifetime,
    requestsRouted: data.totalRequestsLifetime,
    cacheTokens: data.totalCachedTokens,
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {CARDS.map((c) => {
        const colorMap = {
          success: "bg-success/10 text-success ring-success/20",
          primary: "bg-primary/10 text-primary ring-primary/20",
          info: "bg-info/10 text-info ring-info/20",
        };
        return (
          <div key={c.key} className="flex flex-col gap-2 rounded-panel border border-border-subtle bg-panel p-5 shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3">
              <div className={`flex size-10 items-center justify-center rounded-brand ring-1 ${colorMap[c.color]}`}>
                <span className="material-symbols-outlined text-[20px]">{c.icon}</span>
              </div>
              <div className="min-w-0">
                <span className="text-2xl font-bold text-text-main">{fmt(values[c.key])}</span>
              </div>
            </div>
            <div className="text-sm font-medium text-text-main">{c.label}</div>
            <div className="text-xs text-text-muted">{c.sub}</div>
          </div>
        );
      })}
    </div>
  );
}

OverviewKpiCards.propTypes = { data: PropTypes.object };
