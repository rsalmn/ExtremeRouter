"use client";

import { useState } from "react";
import PropTypes from "prop-types";

const fmt = (n) => {
  const num = Number(n || 0);
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
};

// Per-mechanism breakdown chips for the "Tokens Saved" card.
// Ordered by typical magnitude / importance. Colors follow the dashboard palette.
const MECHANISM_META = [
  { key: "rtk", label: "RTK", icon: "compress", color: "text-primary" },
  { key: "headroom", label: "Headroom", icon: "air", color: "text-info" },
  { key: "pxpipe", label: "Pxpipe", icon: "image_search", color: "text-secondary" },
  { key: "cache", label: "Cache", icon: "cached", color: "text-success" },
  { key: "caveman", label: "Caveman", icon: "short_text", color: "text-warning" },
  { key: "ponytail", label: "Ponytail", icon: "notes", color: "text-accent" },
];

function SavingsBreakdown({ breakdown }) {
  const entries = MECHANISM_META
    .map((m) => ({ ...m, value: breakdown?.[m.key] || 0 }))
    .filter((m) => m.value > 0);

  if (entries.length === 0) {
    return <p className="text-xs text-text-muted">No per-mechanism data yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {entries.map((m) => (
        <span
          key={m.key}
          className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium"
          title={`${m.label}: ${m.value.toLocaleString()} tokens saved`}
        >
          <span className={`material-symbols-outlined text-[12px] ${m.color}`}>{m.icon}</span>
          <span className="text-text-muted">{m.label}</span>
          <span className="font-semibold text-text-main">{fmt(m.value)}</span>
        </span>
      ))}
    </div>
  );
}

const CARDS = [
  { key: "tokensSaved", icon: "savings", color: "success", label: "Tokens Saved", sub: "All token savers", expandable: true },
  { key: "requestsRouted", icon: "route", color: "primary", label: "Requests Routed", sub: "Lifetime" },
  { key: "cacheTokens", icon: "cached", color: "info", label: "Cache Tokens", sub: "From cache reads" },
];

export default function OverviewKpiCards({ data }) {
  const [expanded, setExpanded] = useState(false);
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
        const isExpanded = c.expandable && expanded;
        return (
          <div
            key={c.key}
            className={`flex flex-col gap-2 rounded-panel border bg-panel p-5 shadow-[var(--shadow-soft)] ${
              c.expandable ? "cursor-pointer transition-colors hover:border-primary/30" : "border-border-subtle"
            } ${isExpanded ? "border-primary/30" : "border-border-subtle"}`}
            onClick={c.expandable ? () => setExpanded((v) => !v) : undefined}
          >
            <div className="flex items-center gap-3">
              <div className={`flex size-10 items-center justify-center rounded-brand ring-1 ${colorMap[c.color]}`}>
                <span className="material-symbols-outlined text-[20px]">{c.icon}</span>
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-2xl font-bold text-text-main">{fmt(values[c.key])}</span>
              </div>
              {c.expandable && (
                <span className={`material-symbols-outlined text-[18px] text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                  expand_more
                </span>
              )}
            </div>
            <div className="text-sm font-medium text-text-main">{c.label}</div>
            <div className="text-xs text-text-muted">{c.sub}</div>
            {isExpanded && c.key === "tokensSaved" && (
              <div className="mt-2 border-t border-border-subtle pt-2">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Breakdown by mechanism</p>
                <SavingsBreakdown breakdown={data.tokensSavedByMechanism} />
                {data.semanticCacheHits > 0 && (
                  <p className="mt-2 text-[11px] text-text-muted">
                    <span className="material-symbols-outlined text-[12px] align-middle text-success">bolt</span>
                    {" "}{data.semanticCacheHits.toLocaleString()} cache hits served from Semantic Cache
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

OverviewKpiCards.propTypes = { data: PropTypes.object };
