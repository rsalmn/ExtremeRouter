"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-primary hover:bg-primary-hover text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset,0_10px_30px_-18px_rgba(139,92,246,0.75)] disabled:bg-surface-3 disabled:text-text-muted",
  secondary: "bg-surface-2 hover:bg-surface-3 text-text-main border border-border disabled:opacity-50",
  outline: "border border-border text-text-main hover:bg-surface-2 hover:border-primary/45",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
  danger: "bg-danger hover:brightness-110 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
  success: "bg-success hover:brightness-110 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
};

const sizes = {
  sm: "h-7 px-3 text-xs rounded-brand",
  md: "h-9 px-4 text-sm rounded-brand",
  lg: "h-10 px-5 text-sm rounded-brand",
};

export default function Button({ children, variant = "primary", size = "md", icon, iconRight, disabled = false, loading = false, fullWidth = false, className, ...props }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 ease-out cursor-pointer",
        "active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[16px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && <span className="material-symbols-outlined text-[16px]">{iconRight}</span>}
    </button>
  );
}
