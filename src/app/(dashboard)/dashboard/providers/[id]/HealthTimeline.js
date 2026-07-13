"use client";

import { useEffect, useState } from "react";

// HealthTimeline — SVG sparkline showing success/error ratio per hour for a
// provider. Each bar represents one hour; green = success %, red = error %.
// A dotted line traces avg latency (secondary axis).
//
// Polls every 60s while visible. Degrades gracefully to "No data" when empty.

const POLL_MS = 60_000;

export default function HealthTimeline({ providerId, hours = 24 }) {
  const [timeline, setTimeline] = useState(null);

  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;

    const fetchTimeline = async () => {
      try {
        const res = await fetch(`/api/providers/${providerId}/health-timeline?hours=${hours}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setTimeline(data.timeline || []);
      } catch {
        // non-fatal — keep last known
      }
    };

    fetchTimeline();
    const interval = setInterval(fetchTimeline, POLL_MS);

    const onVisibility = () => {
      if (document.hidden) clearInterval(interval);
      else { fetchTimeline(); setInterval(fetchTimeline, POLL_MS); }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [providerId, hours]);

  if (!timeline) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="material-symbols-outlined text-[14px] animate-pulse">monitor_heart</span>
        Loading health timeline...
      </div>
    );
  }

  if (timeline.length === 0 || timeline.every((b) => b.ok === 0 && b.err === 0)) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="material-symbols-outlined text-[14px]">monitor_heart</span>
        No request history yet.
      </div>
    );
  }

  // Build sparkline dimensions
  const barCount = timeline.length;
  const totalReqs = timeline.reduce((s, b) => s + b.ok + b.err, 0);
  const totalErr = timeline.reduce((s, b) => s + b.err, 0);
  const maxReqs = Math.max(...timeline.map((b) => b.ok + b.err), 1);
  const maxLatency = Math.max(...timeline.map((b) => b.latency), 1);

  const W = Math.max(barCount * 6, 120);
  const H = 32;
  const barW = Math.max(W / barCount - 1, 2);

  // Latency line points (normalized to H)
  const latPoints = timeline
    .filter((b) => b.latency > 0)
    .map((b, i) => {
      const x = (i / Math.max(barCount - 1, 1)) * W;
      const y = H - (b.latency / maxLatency) * (H * 0.6) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  const latPath = latPoints.length > 1 ? `M${latPoints.join(" L")}` : "";

  const successRate = totalReqs > 0 ? Math.round(((totalReqs - totalErr) / totalReqs) * 100) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-muted">Health (24h)</span>
          {successRate !== null && (
            <span className={`text-[10px] font-bold ${successRate >= 90 ? "text-success" : successRate >= 70 ? "text-warning" : "text-danger"}`}>
              {successRate}% success · {totalReqs} requests · {totalErr} errors
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm bg-success" /> OK
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm bg-danger" /> Error
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-info" /> Latency
          </span>
        </div>
      </div>
      <svg width={W} height={H} className="overflow-visible">
        {timeline.map((bucket, i) => {
          const x = i * (W / barCount);
          const reqs = bucket.ok + bucket.err;
          if (reqs === 0) return null;
          const okH = (bucket.ok / maxReqs) * H;
          const errH = (bucket.err / maxReqs) * H;
          return (
            <g key={i}>
              <rect x={x} y={H - okH - errH} width={barW} height={errH} rx={0.5} className="fill-danger/60" />
              <rect x={x} y={H - okH} width={barW} height={okH} rx={0.5} className="fill-success/60" />
            </g>
          );
        })}
        {latPath && <path d={latPath} fill="none" strokeWidth={1} className="stroke-info" strokeDasharray="2 2" />}
      </svg>
    </div>
  );
}
