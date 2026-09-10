"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Resolve arbitrary model-reference strings (combo members) to canonical
 * provider + compact capabilities via POST /api/models/refs.
 *
 * /api/models is keyed by the STATIC catalog's "alias/model" fullModel, so
 * bare ids, lane-aliased refs and dynamic-provider models never match it
 * client-side. This hook asks the server (single source of truth) to resolve
 * the exact strings as stored.
 *
 * @param {string[]} refs - model reference strings (deduped client-side)
 * @returns {{ capsByRef: object, providerByRef: object, loading: boolean }}
 */
export function useModelRefs(refs) {
  const key = useMemo(() => [...new Set((refs || []).filter((r) => typeof r === "string" && r.trim()))].sort().join("\n"), [refs]);
  const [data, setData] = useState({});

  useEffect(() => {
    if (!key) { setData({}); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/models/refs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refs: key.split("\n") }),
        });
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setData(json.refs || {});
      } catch { /* ignore — badges/icons simply stay hidden */ }
    })();
    return () => { alive = false; };
  }, [key]);

  const capsByRef = useMemo(() => {
    const out = {};
    for (const [ref, r] of Object.entries(data)) if (r?.caps) out[ref] = r.caps;
    return out;
  }, [data]);
  const providerByRef = useMemo(() => {
    const out = {};
    for (const [ref, r] of Object.entries(data)) if (r?.provider) out[ref] = r.provider;
    return out;
  }, [data]);

  return { capsByRef, providerByRef, loading: Boolean(key) && Object.keys(data).length === 0 };
}
