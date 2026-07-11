"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/shared/components";

// ZenmuxPlanSelector — dropdown for selecting the user's ZenMux subscription
// plan. Renders only for the zenmux-free provider.
//
// AUTO-DETECT: On mount, the component calls POST /api/providers/zenmux-free/
// zenmux-plans with the ctoken extracted from the connection's cookie. If the
// auto-detection succeeds, the detected plan is shown as a badge and the
// dropdown pre-selects it. The user can still override via the dropdown.
//
// MANUAL OVERRIDE: The selected plan is persisted as
// providerSpecificData.zenmuxPlan on the connection record. The live model
// resolver prefers the auto-detected plan, but falls back to this manual
// value when auto-detection fails.
export default function ZenmuxPlanSelector({ connectionId, cookie, currentPlan = "free", onPlanChanged }) {
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(currentPlan);
  const [detectedPlan, setDetectedPlan] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Extract ctoken from the cookie string for auto-detection.
  const ctoken = (() => {
    const m = String(cookie || "").match(/ctoken=([^;]+)/);
    return m?.[1] || "";
  })();

  // Fetch the plan list from the ZenMux public API (via our server-side cache).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/providers/zenmux-free/zenmux-plans`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.plans)) {
          setPlans(data.plans);
        }
      } catch {
        // Non-fatal — dropdown will just be empty.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-detect the user's plan from their ctoken.
  useEffect(() => {
    if (!ctoken) return;
    let cancelled = false;
    setDetecting(true);
    (async () => {
      try {
        const res = await fetch(`/api/providers/zenmux-free/zenmux-plans`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ctoken }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.planKey) {
          setDetectedPlan(data.planKey);
          // Pre-select the detected plan if user hasn't manually set one.
          if (!currentPlan || currentPlan === "free") {
            setSelectedPlan(data.planKey);
          }
        }
      } catch {
        // Non-fatal — user can still select manually.
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ctoken, currentPlan]);

  const handleChange = async (e) => {
    const planKey = e.target.value;
    setSelectedPlan(planKey);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${connectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerSpecificData: { zenmuxPlan: planKey } }),
      });
      if (!res.ok) throw new Error("Failed to save plan");
      onPlanChanged?.(planKey);
    } catch (err) {
      setError(err.message);
      setSelectedPlan(currentPlan);
    } finally {
      setSaving(false);
    }
  };

  const isAutoDetected = detectedPlan && detectedPlan === selectedPlan;

  if (plans.length === 0) {
    // Still loading or API unavailable — show a minimal placeholder.
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted font-medium">ZenMux Plan</span>
        <select
          value={selectedPlan}
          onChange={handleChange}
          disabled
          className="appearance-none rounded-brand border border-border bg-surface-2 py-1.5 pl-3 pr-8 text-xs text-text-muted [-webkit-appearance:none] [-moz-appearance:none]"
        >
          <option value={selectedPlan}>{selectedPlan} (loading…)</option>
        </select>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-muted font-medium">ZenMux Plan</span>
        <div className="relative">
          <select
            value={selectedPlan}
            onChange={handleChange}
            disabled={saving}
            title="Select your ZenMux subscription plan. Models from this plan will be available."
            className="appearance-none rounded-brand border border-border bg-surface-2 py-1.5 pl-3 pr-8 text-xs text-text-main [-webkit-appearance:none] [-moz-appearance:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-50"
          >
            {plans.map((p) => (
              <option key={p.planKey} value={p.planKey}>
                {p.name} ({p.modelCount} models{p.price > 0 ? `, $${p.price}/mo` : ", free"})
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-text-muted">
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
          </span>
        </div>
        {detecting && <Badge variant="info" size="sm">Detecting…</Badge>}
        {isAutoDetected && !detecting && (
          <Badge variant="success" size="sm" icon="check_circle" dot>
            Auto-detected
          </Badge>
        )}
        {saving && <Badge variant="info" size="sm">Saving…</Badge>}
        {error && <Badge variant="error" size="sm" icon="error">{error}</Badge>}
      </div>
      <p className="text-[11px] text-text-muted">
        {detectedPlan
          ? `Plan auto-detected from your ctoken: ${detectedPlan}. You can override manually if needed.`
          : "Select your ZenMux subscription plan. Models available depend on your plan."}
      </p>
    </div>
  );
}
