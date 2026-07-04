"use client";

import { useState, useEffect } from "react";
import Badge from "@/shared/components/Badge";
import EmptyState from "@/shared/components/EmptyState";
import { cn } from "@/shared/utils/cn";

function healthTier(successRate, total) {
  if (total === 0) return { label: "Unknown", variant: "default", color: "text-text-subtle", bar: "bg-text-subtle" };
  const rate = successRate ?? 0;
  if (rate >= 0.95) return { label: "Healthy", variant: "success", color: "text-success", bar: "bg-success" };
  if (rate >= 0.8) return { label: "Degraded", variant: "warning", color: "text-warning", bar: "bg-warning" };
  return { label: "Unhealthy", variant: "error", color: "text-danger", bar: "bg-danger" };
}

function formatLatency(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimeAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

export default function HealthMonitor() {
  const [providers, setProviders] = useState([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/health/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "snapshot" && Array.isArray(data.providers)) {
          setProviders(data.providers);
        } else if (data.provider) {
          // Per-provider update: merge into state
          setProviders((prev) => {
            const idx = prev.findIndex((p) => p.provider === data.provider);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = data;
              return next;
            }
            return [...prev, data];
          });
        }
      } catch {
        // ignore
      }
    };

    return () => es.close();
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <span className={cn("size-2 rounded-full", connected ? "bg-success animate-pulse" : "bg-danger")} />
          {connected ? "Live" : "Reconnecting…"}
        </div>
        {providers.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-success" /> Healthy</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-warning" /> Degraded</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-danger" /> Unhealthy</span>
          </div>
        )}
      </div>

      {providers.length === 0 ? (
        <EmptyState
          icon="monitor_heart"
          title="No health data yet"
          description="Provider health metrics will appear here once requests flow through the gateway. Send a request to any provider to start collecting samples."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => {
            const tier = healthTier(p.successRate, p.total);
            const successPct = p.successRate != null ? Math.round(p.successRate * 100) : null;
            return (
              <div key={p.provider} className="rounded-panel border border-border-subtle bg-panel p-4 shadow-[var(--shadow-soft)]">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="truncate font-mono text-sm font-semibold capitalize text-text-main">{p.provider}</h3>
                  <Badge variant={tier.variant} dot size="sm">{tier.label}</Badge>
                </div>

                {/* Success rate bar */}
                {successPct != null && (
                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
                      <span>Success rate</span>
                      <span className={cn("font-mono font-semibold", tier.color)}>{successPct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className={cn("h-full rounded-full transition-all", tier.bar)} style={{ width: `${successPct}%` }} />
                    </div>
                  </div>
                )}

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-surface-2 p-2">
                    <div className="text-text-subtle">Requests</div>
                    <div className="font-mono font-semibold text-text-main">{p.total}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-2">
                    <div className="text-text-subtle">Failures</div>
                    <div className={cn("font-mono font-semibold", p.failures > 0 ? "text-danger" : "text-text-main")}>{p.failures}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-2">
                    <div className="text-text-subtle">Avg latency</div>
                    <div className="font-mono font-semibold text-text-main">{formatLatency(p.avgLatencyMs)}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-2">
                    <div className="text-text-subtle">p95 latency</div>
                    <div className="font-mono font-semibold text-text-main">{formatLatency(p.p95LatencyMs)}</div>
                  </div>
                </div>

                {p.lastError && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
                    <span className="material-symbols-outlined text-[13px] text-danger">error</span>
                    Last error: <span className="font-mono">{p.lastError}</span> · {formatTimeAgo(p.lastErrorAt)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
