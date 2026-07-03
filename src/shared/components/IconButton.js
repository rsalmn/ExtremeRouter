"use client";

import { cn } from "@/shared/utils/cn";
import Tooltip from "./Tooltip";

export default function IconButton({
  icon,
  onClick,
  tooltip,
  variant = "ghost",
  size = "md",
  disabled,
  loading,
  className,
  ...props
}) {
  const variants = {
    ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
    primary: "text-primary hover:bg-primary/10",
    danger: "text-danger hover:bg-danger/10",
    outline: "border border-border text-text-muted hover:border-primary/45 hover:bg-surface-2 hover:text-text-main",
  };

  const sizes = {
    sm: "size-6 rounded text-[14px]",
    md: "size-8 rounded-md text-[16px]",
    lg: "size-10 rounded-lg text-[20px]",
  };

  const btn = (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={tooltip || icon}
      className={cn(
        "flex shrink-0 items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      <span className={cn("material-symbols-outlined", loading && "animate-spin")}>
        {loading ? "progress_activity" : icon}
      </span>
    </button>
  );

  if (tooltip) {
    return <Tooltip text={tooltip} position="top">{btn}</Tooltip>;
  }

  return btn;
}
