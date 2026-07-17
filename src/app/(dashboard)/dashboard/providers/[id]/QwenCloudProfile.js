"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/shared/components";

// QwenCloudProfile — shows the connected QwenCloud user's name, email, avatar.
export default function QwenCloudProfile({ connectionId }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/providers/${connectionId}/qwencloud-profile`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setProfile(data);
      } catch { /* non-fatal */ }
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

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2/50 px-3 py-2">
      {profile.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.image} alt={profile.name} className="size-9 rounded-full object-cover ring-2 ring-border-subtle" />
      ) : (
        <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {profile.name?.charAt(0)?.toUpperCase() || "Q"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-text-main">{profile.name}</p>
          {profile.email && <span className="truncate text-xs text-text-muted">{profile.email}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          {profile.channelId && <Badge variant="info" size="sm">Region: {profile.channelId}</Badge>}
          {profile.uid && <span className="text-[11px] text-text-muted">UID: {profile.uid}</span>}
        </div>
      </div>
    </div>
  );
}
