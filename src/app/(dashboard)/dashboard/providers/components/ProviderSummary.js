"use client";

import PropTypes from "prop-types";
import { Button } from "@/shared/components";

/**
 * Compact summary band above the provider sections:
 * total providers · connected · errors + global Test All button.
 */
export default function ProviderSummary({
  totalProviders,
  connectedProviders,
  errorCount,
  onTestAll,
  testingMode,
}) {
  return (
    <div className="flex flex-col gap-3 rounded-brand border border-border-subtle bg-panel p-4 shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">dns</span>
          <span className="font-semibold text-text-main">{totalProviders}</span>
          <span className="text-text-muted">providers</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-success" />
          <span className="font-semibold text-text-main">{connectedProviders}</span>
          <span className="text-text-muted">connected</span>
        </div>
        {errorCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-danger" />
            <span className="font-semibold text-text-main">{errorCount}</span>
            <span className="text-text-muted">errors</span>
          </div>
        )}
      </div>
      {onTestAll && (
        <Button
          size="sm"
          variant="primary"
          icon={testingMode === "all" ? "progress_activity" : "bolt"}
          onClick={onTestAll}
          disabled={!!testingMode}
          className={testingMode === "all" ? "animate-pulse" : ""}
        >
          {testingMode === "all" ? "Testing All..." : "Test All Providers"}
        </Button>
      )}
    </div>
  );
}

ProviderSummary.propTypes = {
  totalProviders: PropTypes.number,
  connectedProviders: PropTypes.number,
  errorCount: PropTypes.number,
  onTestAll: PropTypes.func,
  testingMode: PropTypes.string,
};
