"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import Sparkline from "@/shared/components/charts/Sparkline";
import { fmt, fmtCost } from "./format";

// Map each of the 10-minute buckets to the metric this card cares about.
// last10Minutes shape: [{ requests, promptTokens, completionTokens, cost } x10]
const pick = (buckets, key) => (buckets || []).map((b) => Number(b?.[key]) || 0);

// Static class strings per color so Tailwind's JIT can detect every class.
// (Dynamically built class names like `bg-${color}/12` are NOT scanned.)
const CHIPS = {
  primary: "bg-primary/12 text-primary ring-1 ring-primary/20",
  info: "bg-info/12 text-info ring-1 ring-info/20",
  success: "bg-success/12 text-success ring-1 ring-success/20",
  warning: "bg-warning/12 text-warning ring-1 ring-warning/20",
  cyan: "bg-cyan/12 text-cyan ring-1 ring-cyan/20",
};
const VALUES = {
  primary: "text-primary",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  cyan: "text-cyan",
};

function KpiCard({ icon, color, label, value, sublabel, spark }) {
  return (
    <Card padding="sm" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-brand ${CHIPS[color] || CHIPS.primary}`}
        >
          <span className="material-symbols-outlined text-[18px]">{icon}</span>
        </span>
        <span className="truncate text-xs font-medium uppercase tracking-wide text-text-muted">
          {label}
        </span>
      </div>
      <div className="flex min-w-0 items-baseline gap-1">
        <span className={`truncate text-2xl font-bold tracking-tight ${VALUES[color] || VALUES.primary}`}>
          {value}
        </span>
      </div>
      <Sparkline data={spark} color={color} height={32} className="-mb-1" />
      {sublabel && (
        <span className="truncate text-[11px] text-text-muted">{sublabel}</span>
      )}
    </Card>
  );
}

KpiCard.propTypes = {
  icon: PropTypes.string.isRequired,
  color: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  sublabel: PropTypes.string,
  spark: PropTypes.arrayOf(PropTypes.number),
};

export default function OverviewKpiRow({ stats }) {
  const buckets = stats?.last10Minutes || [];

  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-4">
      <KpiCard
        icon="bolt"
        color="primary"
        label="Total Requests"
        value={fmt(stats?.totalRequests)}
        spark={pick(buckets, "requests")}
      />
      <KpiCard
        icon="input"
        color="info"
        label="Input Tokens"
        value={fmt(stats?.totalPromptTokens)}
        spark={pick(buckets, "promptTokens")}
      />
      <KpiCard
        icon="output"
        color="success"
        label="Output Tokens"
        value={fmt(stats?.totalCompletionTokens)}
        spark={pick(buckets, "completionTokens")}
      />
      <KpiCard
        icon="cached"
        color="cyan"
        label="Cache Saved"
        value={fmt(stats?.totalCachedTokens)}
        // last10Minutes has no cached bucket — surface the current cached total
        // so the card still reads as "live" instead of a flat zero line.
        spark={
          buckets.length
            ? buckets.map((_, i) =>
                i === buckets.length - 1 ? Number(stats?.totalCachedTokens) || 0 : 0
              )
            : [Number(stats?.totalCachedTokens) || 0]
        }
      />
      <KpiCard
        icon="payments"
        color="warning"
        label="Est. Cost"
        value={`~${fmtCost(stats?.totalCost)}`}
        sublabel="Estimated, not actual billing"
        spark={pick(buckets, "cost")}
      />
    </div>
  );
}

OverviewKpiRow.propTypes = {
  stats: PropTypes.object.isRequired,
};
