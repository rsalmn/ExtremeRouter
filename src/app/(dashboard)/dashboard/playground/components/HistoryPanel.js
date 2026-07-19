"use client";

import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components";

function formatTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function HistoryPanel({ sessions, currentSession, onNew, onLoad, onDelete }) {
  const [query, setQuery] = useState("");
  // #20: re-render every 60s so relative timestamps ("5m ago") stay fresh
  // without requiring user interaction. Tick only drives re-render via deps.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title || "").toLowerCase().includes(q));
  }, [sessions, query]);

  return (
    <div className="flex flex-col gap-2 rounded-brand border border-border-subtle bg-panel p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">History</span>
        <Button size="sm" variant="ghost" icon="add" onClick={onNew} title="New chat" />
      </div>
      {sessions.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-2 px-2">
          <span className="material-symbols-outlined text-[14px] text-text-muted">search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="w-full bg-transparent py-1 text-xs text-text-main placeholder:text-text-muted focus:outline-none"
          />
        </div>
      )}
      {sessions.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">No saved conversations</p>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">No matches</p>
      ) : (
        <div className="custom-scrollbar flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
          {filtered.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                currentSession === s.id ? "bg-primary/10" : "hover:bg-surface-2"
              }`}
            >
              <button
                onClick={() => onLoad(s)}
                className="flex min-w-0 flex-1 flex-col items-start"
              >
                <span className="w-full truncate text-xs font-medium text-text-main">{s.title}</span>
                <span className="text-[10px] text-text-muted">{formatTime(s.updatedAt || s.createdAt)}</span>
              </button>
              <button
                onClick={() => onDelete(s.id)}
                className="rounded p-1 text-text-muted opacity-0 hover:text-danger group-hover:opacity-100"
                title="Delete"
              >
                <span className="material-symbols-outlined text-[14px]">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

HistoryPanel.propTypes = {
  sessions: PropTypes.array,
  currentSession: PropTypes.string,
  onNew: PropTypes.func.isRequired,
  onLoad: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};
