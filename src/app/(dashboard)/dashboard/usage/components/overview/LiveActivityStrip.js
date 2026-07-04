"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { fmtTime } from "./format";

// A single shared 30s tick so all chips re-render their relative time together
// instead of every chip spinning its own setInterval (the old per-row-timer bug).
function useSharedTick(intervalMs = 30000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

function ActivityChip({ req }) {
  const ok = !req.status || req.status === "ok" || req.status === "success";
  const model = req.model || "unknown";
  const provider = req.provider || "—";
  const inTok = Number(req.promptTokens) || 0;
  const outTok = Number(req.completionTokens) || 0;

  return (
    <div className="flex shrink-0 flex-col gap-1 rounded-brand border border-border-subtle bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span
          className={`size-1.5 shrink-0 rounded-full ${ok ? "bg-success" : "bg-danger"}`}
          title={ok ? "OK" : "Error"}
        />
        <span className="max-w-[140px] truncate font-mono text-xs font-medium text-text-main" title={model}>
          {model}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <Badge variant="default" size="sm" className="!px-1.5">
          {provider}
        </Badge>
      </div>
      <div className="flex items-center gap-2 font-mono text-[11px]">
        <span className="text-primary">{inTok.toLocaleString()}↑</span>
        <span className="text-success">{outTok.toLocaleString()}↓</span>
        <span className="ml-auto whitespace-nowrap text-text-muted">
          {fmtTime(req.timestamp)}
        </span>
      </div>
    </div>
  );
}

ActivityChip.propTypes = {
  req: PropTypes.shape({
    status: PropTypes.string,
    model: PropTypes.string,
    provider: PropTypes.string,
    promptTokens: PropTypes.number,
    completionTokens: PropTypes.number,
    timestamp: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }).isRequired,
};

export default function LiveActivityStrip({ stats }) {
  useSharedTick();

  const active = stats?.activeRequests || [];
  const recent = (stats?.recentRequests || []).slice(0, 10);
  // "N active" — prefer summed counts, fall back to distinct entries.
  const activeCount = active.reduce((sum, r) => sum + (Number(r.count) || 1), 0) || active.length;

  return (
    <Card padding="sm" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2.5">
          {activeCount > 0 && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
          )}
          <span
            className={`relative inline-flex size-2.5 rounded-full ${activeCount > 0 ? "bg-success" : "bg-text-subtle"}`}
          />
        </span>
        <span className="text-sm font-semibold text-text-main">
          {activeCount > 0 ? `${activeCount} active` : "No active requests"}
        </span>
        <span className="text-xs text-text-muted">· recent activity</span>
      </div>

      {recent.length === 0 ? (
        <div className="flex items-center justify-center py-3 text-sm text-text-muted">
          No recent activity
        </div>
      ) : (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {recent.map((req, i) => (
            <ActivityChip key={`${req.timestamp}-${i}`} req={req} />
          ))}
        </div>
      )}
    </Card>
  );
}

LiveActivityStrip.propTypes = {
  stats: PropTypes.object,
};
