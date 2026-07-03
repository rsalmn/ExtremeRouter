"use client";

import { cn } from "@/shared/utils/cn";
import Button from "./Button";

export default function EmptyState({
  icon = "inbox",
  title = "No items found",
  description = "There's nothing here yet.",
  action,
  actionText,
  onAction,
  className
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-panel border border-dashed border-border p-12 text-center", className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2 text-text-muted ring-1 ring-border-subtle">
        <span className="material-symbols-outlined text-[24px]">{icon}</span>
      </div>
      <h3 className="mb-1.5 text-sm font-semibold text-text-main">{title}</h3>
      <p className="mb-6 max-w-sm text-xs text-text-muted">{description}</p>
      {action || (actionText && onAction && (
        <Button variant="outline" size="sm" onClick={onAction}>
          {actionText}
        </Button>
      ))}
    </div>
  );
}
