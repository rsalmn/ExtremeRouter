"use client";

import { useEffect } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";
import Tooltip from "./Tooltip";

export default function Modal({ isOpen, onClose, title, children, footer, size = "md", closeOnOverlay = true, showTrafficLights = true, className }) {
  const sizes = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl", full: "max-w-3xl" };

  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => { if (e.key === "Escape" && isOpen) onClose(); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity" onClick={closeOnOverlay ? onClose : undefined} />

      {/* Modal content */}
      <div className={cn("relative w-full bg-surface border border-border-subtle rounded-panel shadow-[var(--shadow-elev)] transition-all", sizes[size], className)}>
        {/* Header */}
        {(title || showTrafficLights) && (
          <div className="border-b border-border-subtle px-5 py-3.5">
            <div className="flex items-center gap-3">
              {/* Traffic lights — desktop only */}
              {showTrafficLights && (
                <div className="hidden md:flex items-center gap-2 mr-3">
                  <Tooltip text="Close" position="top" color="#ef4444">
                    <button onClick={onClose} aria-label="Close" className="group w-2.5 h-2.5 rounded-full bg-[#ef4444] hover:brightness-90 transition-all flex items-center justify-center">
                      <span className="text-[7px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity leading-none">✕</span>
                    </button>
                  </Tooltip>
                  <div className="w-2.5 h-2.5 rounded-full bg-surface-2 border border-border cursor-not-allowed" />
                  <div className="w-2.5 h-2.5 rounded-full bg-surface-2 border border-border cursor-not-allowed" />
                </div>
              )}
              {title && <h2 className="text-sm font-semibold text-text-main">{title}</h2>}
            </div>
            {/* X button — mobile only */}
            <button onClick={onClose} aria-label="Close" className="md:hidden -mr-2 p-1.5 rounded text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="p-6 max-h-[85vh] overflow-y-auto custom-scrollbar">{children}</div>

        {/* Footer */}
        {footer && <div className="flex items-center justify-end gap-3 border-t border-border-subtle p-5">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title = "Confirm", message, confirmText = "Confirm", cancelText = "Cancel", variant = "danger", loading = false }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelText}</Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmText}</Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">{message}</p>
    </Modal>
  );
}
