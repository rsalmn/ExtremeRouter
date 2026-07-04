"use client";

import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import PropTypes from "prop-types";

// Tiny inline sparkline for KPI cards. Stripped of axes/grid/tooltip — just the
// shape. Uses semantic color tokens so it adapts to light/dark.
const COLOR_VAR = {
  primary: "var(--color-primary)",
  info: "var(--color-info)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  cyan: "var(--color-cyan)",
};

// Resolve a CSS var to its current value at runtime (for gradient stop colors).
function resolveColor(token) {
  if (typeof window === "undefined") return token;
  const name = token.replace(/^var\(--(.*)\)$/, "$1");
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || token;
  } catch {
    return token;
  }
}

export default function Sparkline({
  data = [],
  color = "primary",
  height = 36,
  className = "",
}) {
  if (!data || data.length === 0) {
    return <div style={{ height }} className={className} aria-hidden />;
  }
  const series = data.map((v, i) => ({ i, v: Number(v) || 0 }));
  const stroke = COLOR_VAR[color] || COLOR_VAR.primary;
  const id = `spark-${color}`;
  const solid = resolveColor(stroke);

  return (
    <div className={className} style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={solid} stopOpacity={0.35} />
              <stop offset="100%" stopColor={solid} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={solid}
            strokeWidth={1.5}
            fill={`url(#${id})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

Sparkline.propTypes = {
  data: PropTypes.arrayOf(PropTypes.number),
  color: PropTypes.oneOf(["primary", "info", "success", "warning", "danger", "cyan"]),
  height: PropTypes.number,
  className: PropTypes.string,
};
