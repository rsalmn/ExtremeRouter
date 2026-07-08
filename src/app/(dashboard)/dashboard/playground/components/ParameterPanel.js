"use client";

import PropTypes from "prop-types";
import { useState } from "react";

export default function ParameterPanel({ params, onChange }) {
  const [expanded, setExpanded] = useState(true);

  const update = (key, val) => onChange({ ...params, [key]: val });

  return (
    <div className="rounded-brand border border-border-subtle bg-panel p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="mb-3 flex w-full items-center justify-between"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
          <span className="material-symbols-outlined text-[18px] text-primary">tune</span>
          Parameters
        </span>
        <span className={`material-symbols-outlined text-[18px] text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}>
          chevron_right
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-4">
          {/* System prompt */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">System Prompt</label>
            <textarea
              value={params.systemPrompt || ""}
              onChange={(e) => update("systemPrompt", e.target.value)}
              placeholder="You are a helpful assistant..."
              rows={3}
              className="custom-scrollbar w-full resize-none rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:border-primary focus:outline-none"
            />
          </div>

          {/* Temperature */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-text-muted">Temperature</label>
              <span className="text-xs font-mono text-text-main">{params.temperature?.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={params.temperature ?? 0.7}
              onChange={(e) => update("temperature", parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          {/* Max tokens */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">Max Tokens</label>
            <input
              type="number"
              min="1"
              max="128000"
              value={params.maxTokens ?? 4096}
              onChange={(e) => update("maxTokens", parseInt(e.target.value) || 4096)}
              className="w-full rounded-lg border border-border-subtle bg-surface-2 px-3 py-1.5 text-sm text-text-main focus:border-primary focus:outline-none"
            />
          </div>

          {/* Top P */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-text-muted">Top P</label>
              <span className="text-xs font-mono text-text-main">{params.topP?.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={params.topP ?? 1}
              onChange={(e) => update("topP", parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        </div>
      )}
    </div>
  );
}

ParameterPanel.propTypes = {
  params: PropTypes.shape({
    systemPrompt: PropTypes.string,
    temperature: PropTypes.number,
    maxTokens: PropTypes.number,
    topP: PropTypes.number,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
};
