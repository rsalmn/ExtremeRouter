"use client";

import { useState, useEffect } from "react";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// Fetch model capabilities once and expose a lookup by fullModel ("provider/model") or bare model id.
export function useModelCaps() {
  const [byFull, setByFull] = useState({});
  const [byId, setById] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/models");
        if (!res.ok) return;
        const data = await res.json();
        const full = {};
        const id = {};
        for (const m of data.models || []) {
          if (!m.caps) continue;
          if (m.fullModel) full[m.fullModel] = m.caps;
          if (m.model) id[m.model] = m.caps;
        }
        if (alive) { setByFull(full); setById(id); }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  // Resolve caps from a "provider/model" string or a bare model id.
  // Defensive: `key` may arrive as a non-string (e.g. when a model-picker slot
  // is still empty or a modal returned a non-string value). Coerce to string
  // so `.includes()`/`.slice()` don't throw "key.includes is not a function".
  const getCaps = (key) => {
    if (!key) return null;
    const k = typeof key === "string" ? key : String(key);
    if (byFull[k]) return byFull[k];
    const bare = k.includes("/") ? k.slice(k.indexOf("/") + 1) : k;
    if (byId[bare]) return byId[bare];
    // Fallback: compute caps for dynamic models (passthrough/custom/suggested) not in static list
    const provider = k.includes("/") ? k.slice(0, k.indexOf("/")) : null;
    const c = getCapabilitiesForModel(provider, bare);
    return { vision: c.vision, search: c.search, reasoning: c.reasoning };
  };

  return { getCaps };
}
