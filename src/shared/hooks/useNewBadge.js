"use client";

import { useState, useCallback, useEffect } from "react";

// useNewBadge — per-install "first seen" tracking via localStorage.
//
// Tracks which items (providers, pages) the user has interacted with. An item
// is "new" if it has NOT been marked seen yet, OR was seen more than
// BADGE_TTL_DAYS ago (so the badge can re-appear if the user hasn't engaged
// in a while — prevents permanent-but-ignored badges).
//
// Pattern: localStorage["seen:{scope}"] = { itemId: ISO-timestamp }
// Scope examples: "providers", "features" (sidebar pages).
//
// Self-contained: no DB, no API, no schema change. Self-healing on browser
// data clear. SSR-safe (reads only in useEffect).

const BADGE_TTL_DAYS = 14;
const BADGE_TTL_MS = BADGE_TTL_DAYS * 24 * 60 * 60 * 1000;

function storageKey(scope) {
  return `seen:${scope}`;
}

function readSeen(scope) {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeSeen(scope, map) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(map));
  } catch {
    // quota / private mode — non-fatal, badges just won't persist
  }
}

/**
 * Check if an item is "new" (unseen or seen > TTL ago).
 * Pure function — no React deps. Safe to call in render.
 */
export function isNew(scope, id) {
  const seen = readSeen(scope);
  const ts = seen[id];
  if (!ts) return true; // never seen → new
  // Expire: if seen > TTL ago, re-badge (user hasn't engaged recently)
  // But once seen, we DON'T expire — the badge is "you haven't opened this yet"
  // and stays until opened. TTL is a safety net for abandoned items.
  // Disabled for now: once seen = not new (simplest UX).
  return false;
}

/**
 * React hook for batch checking new status across many items.
 * Returns { isNew(id), markSeen(id), markAllSeen(ids) }.
 * Re-renders when state changes.
 */
export function useNewBadge(scope) {
  const [seenMap, setSeenMap] = useState({});

  // Load on mount (client-side only)
  useEffect(() => {
    setSeenMap(readSeen(scope));
  }, [scope]);

  const checkIsNew = useCallback(
    (id) => {
      return !seenMap[id];
    },
    [seenMap],
  );

  const markSeen = useCallback(
    (id) => {
      setSeenMap((prev) => {
        if (prev[id]) return prev; // already seen, no-op
        const next = { ...prev, [id]: new Date().toISOString() };
        writeSeen(scope, next);
        return next;
      });
    },
    [scope],
  );

  const markAllSeen = useCallback(
    (ids) => {
      setSeenMap((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of ids) {
          if (!next[id]) {
            next[id] = new Date().toISOString();
            changed = true;
          }
        }
        if (changed) writeSeen(scope, next);
        return changed ? next : prev;
      });
    },
    [scope],
  );

  return { isNew: checkIsNew, markSeen, markAllSeen };
}
