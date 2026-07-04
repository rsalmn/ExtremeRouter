"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PropTypes from "prop-types";

// Stacked area chart of token share per provider over time.
// data: [{ label, [providerId]: tokens, ... }, ...]  (e.g. { label: "Jul 1", claude: 1200, openai: 800, Other: 100 })
// providers: [{ id, name, color }] — order = stack order (bottom→top).
const PROVIDER_COLORS = [
  "var(--color-primary)",
  "var(--color-cyan)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "#f472b6", // pink
  "#34d399", // emerald
  "#a78bfa", // violet-400
  "var(--color-danger)",
];

function TooltipContent({ active, payload, label, providerMeta }) {
  if (!active || !payload || !payload.length) return null;
  const sorted = [...payload].sort((a, b) => (b.value || 0) - (a.value || 0));
  const total = sorted.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-brand border border-border bg-panel p-2.5 text-xs shadow-[var(--shadow-elev)]">
      <div className="mb-1 font-medium text-text-main">{label}</div>
      <div className="space-y-0.5">
        {sorted.map((p) => {
          const meta = providerMeta?.[p.dataKey];
          return (
            <div key={p.dataKey} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                {meta?.name || p.dataKey}
              </span>
              <span className="font-mono text-text-main">{(p.value || 0).toLocaleString()}</span>
            </div>
          );
        })}
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-border-subtle pt-1 font-medium">
          <span className="text-text-muted">Total</span>
          <span className="font-mono text-text-main">{total.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

export default function StackedAreaChart({
  data = [],
  providers = [],
  height = 260,
}) {
  if (!data || data.length === 0 || providers.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-text-muted" style={{ height }}>
        No provider breakdown for this period
      </div>
    );
  }
  const providerMeta = {};
  providers.forEach((p, i) => {
    providerMeta[p.id] = { name: p.name || p.id, color: PROVIDER_COLORS[i % PROVIDER_COLORS.length] };
  });

  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            {providers.map((p, i) => {
              const color = PROVIDER_COLORS[i % PROVIDER_COLORS.length];
              const id = `stack-grad-${i}`;
              return (
                <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.7} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.15} />
                </linearGradient>
              );
            })}
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
            width={48}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
          />
          <Tooltip content={<TooltipContent providerMeta={providerMeta} />} />
          {providers.map((p, i) => (
            <Area
              key={p.id}
              type="monotone"
              dataKey={p.id}
              name={p.name || p.id}
              stackId="1"
              stroke={PROVIDER_COLORS[i % PROVIDER_COLORS.length]}
              strokeWidth={1.5}
              fill={`url(#stack-grad-${i})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

StackedAreaChart.propTypes = {
  data: PropTypes.arrayOf(PropTypes.object),
  providers: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, name: PropTypes.string })),
  height: PropTypes.number,
};
