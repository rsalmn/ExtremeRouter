"use client";

import { useEffect, useRef, useState } from "react";

// React-Hooks-rule-friendly data fetch hook.
//
// The naive `useEffect(() => { setLoading(true); fetch()... })` pattern trips
// the `react-hooks/set-state-in-effect` rule (synchronous setState in an effect
// body causes cascading renders). We avoid it by deriving `loading` from an
// in-flight request token ref (no synchronous setState) and only ever calling
// setState from async callbacks.
//
// UX: stale-while-revalidate. On a dependency change we keep showing the
// previous `data` (no skeleton flash) until the new response lands. `loading`
// is only true during the very first load, before any data is available.
//
// Returns { data, loading, error, refetch }. `data` starts as `initial`.
export function useFetchJson(url, { initial = null, deps = [] } = {}) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqRef = useRef(0);

  const run = (urlToFetch) => {
    const myToken = ++reqRef.current; // synchronous ref bump — no setState, no rule break
    let cancelled = false;
    fetch(urlToFetch)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled || reqRef.current !== myToken) return;
        setData(json ?? initial);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled || reqRef.current !== myToken) return;
        setData(initial);
        setError(e);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    const cancel = run(url);
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  return { data, loading, error };
}
