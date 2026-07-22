"use client";

import { Card } from "@/shared/components";

/**
 * KPI row for the Providers page — replaces the old ProviderSummary band.
 * Four tiles in a responsive grid: Total / Connected / Errors / Ready.
 *
 * Pattern lifted from ComboOverview.js: Card padding="sm", color-tinted
 * size-9 icon chip (inline `${color}15` alpha for ~8% tint), bold value,
 * micro-uppercase label.
 *
 * The Errors tile is interactive: clicking it filters the grid to only
 * providers with errors (onFilter("errors")).
 */
const KPIS = [
  { key: "total", label: "Total", icon: "dns", color: "#3B82F6" },
  { key: "connected", label: "Connected", icon: "link", color: "#10B981" },
  { key: "errors", label: "Errors", icon: "error", color: "#E11D48" },
  { key: "ready", label: "Ready", icon: "bolt", color: "#F59E0B" },
];

export default function ProviderKpis({ counts, activeFilter, onFilter }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {KPIS.map((kpi) => {
        const value = counts[kpi.key] || 0;
        const isActive = activeFilter === kpi.key;
        // Errors tile is clickable to filter; Total/Connected/Ready are static
        // (clicking them doesn't have a meaningful filter target today).
        const clickable = kpi.key === "errors" && value > 0;
        return (
          <Card
            key={kpi.key}
            padding="sm"
            className={`flex items-center gap-3 transition-all ${
              clickable ? "cursor-pointer hover:border-primary/35 hover:bg-panel-elev" : ""
            } ${isActive ? "border-primary/35 bg-primary/5" : ""}`}
          >
            {clickable ? (
              <button
                type="button"
                onClick={() => onFilter(isActive ? "all" : kpi.key)}
                className="flex w-full items-center gap-3 text-left"
                aria-label={`Filter by ${kpi.label.toLowerCase()}`}
              >
                <KpiContent kpi={kpi} value={value} />
              </button>
            ) : (
              <KpiContent kpi={kpi} value={value} />
            )}
          </Card>
        );
      })}
    </div>
  );
}

function KpiContent({ kpi, value }) {
  return (
    <>
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${kpi.color}15` }}
      >
        <span
          className="material-symbols-outlined text-[20px]"
          style={{ color: kpi.color }}
        >
          {kpi.icon}
        </span>
      </div>
      <div className="min-w-0">
        <div className="font-mono text-2xl font-bold leading-none text-text-main">
          {value}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">
          {kpi.label}
        </div>
      </div>
    </>
  );
}
