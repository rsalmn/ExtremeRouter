"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, CardSkeleton, ConfirmModal, PageHeader, SegmentedControl } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import ComboOverview from "./components/ComboOverview";
import ComboList from "./components/ComboList";
import ComboTemplatesTab from "./components/ComboTemplatesTab";
import ComboFormModal from "./components/ComboFormModal";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "combos", label: "Combos" },
  { value: "templates", label: "Templates" },
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
  const [confirmState, setConfirmState] = useState(null);
  const { copied, copy } = useCopyToClipboard();

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
        for (const m of md.models || []) if (m.caps) map[m.fullModel] = m.caps;
        setModelCaps(map);
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
      if (res.ok) { await fetchData(); setEditingCombo(null); }
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
          if (res.ok) setCombos(combos.filter((c) => c.id !== id));
        } catch (error) { console.log("Error deleting combo:", error); }
      },
    });
  };

  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const updated = { ...comboStrategies };
      const next = { ...(updated[comboName] || {}), ...patch };
      if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") delete updated[comboName];
      else updated[comboName] = next;
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comboStrategies: updated }) });
      setComboStrategies(updated);
    } catch (error) { console.log("Error updating combo strategy:", error); }
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
          modelCaps={modelCaps}
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
        <ComboTemplatesTab combos={combos} connections={activeProviders} onApply={fetchData} />
      )}

      {/* Create Modal */}
      <ComboFormModal key="create" isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onSave={handleCreate} activeProviders={activeProviders} modelCaps={modelCaps} />

      {/* Edit Modal */}
      <ComboFormModal key={editingCombo?.id || "new"} isOpen={!!editingCombo} combo={editingCombo} onClose={() => setEditingCombo(null)} onSave={(data) => handleUpdate(editingCombo.id, data)} activeProviders={activeProviders} modelCaps={modelCaps} />

      {/* Confirm Delete */}
      <ConfirmModal isOpen={!!confirmState} onClose={() => setConfirmState(null)} onConfirm={confirmState?.onConfirm} title={confirmState?.title || "Confirm"} message={confirmState?.message} variant="danger" />
    </div>
  );
}
