"use client";

import PropTypes from "prop-types";
import { Button, EmptyState } from "@/shared/components";

/**
 * Collapsible provider section — header with toggle + count + Test All button,
 * body grid with cards. Auto-expands when searching.
 */
export default function ProviderSection({
  title,
  icon,
  count,
  connectedCount,
  isExpanded,
  onToggle,
  isSearching,
  onTestAll,
  testingMode,
  testModeKey,
  children,
  hasContent = true,
  emptyTitle = "No providers in this category",
  emptyDescription = "Providers you add will appear here.",
}) {
  const showBody = isExpanded || isSearching;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-lg font-semibold leading-tight text-text-main transition-colors hover:text-primary"
          aria-expanded={showBody}
        >
          <span className={`material-symbols-outlined text-[20px] transition-transform ${showBody ? "rotate-90" : ""}`}>
            chevron_right
          </span>
          {title}
          <span className="text-xs font-normal text-text-muted">
            ({count})
          </span>
        </button>
        {onTestAll && hasContent && (
          <Button
            size="sm"
            variant="outline"
            icon={testingMode === testModeKey ? "progress_activity" : "play_arrow"}
            onClick={onTestAll}
            disabled={!!testingMode}
            className={testingMode === testModeKey ? "animate-pulse" : ""}
          >
            {testingMode === testModeKey ? "Testing..." : "Test All"}
          </Button>
        )}
      </div>
      {showBody && (
        hasContent ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {children}
          </div>
        ) : (
          <EmptyState
            icon={icon || "dns"}
            title={emptyTitle}
            description={emptyDescription}
          />
        )
      )}
    </div>
  );
}

ProviderSection.propTypes = {
  title: PropTypes.string.isRequired,
  icon: PropTypes.string,
  count: PropTypes.number.isRequired,
  connectedCount: PropTypes.number,
  isExpanded: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  isSearching: PropTypes.bool,
  onTestAll: PropTypes.func,
  testingMode: PropTypes.string,
  testModeKey: PropTypes.string,
  children: PropTypes.node,
  hasContent: PropTypes.bool,
  emptyTitle: PropTypes.string,
  emptyDescription: PropTypes.string,
};
