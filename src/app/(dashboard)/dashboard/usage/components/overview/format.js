// Shared formatting helpers for the Overview tab. Copied from UsageStats.js /
// UsageTable.js plus a few extras used by the new overview cards. Pure functions,
// no React, so they can be imported from any component.

// Compact integer formatting with thousands separators.
export function fmt(n) {
  return new Intl.NumberFormat().format(n || 0);
}

// Compact token/cost numbers (1.2K, 3.4M). Good for sparkline axes and tight
// KPI cards where the full number is too wide.
export function fmtCompact(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

// USD cost, 2 decimals.
export function fmtCost(n) {
  return `$${(n || 0).toFixed(2)}`;
}

// Relative "time ago" from an ISO/epoch timestamp. Stable string output — pair
// with a single shared ticker in the parent instead of one timer per row.
export function fmtTime(iso) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// Milliseconds → human friendly (123ms, 1.2s).
export function fmtMs(ms) {
  const v = Number(ms || 0);
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  return `${Math.round(v)}ms`;
}

const format = { fmt, fmtCompact, fmtCost, fmtTime, fmtMs };
export default format;
