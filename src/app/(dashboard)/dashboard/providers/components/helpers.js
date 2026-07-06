"use client";

import { Badge } from "@/shared/components";

// ─── Status display ──────────────────────────────────────────────────────────

export function getStatusDisplay(connected, error, errorCode) {
  const parts = [];
  if (connected > 0) {
    parts.push(
      <Badge key="connected" variant="success" size="sm" dot>
        {connected} Connected
      </Badge>,
    );
  }
  if (error > 0) {
    const errText = errorCode ? `${error} Error (${errorCode})` : `${error} Error`;
    parts.push(
      <Badge key="error" variant="error" size="sm" dot>
        {errText}
      </Badge>,
    );
  }
  if (parts.length === 0) return null;
  return <div className="flex items-center gap-1.5 text-xs flex-wrap">{parts}</div>;
}

export function getConnectionErrorTag(connection) {
  const isCooldown = Object.entries(connection).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now(),
  );
  if (isCooldown) return "COOLDOWN";
  return connection.errorCode || null;
}

// ─── Provider stats ──────────────────────────────────────────────────────────

export function makeGetProviderStats(connections) {
  return (providerId, authType) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const providerConnections = connections.filter(
      (c) => c.provider === providerId && authTypes.includes(c.authType),
    );

    const getEffectiveStatus = (conn) => {
      const isCooldown = Object.entries(conn).some(
        ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now(),
      );
      return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
    };

    const connected = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return status === "active" || status === "success";
    }).length;

    const errorConnections = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return status === "error" || status === "failed";
    });

    const error = errorConnections.length;
    const latestError = errorConnections[0];
    const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
    const errorTime = latestError?.lastErrorAt
      ? getRelativeTime(latestError.lastErrorAt)
      : null;
    const allDisabled = providerConnections.length > 0 && providerConnections.every((c) => c.isActive === false);

    return { connected, error, total: providerConnections.length, errorCode, errorTime, allDisabled };
  };
}

function getRelativeTime(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

// ─── Search ──────────────────────────────────────────────────────────────────

export function makeMatchSearch(searchQuery) {
  const q = searchQuery.trim().toLowerCase();
  return (name, id = "", alias = "") => {
    if (!q) return true;
    return (
      name.toLowerCase().includes(q) ||
      id.toLowerCase().includes(q) ||
      alias.toLowerCase().includes(q)
    );
  };
}

// ─── Resolve authType for stats/toggle ──────────────────────────────────────
// Providers like windsurf/trae/cody have category "oauth" but hasOAuth:false —
// their connections persist as authType "apikey". This returns the correct
// authType for stats/toggle queries.
export function resolveStatsAuthType(providerInfo, defaultAuthType) {
  if (providerInfo?.hasOAuth === false) return "apikey";
  return defaultAuthType;
}

// ─── Sort by priority (connected first, then alpha) ──────────────────────────

export function makeSortByPriority(getProviderStats) {
  return (entries, authType) =>
    [...entries].sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const sa = getProviderStats(ka, authType);
      const sb = getProviderStats(kb, authType);
      const ca = sa.total > 0 ? 0 : 1;
      const cb = sb.total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
}
