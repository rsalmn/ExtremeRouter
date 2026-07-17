"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import Card from "./Card";
import Select from "./Select";
import Badge from "./Badge";

const NONE_PROXY_POOL_VALUE = "__none__";

const ROTATE_OPTIONS = [
  { value: "none", label: "None (single pool)" },
  { value: "round-robin", label: "Round Robin — cycle through all pools" },
  { value: "random", label: "Random — pick a random pool each request" },
];

export default function NoAuthProxyCard({ providerId }) {
  const [proxyPools, setProxyPools] = useState([]);
  const [proxyPoolId, setProxyPoolId] = useState(NONE_PROXY_POOL_VALUE);
  const [rotateStrategy, setRotateStrategy] = useState("none");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }).then((r) => r.ok ? r.json() : { proxyPools: [] }),
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}),
    ]).then(([poolData, settingsData]) => {
      if (cancelled) return;
      setProxyPools(poolData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProxyPoolId(override.proxyPoolId || NONE_PROXY_POOL_VALUE);
      setRotateStrategy(override.rotateStrategy || "none");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [providerId]);

  const patchSettings = async (patch) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const override = { ...(current[providerId] || {}) };
      const updated = { ...current };
      Object.assign(override, patch);
      // Clean up empty values
      if (!override.proxyPoolId) delete override.proxyPoolId;
      if (!override.rotateStrategy || override.rotateStrategy === "none") delete override.rotateStrategy;
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      console.log("Save settings error:", e);
    } finally {
      setSaving(false);
    }
  };

  const handlePoolChange = (newValue) => {
    setProxyPoolId(newValue);
    patchSettings({ proxyPoolId: newValue === NONE_PROXY_POOL_VALUE ? "" : newValue });
  };

  const handleRotateChange = (newValue) => {
    setRotateStrategy(newValue);
    patchSettings({ rotateStrategy: newValue });
  };

  const isRotating = rotateStrategy !== "none";
  const canRotate = proxyPools.length >= 2;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-green-500/10 text-green-500">
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">No authentication required</p>
          <p className="text-xs text-text-muted">This provider is ready to use. Optionally route requests through a proxy pool to bypass IP-based limits.</p>
        </div>
        {savedFlash && <Badge variant="success" size="sm">Saved</Badge>}
      </div>
      <div className="flex flex-col gap-4">
        {/* Rotation Strategy */}
        <Select
          label="Rotation Strategy"
          value={rotateStrategy}
          onChange={(e) => handleRotateChange(e.target.value)}
          disabled={saving}
          hint={isRotating
            ? (canRotate ? `Rotating across ${proxyPools.length} active pools` : "Need ≥2 active pools for rotation")
            : "Distribute requests across all active proxy pools"}
          options={ROTATE_OPTIONS.map((opt) => ({
            ...opt,
            // Disable round-robin/random if fewer than 2 pools
            ...((opt.value !== "none" && !canRotate) ? { label: `${opt.label} (need ≥2 pools)` } : {}),
          }))}
        />
        {/* Proxy Pool — disabled when rotation is active */}
        <Select
          label="Proxy Pool"
          value={proxyPoolId}
          onChange={(e) => handlePoolChange(e.target.value)}
          disabled={saving || isRotating}
          hint={isRotating ? "Disabled — rotation auto-selects from all pools" : undefined}
          options={[
            { value: NONE_PROXY_POOL_VALUE, label: "None (direct)" },
            ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
          ]}
        />
      </div>
    </Card>
  );
}

NoAuthProxyCard.propTypes = {
  providerId: PropTypes.string.isRequired,
};
