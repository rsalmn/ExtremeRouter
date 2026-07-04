"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";

// Hardcoded donation channels — QR codes generated via goqr.me API.
// No remote fetch needed, so this works offline and never 404s.
const CHANNELS = [
  {
    id: "paypal",
    label: "PayPal",
    description: "paypal.me/XYOURZONE",
    icon: "account_balance_wallet",
    color: "#0070BA",
    url: "https://paypal.me/XYOURZONE",
    qr: "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://paypal.me/XYOURZONE",
  },
  {
    id: "kofi",
    label: "Ko-fi",
    description: "ko-fi.com/rsalman",
    icon: "coffee",
    color: "#FF5E5B",
    url: "https://ko-fi.com/rsalman",
    qr: "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://ko-fi.com/rsalman",
  },
  {
    id: "saweria",
    label: "Saweria (APAC)",
    description: "saweria.co/rsalman",
    icon: "savings",
    color: "#6E45E2",
    url: "https://saweria.co/rsalman",
    qr: "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://saweria.co/rsalman",
  },
];

export default function DonateModal({ isOpen, onClose }) {
  const modalRef = useRef(null);

  // Close on Escape key.
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  // Close on click outside the modal card.
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={modalRef}
        className="relative w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-main">
            <span className="material-symbols-outlined text-pink-500">volunteer_activism</span>
            Support ExtremeRouter
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <p className="mx-auto mb-6 max-w-md text-center text-sm text-text-muted">
            ExtremeRouter is free and open source. If it saves you time or money,
            consider buying me a coffee — every bit keeps development going. 💜
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {CHANNELS.map((ch) => (
              <DonateChannelCard key={ch.id} channel={ch} />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DonateChannelCard({ channel }) {
  const { label, description, icon, color, url, qr } = channel;
  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-surface-2 p-4 text-center transition-colors hover:border-primary/40">
      <div
        className="mb-3 flex size-12 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}20`, color }}
      >
        <span className="material-symbols-outlined text-[26px]">{icon}</span>
      </div>
      <div className="mb-1 font-semibold text-text-main">{label}</div>
      {description && (
        <div className="mb-3 text-xs text-text-muted">{description}</div>
      )}
      {qr && (
        <img
          src={qr}
          alt={`${label} QR code`}
          loading="lazy"
          className="mb-3 aspect-square w-full max-w-[180px] rounded-lg bg-white p-1"
        />
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: color }}
        >
          Open
          <span className="material-symbols-outlined text-[16px]">open_in_new</span>
        </a>
      )}
    </div>
  );
}

DonateModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
