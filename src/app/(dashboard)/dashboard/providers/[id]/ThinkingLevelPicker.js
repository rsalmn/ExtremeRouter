"use client";

import { useState, useRef, useEffect } from "react";

// ThinkingLevelPicker — per-model thinking level dropdown.
//
// Renders only for models that support reasoning (caps.reasoning === true).
// The selected level is appended as a parenthesized suffix to the model name
// when copied (e.g. "ds/deepseek-chat(high)"), which forces the reasoning
// effort at request time via parseSuffix() in thinkingUnified.js.
//
// This component does NOT persist anything to the DB — it's a pure UI aid
// that modifies the copy-to-clipboard text. State is local and ephemeral.
//
// Level options are derived from the model's capabilities:
//   - "auto" is always available (no suffix appended)
//   - "none" is available unless thinkingCanDisable is false
//   - minimal/low/medium/high/xhigh/max are available based on thinkingRange
const ALL_LEVELS = [
  { value: "auto", label: "Auto", hint: "No override" },
  { value: "none", label: "Off", hint: "Disable thinking" },
  { value: "minimal", label: "Minimal", hint: "512 tokens" },
  { value: "low", label: "Low", hint: "1,024 tokens" },
  { value: "medium", label: "Medium", hint: "8,192 tokens" },
  { value: "high", label: "High", hint: "24,576 tokens" },
  { value: "xhigh", label: "X-High", hint: "32,768 tokens" },
  { value: "max", label: "Max", hint: "128,000 tokens" },
];

export default function ThinkingLevelPicker({ caps, selectedLevel, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Build the option list based on model capabilities.
  const options = ALL_LEVELS.filter((opt) => {
    if (opt.value === "auto") return true;
    if (opt.value === "none") return caps?.thinkingCanDisable !== false;
    // For budget-based levels, respect thinkingRange if set (clamp).
    // Most models support all levels; the range is a soft clamp applied
    // downstream in applyThinking, so we show all options here.
    return true;
  });

  const current = options.find((o) => o.value === selectedLevel) || options[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Thinking: ${current.label}${current.hint ? ` (${current.hint})` : ""}`}
        className={`rounded p-0.5 transition-colors ${selectedLevel !== "auto" ? "text-primary" : "text-text-muted hover:bg-sidebar hover:text-primary"}`}
      >
        <span className="material-symbols-outlined text-sm">psychology</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-border bg-panel shadow-[var(--shadow-warm)]">
          <div className="px-2 py-1.5 border-b border-border-subtle">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Thinking Level</span>
          </div>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onSelect(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-sidebar ${
                opt.value === selectedLevel ? "text-primary font-semibold" : "text-text-main"
              }`}
            >
              <span>{opt.label}</span>
              <span className="text-[10px] text-text-muted">{opt.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
