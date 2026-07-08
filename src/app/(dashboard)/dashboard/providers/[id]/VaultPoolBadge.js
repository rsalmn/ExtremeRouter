"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/shared/components";

// VaultPoolBadge — shows aggregate stats for a provider's admin-provided key
// pool. Renders nothing if the provider has no pool (hasPool: false) so it's
// safe to mount unconditionally for every provider detail page.
//
// Polls /api/providers/[id]/vault-pool every 10s so the rate-limited count
// updates live as keys cool down. Polling pauses when the tab is hidden.
//
// Security contract: the API only ever returns counts — never key names or
// blobs — so this component can never leak credential material.
const POLL_INTERVAL_MS = 10_000;

const STATUS_META = {
  healthy: { variant: "success", label: "Pool healthy", icon: "shield" },
  degraded: { variant: "warning", label: "Pool degraded", icon: "warning" },
  exhausted: { variant: "error", label: "Pool exhausted", icon: "error" },
};

export default function VaultPoolBadge({ providerId }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/providers/${providerId}/vault-pool`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStats(data);
      } catch {
        // Network errors are non-fatal — keep the last known state.
      }
    };

    fetchStats();

    // Pause polling when the tab is hidden to avoid useless background traffic.
    let interval;
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(fetchStats, POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    const onVisibility = () => (document.hidden ? stopPolling() : startPolling());

    startPolling();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [providerId]);

  // No pool, or stats not yet loaded → render nothing.
  if (!stats || !stats.hasPool) return null;

  const meta = STATUS_META[stats.status] || STATUS_META.healthy;

  return (
    <div className="flex flex-wrap items-center gap-1.5" title="Admin-provided shared key pool. Keys are hidden; only counts are shown.">
      <Badge variant={meta.variant} size="sm" icon={meta.icon}>
        {meta.label}
      </Badge>
      <Badge variant="info" size="sm" icon="key">
        {stats.total} pool keys
      </Badge>
      <Badge variant="success" size="sm" icon="check_circle">
        {stats.available} available
      </Badge>
      {stats.rateLimited > 0 && (
        <Badge variant="warning" size="sm" icon="schedule">
          {stats.rateLimited} cooling
        </Badge>
      )}
    </div>
  );
}
