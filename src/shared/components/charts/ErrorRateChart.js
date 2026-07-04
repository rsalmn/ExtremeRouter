"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PropTypes from "prop-types";

// Stacked bar chart: ok vs error requests per bucket.
// data: [{ label, ok, error }, ...]
function TooltipContent({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload || {};
  const total = (row.ok || 0) + (row.error || 0);
  const rate = total > 0 ? ((row.error / total) * 100).toFixed(1) : "0.0";
  return (
    <div className="rounded-brand border border-border bg-panel p-2.5 text-xs shadow-[var(--shadow-elev)]">
      <div className="mb-1 font-medium text-text-main">{label}</div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-text-muted">
            <span className="size-2 rounded-full bg-success" /> OK
          </span>
          <span className="font-mono text-text-main">{(row.ok || 0).toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-text-muted">
            <span className="size-2 rounded-full bg-danger" /> Error
          </span>
          <span className="font-mono text-text-main">{(row.error || 0).toLocaleString()}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-4 border-t border-border-subtle pt-1">
          <span className="text-text-muted">error rate</span>
          <span className="font-mono font-medium text-danger">{rate}%</span>
        </div>
      </div>
    </div>
  );
}

export default function ErrorRateChart({ data = [], height = 180 }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-text-muted" style={{ height }}>
        No request data for this period
      </div>
    );
  }
  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.4} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
            tickLine={false}
            axisLine={false}
            width={32}
            allowDecimals={false}
          />
          <Tooltip content={<TooltipContent />} cursor={{ fill: "var(--color-surface-2)", opacity: 0.5 }} />
          <Bar dataKey="ok" stackId="a" name="OK" fill="var(--color-success)" fillOpacity={0.6} radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="error" stackId="a" name="Error" fill="var(--color-danger)" fillOpacity={0.85} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

ErrorRateChart.propTypes = {
  data: PropTypes.arrayOf(PropTypes.object),
  height: PropTypes.number,
};
