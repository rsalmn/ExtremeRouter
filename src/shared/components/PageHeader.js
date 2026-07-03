"use client";

import { cn } from "@/shared/utils/cn";

/**
 * PageHeader — enterprise console page header.
 * Use as the first child of every redesigned page.
 */
export default function PageHeader({ title, description, icon, iconNode, actions, breadcrumbs, className }) {
  return (
    <div className={cn("mb-6", className)}>
      {breadcrumbs?.length > 0 && (
        <nav className="mb-2 flex items-center gap-1.5 text-xs text-text-muted">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="material-symbols-outlined text-[12px] opacity-60">chevron_right</span>}
              {crumb.href ? (
                <a href={crumb.href} className="transition-colors hover:text-primary">{crumb.label}</a>
              ) : (
                <span className="font-medium text-text-main">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {iconNode ? (
            <div className="mt-0.5 shrink-0">{iconNode}</div>
          ) : icon && (
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-brand bg-primary/10 text-primary ring-1 ring-primary/15">
              <span className="material-symbols-outlined text-[18px]">{icon}</span>
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-text-main">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
