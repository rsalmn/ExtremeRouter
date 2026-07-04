"use client";

import PropTypes from "prop-types";

// Hand-rolled SVG donut. Renders one arc per segment using stroke-dasharray on a
// single <circle>. No chart library dependency. Uses semantic color tokens so it
// adapts to light/dark via CSS vars resolved at render.
const SEGMENT_COLOR = {
  primary: "var(--color-primary)",
  info: "var(--color-info)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  cyan: "var(--color-cyan)",
  muted: "var(--color-surface-3)",
};

export default function DonutChart({
  segments = [],
  size = 140,
  thickness = 14,
  centerLabel,
  centerValue,
  className = "",
}) {
  const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  // Build arc offsets. Each segment occupies a fraction of the circumference.
  let offset = 0;
  const arcs = segments.map((seg, i) => {
    const value = Number(seg.value) || 0;
    const fraction = total > 0 ? value / total : 0;
    const dash = fraction * circumference;
    const arc = {
      key: i,
      color: SEGMENT_COLOR[seg.color] || seg.color || SEGMENT_COLOR.muted,
      dash,
      gap: circumference - dash,
      offset: -offset,
    };
    offset += dash;
    return arc;
  });

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track ring */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke="var(--color-surface-2)"
          strokeWidth={thickness}
        />
        {total > 0 && arcs.map((a) => (
          <circle
            key={a.key}
            cx={cx} cy={cy} r={radius}
            fill="none"
            stroke={a.color}
            strokeWidth={thickness}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={a.offset}
            strokeLinecap="butt"
            style={{ transition: "stroke-dasharray 0.4s ease, stroke-dashoffset 0.4s ease" }}
          />
        ))}
      </svg>
      {(centerValue !== undefined || centerLabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerValue !== undefined && (
            <span className="text-xl font-bold text-text-main leading-none">{centerValue}</span>
          )}
          {centerLabel && (
            <span className="mt-0.5 text-[10px] uppercase tracking-wide text-text-muted">{centerLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}

DonutChart.propTypes = {
  segments: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.number.isRequired,
      color: PropTypes.oneOf(["primary", "info", "success", "warning", "danger", "cyan", "muted"]),
      label: PropTypes.string,
    })
  ),
  size: PropTypes.number,
  thickness: PropTypes.number,
  centerLabel: PropTypes.string,
  centerValue: PropTypes.string,
  className: PropTypes.string,
};
