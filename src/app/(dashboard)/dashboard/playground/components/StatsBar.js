"use client";

import PropTypes from "prop-types";
import { getPricingForModel, calculateCostFromTokens, formatCost } from "open-sse/providers/pricing.js";

function fmt(n) {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString();
}

function fmtLatency(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtCost(cost) {
  if (cost == null || cost === 0) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return formatCost(cost);
}

function estimateCost(stats) {
  if (!stats?.model || (!stats.inputTokens && !stats.outputTokens)) return null;
  const model = stats.model;
  const slashIdx = model.indexOf("/");
  const provider = slashIdx > 0 ? model.slice(0, slashIdx) : null;
  const modelName = slashIdx > 0 ? model.slice(slashIdx + 1) : model;
  const pricing = getPricingForModel(provider, modelName);
  if (!pricing) return null;
  const tokens = {
    prompt_tokens: stats.inputTokens || 0,
    completion_tokens: stats.outputTokens || 0,
    cached_tokens: stats.cachedTokens || 0,
    reasoning_tokens: stats.reasoningTokens || 0,
  };
  return calculateCostFromTokens(tokens, pricing);
}

export default function StatsBar({ stats, mode = "single" }) {
  if (mode === "compare") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-brand border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[14px] text-primary">compare_arrows</span>
          <span className="font-medium text-text-main">{stats.models || 0} models compared</span>
        </span>
        <span className="text-text-muted">·</span>
        <span className="text-text-muted">Total: {fmtLatency(stats.compareLatencyMs)}</span>
      </div>
    );
  }

  const cost = estimateCost(stats);
  const costLabel = fmtCost(cost);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-brand border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[14px] text-success">arrow_upward</span>
        <span className="text-text-muted">In:</span>
        <span className="font-mono font-medium text-text-main">{fmt(stats.inputTokens)}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[14px] text-info">arrow_downward</span>
        <span className="text-text-muted">Out:</span>
        <span className="font-mono font-medium text-text-main">{fmt(stats.outputTokens)}</span>
      </span>
      <span className="text-text-muted">·</span>
      <span className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[14px] text-text-muted">timer</span>
        <span className="text-text-muted">Latency:</span>
        <span className="font-mono font-medium text-text-main">{fmtLatency(stats.latencyMs)}</span>
      </span>
      {costLabel && (
        <>
          <span className="text-text-muted">·</span>
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px] text-warning">payments</span>
            <span className="text-text-muted">Cost:</span>
            <span className="font-mono font-medium text-warning">{costLabel}</span>
          </span>
        </>
      )}
      {stats.model && (
        <>
          <span className="text-text-muted">·</span>
          <span className="font-mono text-text-muted">{stats.model}</span>
        </>
      )}
    </div>
  );
}

StatsBar.propTypes = {
  stats: PropTypes.object,
  mode: PropTypes.string,
};
