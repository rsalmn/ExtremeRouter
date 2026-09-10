"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, CardSkeleton, ConfirmModal, PageHeader, SegmentedControl } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelRefs } from "@/shared/hooks/useModelRefs";
import ComboOverview from "./components/ComboOverview";
import ComboList from "./components/ComboList";
import ComboTemplatesTab from "./components/ComboTemplatesTab";
import ComboFormModal from "./components/ComboFormModal";
import ComboLabPanel from "./components/ComboLabPanel";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "combos", label: "Combos" },
  { value: "templates", label: "Templates" },
  { value: "lab", label: "Lab" },
];

export default function CombosPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "overview";

  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [modelCaps, setModelCaps] = useState({});
  const [modelIndex, setModelIndex] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const { copied, copy } = useCopyToClipboard();

  // Combo members are free-form strings ("alias/model", "provider/nested/model",
  // bare ids, dynamic-provider models) that do NOT necessarily match /api/models
  // fullModel keys. Resolve them server-side (single source of truth) so every
  // row gets its capability badges + provider icon; the static map still wins
  // for exact matches.
  const memberRefs = useMemo(
    () => (combos || []).flatMap((c) => (Array.isArray(c?.models) ? c.models : [])),
    [combos]
  );
  const { capsByRef, providerByRef } = useModelRefs(memberRefs);
  const resolvedModelCaps = useMemo(() => ({ ...modelCaps, ...capsByRef }), [modelCaps, capsByRef]);

  const fetchData = useCallback(async () => {
    try {
      const [combosRes, providersRes, settingsRes, modelsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
        fetch("/api/models"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};

      if (combosRes.ok) setCombos((combosData.combos || []).filter((c) => !c.kind || c.kind === "llm"));
      if (providersRes.ok) setActiveProviders(providersData.connections || []);
      if (modelsRes.ok) {
        const md = await modelsRes.json();
        const map = {};
        const idx = {};
        for (const m of md.models || []) {
          if (m.caps) map[m.fullModel] = m.caps;
          // Build model-name → [provider ids] index so templates can resolve a
          // model to ANY connected provider that carries it (not just the
          // template's preferred provider).
          const name = (m.fullModel || "").split("/").slice(1).join("/");
          if (name && m.provider) {
            if (!idx[name]) idx[name] = [];
            if (!idx[name].includes(m.provider)) idx[name].push(m.provider);
          }
        }
        setModelCaps(map);
        setModelIndex(idx);
      }
      setComboStrategies(settingsData.comboStrategies || {});
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleTabChange = (tab) => router.push(`/dashboard/combos?tab=${tab}`);

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (res.ok) { await fetchData(); setShowCreateModal(false); }
      else { const err = await res.json(); alert(err.error || "Failed to create combo"); }
    } catch (error) { console.log("Error creating combo:", error); }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (res.ok) {
        // Strategy edits must ALSO land in settings.comboStrategies. Runtime
        // resolves record strategyConfig + settings override with SETTINGS
        // WINNING (resolveComboStrategyConfig) — writing only the record would
        // leave a stale settings override in place, so the modal's choice would
        // have NO runtime effect and the card picker would keep showing the old
        // strategy. Reuse handleSetComboStrategy so role stripping, validation
        // and the fallback-delete signal stay consistent with the card picker.
        const fallback = data.strategyConfig?.fallbackStrategy;
        const prevName = editingCombo?.name;
        const nextName = data.name?.trim();
        if (fallback) {
          if (nextName && nextName !== prevName && comboStrategies[prevName]) {
            // Renamed: revert the orphaned old-name settings entry so stale
            // config can't resurrect if the name is ever reused.
            await handleSetComboStrategy(prevName, { fallbackStrategy: "fallback" });
          }
          if (nextName) await handleSetComboStrategy(nextName, { fallbackStrategy: fallback });
        }
        await fetchData();
        setEditingCombo(null);
      }
      else { const err = await res.json(); alert(err.error || "Failed to update combo"); }
    } catch (error) { console.log("Error updating combo:", error); }
  };

  const handleDelete = (id) => {
    setConfirmState({
      title: "Delete Combo",
      message: "Delete this combo?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          // H5 FIX: Use functional update to avoid stale closure on `combos`
          if (res.ok) {
            setCombos(prev => prev.filter((c) => c.id !== id));
          } else {
            // M5 FIX: previously silent on failure — card stayed in the list
            // with no indication the delete was rejected. Surface the error.
            const err = await res.json().catch(() => ({}));
            alert(err.error || `Failed to delete combo (${res.status})`);
          }
        } catch (error) {
          console.log("Error deleting combo:", error);
          alert("Failed to delete combo — network error");
        }
      },
    });
  };

  const handleSetComboStrategy = async (comboName, patch) => {
    // H2 FIX: send ONLY the changed combo entry instead of the full
    // comboStrategies snapshot. The backend now deep-merges comboStrategies
    // at the combo-name level (settingsRepo.updateSettings), so a concurrent
    // edit to a different combo survives. Previously the full-map PATCH raced
    // with other edits and the last writer silently dropped the others.
    //
    // L4 FIX: when the strategy changes, strip stale role-specific fields from
    // the previous strategy so they don't accumulate forever (e.g. switching
    // fusion→swarm previously left judgeModel sitting unused in settings, and
    // swarm→fusion left managerModel/staffModel/auditModel). Strip the fields
    // the new strategy doesn't use before sending.
    try {
      const current = (comboStrategies[comboName] || {});
      const merged = { ...current, ...patch };
      const nextStrat = merged.fallbackStrategy;

      // Fields each strategy actually uses. Everything else is stale.
      const ROLE_FIELDS = {
        fusion: ["judgeModel", "fusionTuning"],
        swarm: ["managerModel", "staffModel", "auditModel", "workerCount", "swarmTuning", "enableTelemetry"],
        cascade: ["cascade"],
        "smart-routing": ["smartRouting"],
        fallback: [],
        "round-robin": [],
      };
      // thinking + autoScale + budgets apply to EVERY strategy (fallback
      // included) — always keep them.
      const keep = new Set(["fallbackStrategy", "thinking", "autoScale", "budgets", ...(ROLE_FIELDS[nextStrat] || [])]);
      const next = {};
      for (const [k, v] of Object.entries(merged)) {
        if (keep.has(k)) next[k] = v;
      }

      // Only delete the whole entry when a previously-configured combo is reverted
      // to plain fallback with NO extra config. A fallback combo that carries
      // thinking/autoScale (e.g. Penny-Pincher template) must keep its config —
      // previously ANY edit to a fallback combo wiped thinking entirely.
      const hadConfig = Object.keys(current).some((k) => k !== "fallbackStrategy" && current[k] != null && current[k] !== "");
      const hasExtraConfig = Object.keys(next).some((k) => k !== "fallbackStrategy");
      const isDelete = next.fallbackStrategy === "fallback" && hadConfig && !hasExtraConfig;

      // P1: validate control-role models BEFORE persisting. The settings PATCH
      // is a generic deep-merge with no combo-aware validation, so without this
      // a web-cookie provider can be silently saved as manager/judge — which the
      // runtime would then reject with an opaque error.
      if (!isDelete && (next.fallbackStrategy === "swarm" || next.fallbackStrategy === "fusion")) {
        const combo = combos.find((c) => c.name === comboName);
        const panel = combo?.models || [];
        try {
          const vRes = await fetch("/api/combos/validate-roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              strategy: next.fallbackStrategy,
              managerModel: next.managerModel,
              staffModel: next.staffModel,
              auditModel: next.auditModel,
              judgeModel: next.judgeModel,
              panel,
            }),
          });
          if (vRes.ok) {
            const vData = await vRes.json();
            if (!vData.valid && Array.isArray(vData.violations) && vData.violations.length > 0) {
              const msg = vData.violations.map((v) => `${v.role}: ${v.reason}`).join("\n");
              alert(`Cannot save strategy — invalid role models:\n\n${msg}`);
              return;
            }
          }
        } catch {
          // validation endpoint unreachable — don't block save (fail-open UX)
        }
      }

      // null is the backend's delete-signal (see settingsRepo deep-merge).
      const payload = { comboStrategies: { [comboName]: isDelete ? null : next } };

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setComboStrategies((prev) => {
        const updated = { ...prev };
        if (isDelete) delete updated[comboName];
        else updated[comboName] = next;
        return updated;
      });
    } catch (error) {
      console.log("Error updating combo strategy:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="Combos"
        description="Group models under one name, then pick a strategy per combo"
        icon="layers"
        actions={<Button size="sm" icon="add" onClick={() => setShowCreateModal(true)} className="whitespace-nowrap">Create Combo</Button>}
      />

      <SegmentedControl options={TABS} value={activeTab} onChange={handleTabChange} />

      {activeTab === "overview" && (
        <ComboOverview
          combos={combos}
          comboStrategies={comboStrategies}
          activeProviders={activeProviders}
          onViewCombos={() => handleTabChange("combos")}
          onCreate={() => setShowCreateModal(true)}
        />
      )}

      {activeTab === "combos" && (
        <ComboList
          combos={combos}
          modelCaps={resolvedModelCaps}
          providerByRef={providerByRef}
          activeProviders={activeProviders}
          comboStrategies={comboStrategies}
          copied={copied}
          copy={copy}
          onEdit={setEditingCombo}
          onDelete={handleDelete}
          onSetStrategy={handleSetComboStrategy}
          onCreate={() => setShowCreateModal(true)}
        />
      )}

      {activeTab === "templates" && (
        <ComboTemplatesTab combos={combos} connections={activeProviders} modelIndex={modelIndex} onApply={fetchData} />
      )}

      {activeTab === "lab" && (
        <div className="flex flex-col gap-3">
          <p className="text-[11px] text-text-muted">
            What-if engine — compare routing strategies side-by-side using your historical latency, cost and reliability data,
            then apply the recommended strategy to any combo.
          </p>
          <ComboLabPanel activeProviders={activeProviders} />
        </div>
      )}

      {/* Create Modal */}
      <ComboFormModal key="create" isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onSave={handleCreate} activeProviders={activeProviders} modelCaps={resolvedModelCaps} providerByRef={providerByRef} />

      {/* Edit Modal — comboStrategies passed so the strategy picker shows the
          EFFECTIVE strategy (settings override wins), matching the runtime
          merge — not the stale record-only strategyConfig. */}
      <ComboFormModal
        key={editingCombo?.id || "new"}
        isOpen={!!editingCombo}
        combo={editingCombo}
        onClose={() => setEditingCombo(null)}
        onSave={(data) => handleUpdate(editingCombo.id, data)}
        activeProviders={activeProviders}
        modelCaps={resolvedModelCaps}
        providerByRef={providerByRef}
        comboStrategies={comboStrategies}
      />

      {/* Confirm Delete */}
      <ConfirmModal isOpen={!!confirmState} onClose={() => setConfirmState(null)} onConfirm={confirmState?.onConfirm} title={confirmState?.title || "Confirm"} message={confirmState?.message} variant="danger" />
    </div>
  );
}
