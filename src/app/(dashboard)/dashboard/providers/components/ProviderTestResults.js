"use client";

import PropTypes from "prop-types";

const MODE_LABELS = {
  oauth: "OAuth",
  free: "Free",
  apikey: "API Key",
  cookie: "Cookies",
  compatible: "Custom",
  provider: "Provider",
  all: "All",
};

export default function ProviderTestResults({ results }) {
  if (results.error && !results.results) {
    return (
      <div className="py-6 text-center">
        <span className="material-symbols-outlined mb-2 block text-[32px] text-danger">error</span>
        <p className="text-sm text-danger">{results.error}</p>
      </div>
    );
  }

  const { summary, mode } = results;
  const items = results.results || [];
  const modeLabel = MODE_LABELS[mode] || mode;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {summary && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs sm:gap-3">
          <span className="text-text-muted">{modeLabel} Test</span>
          <span className="rounded bg-success/15 px-2 py-0.5 font-medium text-success">
            {summary.passed} passed
          </span>
          {summary.failed > 0 && (
            <span className="rounded bg-danger/15 px-2 py-0.5 font-medium text-danger">
              {summary.failed} failed
            </span>
          )}
          <span className="text-text-muted sm:ml-auto">{summary.total} tested</span>
        </div>
      )}
      {items.map((r, i) => (
        <div
          key={r.connectionId || i}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs sm:flex-nowrap"
        >
          <span className={`material-symbols-outlined text-[16px] ${r.valid ? "text-success" : "text-danger"}`}>
            {r.valid ? "check_circle" : "error"}
          </span>
          <div className="min-w-0 flex-[1_1_160px]">
            <span className="block truncate font-medium sm:inline">{r.connectionName}</span>
            <span className="block truncate text-text-muted sm:ml-1.5 sm:inline">({r.provider})</span>
          </div>
          {r.latencyMs !== undefined && (
            <span className="shrink-0 font-mono tabular-nums text-text-muted">{r.latencyMs}ms</span>
          )}
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              r.valid ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
            }`}
          >
            {r.valid ? "OK" : r.diagnosis?.type || "ERROR"}
          </span>
        </div>
      ))}
      {items.length === 0 && (
        <div className="py-4 text-center text-sm text-text-muted">
          No active connections found for this group.
        </div>
      )}
    </div>
  );
}

ProviderTestResults.propTypes = {
  results: PropTypes.shape({
    mode: PropTypes.string,
    results: PropTypes.array,
    summary: PropTypes.shape({
      total: PropTypes.number,
      passed: PropTypes.number,
      failed: PropTypes.number,
    }),
    error: PropTypes.string,
  }).isRequired,
};
