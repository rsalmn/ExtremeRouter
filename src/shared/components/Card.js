"use client";

import { cn } from "@/shared/utils/cn";

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  className,
  ...props
}) {
  const paddings = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-5",
    lg: "p-6",
  };

  return (
    <div
      className={cn(
        "bg-panel border border-border-subtle text-text-main",
        elev ? "rounded-panel shadow-[var(--shadow-elev)]" : "rounded-panel shadow-[var(--shadow-soft)]",
        hover && "hover:border-primary/35 hover:bg-panel-elev hover:shadow-[var(--shadow-warm)] transition-all cursor-pointer",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <div className="flex size-9 items-center justify-center rounded-brand bg-primary/10 text-primary ring-1 ring-primary/15">
                <span className="material-symbols-outlined text-[18px]">{icon}</span>
              </div>
            )}
            <div className="min-w-0">
              {title && <h3 className="truncate text-sm font-semibold tracking-tight text-text-main">{title}</h3>}
              {subtitle && <p className="mt-0.5 truncate text-xs text-text-muted">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-brand border border-border-subtle bg-surface-2 p-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "-mx-3 border-b border-border-subtle px-3 py-3 transition-colors last:border-b-0",
        "hover:bg-surface-2/70",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({ children, actions, className, ...props }) {
  return (
    <div
      className={cn(
        "group -mx-3 flex items-center justify-between border-b border-border-subtle px-3 py-3 transition-colors last:border-b-0",
        "hover:bg-surface-2/70",
        className
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">{actions}</div>}
    </div>
  );
};
