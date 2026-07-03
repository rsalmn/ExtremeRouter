"use client";

import { cn } from "@/shared/utils/cn";

/**
 * Toolbar — sticky filter/action bar for console pages.
 * Use below PageHeader for search, filters, tabs.
 */
export default function Toolbar({ children, className }) {
  return (
    <div className={cn("mb-4 flex flex-col gap-2 rounded-brand border border-border-subtle bg-panel/60 p-2 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between", className)}>
      {children}
    </div>
  );
}

Toolbar.Group = function ToolbarGroup({ children, className }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
};

Toolbar.Search = function ToolbarSearch({ value, onChange, placeholder = "Search…", className }) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted">
        <span className="material-symbols-outlined text-[16px]">search</span>
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded bg-surface-2 pl-8 pr-7 text-xs text-text-main placeholder:text-text-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 sm:w-56"
      />
      {value && (
        <button
          onClick={() => onChange?.("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-main"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      )}
    </div>
  );
};
