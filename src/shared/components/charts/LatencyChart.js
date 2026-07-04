"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PropTypes from "prop-types";

// Dual-series latency chart: avg + p95 over time (ms).
// data: [{ label, avgMs, p95Ms, samples }, ...]
function TooltipContent({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="rounded-brand border border-border bg-panel p-2.5 text-xs shadow-[var(--shadow-elev)]">
      <div className="mb-1 font-medium text-text-main">{label}</div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">p95</span>
          <span className="font-mono text-text-main">{(row.p95Ms || 0).toLocaleString()} ms</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">avg</span>
          <span className="font-mono text-text-main">{(row.avgMs || 0).toLocaleString()} ms</span>
        </div>
        {row.samples > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-1 text-text-subtle">
            <span>samples</span>
            <span className="font-mono">{row.samples}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LatencyChart({ data = [], height = 220 }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-text-muted" style={{ height }}>
        No latency data for this period
      </div>
    );
  }
  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="lat-p95" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-cyan)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="var(--color-cyan)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="lat-avg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
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
            width={44}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`)}
          />
          <Tooltip content={<TooltipContent />} />
          <Area type="monotone" dataKey="p95Ms" name="p95" stroke="var(--color-cyan)" strokeWidth={1.5} fill="url(#lat-p95)" isAnimationActive={false} />
          <Area type="monotone" dataKey="avgMs" name="avg" stroke="var(--color-primary)" strokeWidth={1.5} fill="url(#lat-avg)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

LatencyChart.propTypes = {
  data: PropTypes.arrayOf(PropTypes.object),
  height: PropTypes.number,
};
