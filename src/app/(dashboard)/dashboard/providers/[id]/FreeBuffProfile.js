"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/shared/components";

// FreeBuffProfile — shows the connected FreeBuff user's name, email, avatar,
// and session expiry. Fetches from /api/providers/[id]/freebuff-profile on mount.
export default function FreeBuffProfile({ connectionId }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/providers/${connectionId}/freebuff-profile`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setProfile(data);
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

  if (!profile) return null;

  // Parse expiry for display
  const expiryDate = profile.expires ? new Date(profile.expires) : null;
  const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const isExpiringSoon = daysLeft !== null && daysLeft <= 3;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2/50 px-3 py-2">
      {/* Avatar */}
      {profile.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.image}
          alt={profile.name}
          className="size-9 rounded-full object-cover ring-2 ring-border-subtle"
        />
      ) : (
        <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {profile.name?.charAt(0)?.toUpperCase() || "F"}
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-text-main">{profile.name}</p>
          {profile.email && (
            <span className="truncate text-xs text-text-muted">{profile.email}</span>
          )}
        </div>
        {expiryDate && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[12px] text-text-muted">schedule</span>
            <span className="text-[11px] text-text-muted">
              Session expires {expiryDate.toLocaleDateString()}
            </span>
            {daysLeft !== null && (
              <Badge variant={isExpiringSoon ? "warning" : "success"} size="sm">
                {daysLeft}d left
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
