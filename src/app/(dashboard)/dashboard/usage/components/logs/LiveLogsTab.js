"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, SegmentedControl, Input, Badge, EmptyState } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const MAX_BUFFER = 100;
const STATUS_OPTIONS = [
  { value: "all", label: "All", icon: "subject" },
  { value: "ok", label: "OK", icon: "check_circle" },
  { value: "errors", label: "Errors", icon: "error" },
];

const nf = new Intl.NumberFormat();
const fmt = (n) => nf.format(n || 0);

/** Relative time from an ISO timestamp. */
function timeAgo(iso, now) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = now - t;
  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(t).toLocaleTimeString();
}

const rowKey = (r) => `${r.timestamp ?? ""}|${r.model ?? ""}|${r.provider ?? ""}`;
const isOk = (s) => !s || s === "ok";

export default function LiveLogsTab() {
  const [buffer, setBuffer] = useState([]);
  const [connected, setConnected] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // SSE connection — mirrors the HealthMonitor live-indicator pattern.
  // NOTE: /api/usage/stream emits unnamed `data:` events (the full stats
  // object on every update), so we listen via onmessage rather than a named
  // "update" event listener.
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (event) => {
      try {
        const stats = JSON.parse(event.data);
        const incoming = Array.isArray(stats.recentRequests) ? stats.recentRequests : [];
        if (incoming.length === 0) return;

        setBuffer((prev) => {
          const existing = new Set(prev.map(rowKey));
          const additions = incoming.filter((r) => !existing.has(rowKey(r)));
          if (additions.length === 0) return prev;
          // Merge, keep newest-first, cap the rolling buffer.
          const merged = [...additions, ...prev]
            .sort(
              (a, b) =>
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            )
            .slice(0, MAX_BUFFER);
          return merged;
        });
      } catch {
        // ignore malformed payloads
      }
    };

    return () => es.close();
  }, []);

  // Single 1s ticker re-renders the whole list so relative timestamps stay
  // fresh (no per-row timers).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return buffer.filter((r) => {
      if (statusFilter === "ok" && !isOk(r.status)) return false;
      if (statusFilter === "errors" && isOk(r.status)) return false;
      if (q) {
        const hay = `${r.model ?? ""} ${r.provider ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [buffer, statusFilter, query]);

  const liveColor = connected ? "bg-success animate-pulse" : "bg-warning";
  const liveLabel = connected ? "Live" : "Reconnecting";
  const liveText = connected ? "text-success" : "text-warning";

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <Card padding="sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className={cn("size-2 rounded-full", liveColor)} />
            <span className={cn("font-semibold", liveText)}>{liveLabel}</span>
            <span className="text-xs text-text-muted">
              · {buffer.length}/{MAX_BUFFER} buffered
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SegmentedControl
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={setStatusFilter}
              size="sm"
            />
            <Input
              icon="search"
              placeholder="Filter by model or provider"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="sm:w-64"
            />
          </div>
        </div>
      </Card>

      {/* List */}
      <Card padding="none" className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={buffer.length === 0 ? "history" : "search_off"}
              title={buffer.length === 0 ? "No requests yet" : "No matching requests"}
              description={
                buffer.length === 0
                  ? "Live requests will appear here."
                  : "Try adjusting your filters or search."
              }
            />
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            {/* Column header */}
            <div className="sticky top-0 z-10 grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 border-b border-border-subtle bg-panel/95 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle backdrop-blur sm:grid-cols-[4.5rem_1fr_6rem_6rem_5rem_1.25rem]">
              <span>When</span>
              <span>Model</span>
              <span className="hidden text-right sm:block">In</span>
              <span className="hidden text-right sm:block">Out</span>
              <span className="hidden sm:block">Cache</span>
              <span className="text-right" aria-hidden />
            </div>

            <ul role="list" className="divide-y divide-border-subtle">
              {filtered.map((r) => {
                const ok = isOk(r.status);
                const cached = (r.cachedTokens ?? 0) > 0;
                return (
                  <li
                    key={rowKey(r)}
                    className="fade-in grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/70 sm:grid-cols-[4.5rem_1fr_6rem_6rem_5rem_1.25rem]"
                  >
                    {/* When */}
                    <span
                      className="truncate font-mono text-xs text-text-muted tabular-nums"
                      title={r.timestamp ? new Date(r.timestamp).toLocaleString() : undefined}
                    >
                      {timeAgo(r.timestamp, now)}
                    </span>

                    {/* Model + provider */}
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-main" title={r.model}>
                        {r.model || "—"}
                      </span>
                      {r.provider && (
                        <Badge variant="default" size="sm" className="hidden shrink-0 sm:inline-flex">
                          {r.provider}
                        </Badge>
                      )}
                    </div>

                    {/* In */}
                    <span className="hidden text-right font-mono text-xs text-primary tabular-nums sm:block">
                      ↑ {fmt(r.promptTokens)}
                    </span>
                    {/* Out */}
                    <span className="hidden text-right font-mono text-xs text-success tabular-nums sm:block">
                      ↓ {fmt(r.completionTokens)}
                    </span>
                    {/* Cache */}
                    <span className="hidden sm:block">
                      {cached ? (
                        <Badge variant="cyan" size="sm">
                          cached
                        </Badge>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </span>

                    {/* Status dot */}
                    <span className="flex justify-end">
                      <span
                        className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-danger")}
                        role="img"
                        aria-label={ok ? "OK" : "Error"}
                        title={ok ? "OK" : r.status || "Error"}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
