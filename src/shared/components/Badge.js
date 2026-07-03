"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  default: "bg-surface-2 text-text-muted ring-1 ring-border-subtle",
  primary: "bg-primary/12 text-primary ring-1 ring-primary/20",
  success: "bg-success/12 text-success ring-1 ring-success/20",
  warning: "bg-warning/12 text-warning ring-1 ring-warning/20",
  error: "bg-danger/12 text-danger ring-1 ring-danger/20",
  info: "bg-info/12 text-info ring-1 ring-info/20",
  cyan: "bg-cyan/12 text-cyan ring-1 ring-cyan/20",
};

const dotVariants = {
  default: "bg-text-subtle",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-danger",
  info: "bg-info",
  cyan: "bg-cyan",
};

const sizes = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
  lg: "px-3 py-1.5 text-sm",
};

export default function Badge({ children, variant = "default", size = "md", dot = false, icon, className }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full font-semibold leading-none", variants[variant], sizes[size], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", dotVariants[variant])} />}
      {icon && <span className="material-symbols-outlined text-[13px]">{icon}</span>}
      {children}
    </span>
  );
}
