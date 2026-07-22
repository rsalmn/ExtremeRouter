"use client";

import { useState } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * Reusable collapsible section for the provider detail page.
 *
 * Pattern from Combos ComboCard: a Card with padding="none", a clickable
 * header row (icon + title + count + chevron), and a body that shows/hides.
 * The `actions` prop renders right-aligned buttons in the header (e.g. the
 * connections toolbar or models test-all).
 *
 * Unlike the old ProviderSection (chevron_right text rotate), this uses the
 * expand_more icon with rotate-180 on expand — cleaner and matches the Combos
 * page collapse affordance.
 */
export default function CollapsibleSection({
  title,
  icon,
  count,
  defaultExpanded = true,
  actions = null,
  children,
  className,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-panel border border-border-subtle bg-panel shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          {icon && (
            <span className="material-symbols-outlined text-[20px] text-text-muted">
              {icon}
            </span>
          )}
          <h2 className="truncate text-sm font-semibold text-text-main">
            {title}
          </h2>
          {count !== undefined && count !== null && (
            <span className="shrink-0 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text-muted dark:bg-white/10">
              {count}
            </span>
          )}
          <span
            className={cn(
              "material-symbols-outlined text-[18px] text-text-muted transition-transform",
              expanded && "rotate-180",
            )}
          >
            expand_more
          </span>
        </button>
        {actions && (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        )}
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-border-subtle">{children}</div>
      )}
    </div>
  );
}
