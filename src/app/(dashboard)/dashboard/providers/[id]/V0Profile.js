"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/shared/components";

// V0Profile — shows the connected v0.app user's profile + credit balance.
// Fetches from /api/providers/[id]/v0-profile on mount.
export default function V0Profile({ connectionId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/providers/${connectionId}/v0-profile`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // non-fatal
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [connectionId]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2/50 px-3 py-2">
        <div className="size-8 animate-pulse rounded-full bg-sidebar" />
        <div className="flex flex-col gap-1">
          <div className="h-3 w-32 animate-pulse rounded bg-sidebar" />
          <div className="h-2 w-48 animate-pulse rounded bg-sidebar" />
        </div>
      </div>
    );
  }

  if (!data?.profile && !data?.balance) return null;

  const { profile, balance } = data;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2/50 px-3 py-2">
      {/* Avatar */}
      {profile?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.image} alt={profile.name} className="size-9 rounded-full object-cover ring-2 ring-border-subtle" />
      ) : (
        <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {profile?.name?.charAt(0)?.toUpperCase() || "v"}
        </div>
      )}

      {/* Profile info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-text-main">{profile?.name || "User"}</p>
          {profile?.email && <span className="truncate text-xs text-text-muted">{profile.email}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          {profile?.plan && (
            <Badge variant={profile.plan === "v0-free" ? "default" : "primary"} size="sm">
              {profile.plan === "v0-free" ? "Free" : profile.plan}
            </Badge>
          )}
          {profile?.teamName && (
            <span className="truncate text-[11px] text-text-muted">{profile.teamName}</span>
          )}
        </div>
      </div>

      {/* Credits balance */}
      {balance && (
        <div className="flex shrink-0 flex-col items-end">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px] text-warning">bolt</span>
            <span className="font-mono text-sm font-bold text-text-main">{balance.remaining}</span>
            <span className="text-[10px] text-text-muted">/{balance.total || "?"}</span>
          </div>
          <span className="text-[10px] text-text-muted">credits left</span>
        </div>
      )}
    </div>
  );
}
