"use client";

import { cn } from "@/shared/utils/cn";

/**
 * Filter chips + sort control bar for the Providers page.
 *
 * Left: category filter pills (All / Connected / Errors / OAuth / API Key /
 * Free / Cookie / Custom). Each shows a live count badge when > 0.
 * Right: sort <select> (Priority / Name / Connections).
 *
 * Pattern from Quota ProviderLimits toolbar: h-8 rounded-lg border chips,
 * active = border-primary/30 bg-primary/5 text-primary.
 */
const FILTER_CHIPS = [
  { value: "all", label: "All" },
  { value: "connected", label: "Connected" },
  { value: "errors", label: "Errors" },
  { value: "oauth", label: "OAuth" },
  { value: "apikey", label: "API Key" },
  { value: "free", label: "Free" },
  { value: "cookie", label: "Cookie" },
  { value: "custom", label: "Custom" },
];

const SORT_OPTIONS = [
  { value: "priority", label: "Priority" },
  { value: "name", label: "Name" },
  { value: "connections", label: "Connections" },
];

export default function ProviderToolbar({
  filter,
  onFilter,
  sortBy,
  onSort,
  counts = {},
  total,
  isSearching,
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_CHIPS.map((chip) => {
          // Don't render category chips with zero entries (unless searching,
          // where counts may not match the searched subset).
          const chipCount = counts[chip.value];
          const showCount =
            chipCount !== undefined &&
            chipCount !== total &&
            chip.value !== "all";
          if (!isSearching && chipCount === 0 && chip.value !== "all") return null;

          const isActive = filter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => onFilter(chip.value)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-primary/30 bg-primary/5 text-primary"
                  : "border-border bg-black/[0.02] text-text-primary hover:bg-surface-2 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10",
              )}
              aria-pressed={isActive}
            >
              {chip.label}
              {showCount && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "bg-black/5 text-text-muted dark:bg-white/10",
                  )}
                >
                  {chipCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sort control */}
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[16px] text-text-muted">
          sort
        </span>
        <select
          value={sortBy}
          onChange={(e) => onSort(e.target.value)}
          className="h-8 rounded-lg border border-border bg-black/[0.02] px-2 text-xs text-text-primary outline-none transition-colors hover:bg-surface-2 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10"
          aria-label="Sort providers"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
