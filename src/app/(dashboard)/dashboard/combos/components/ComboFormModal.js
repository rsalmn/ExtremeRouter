"use client";

import { useState, useEffect } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { Button, Modal, Input, ModelSelectModal, Badge } from "@/shared/components";
import ModelItem from "./ModelItem";
import SimulatorPanel from "./SimulatorPanel";
import { VALID_NAME_REGEX, STRATEGY_OPTIONS, getStrategyMeta } from "./helpers";

// ComboFormModal — redesigned create/edit combo modal.
//
// Improvements over the original:
// - Header with icon + model count badge
// - Strategy preview hint showing what each strategy does
// - Drag-to-reorder model list with numbered priority indicators
// - Empty state with icon illustration
// - Cleaner visual hierarchy with section headers
export default function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, modelCaps = {}, providerByRef = {}, kindFilter = null, comboStrategies = {} }) {
  // Effective strategy for the combo being edited. The runtime resolves the
  // record's strategyConfig as BASE and settings.comboStrategies[name] as
  // OVERRIDE with settings winning (resolveComboStrategyConfig in
  // comboExecutionPolicy). Mirror that here — otherwise a combo switched to
  // swarm via the ComboCard picker (which writes ONLY settings) still shows
  // "Fallback" when the edit modal opens, because the DB record still carries
  // its original fallback strategy.
  const effectiveFallbackStrategy = (c) =>
    (c && comboStrategies?.[c.name]?.fallbackStrategy) ||
    c?.strategyConfig?.fallbackStrategy ||
    "fallback";

  // Effective smart-routing config mirrors the same settings-over-record merge
  // (comboStrategies wins over the record's strategyConfig).
  const effectiveSmartRouting = (c) =>
    (c && comboStrategies?.[c.name]?.smartRouting) ||
    c?.strategyConfig?.smartRouting ||
    {};

  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState(combo?.models || []);
  const [strategy, setStrategy] = useState(effectiveFallbackStrategy(combo));
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});

  // ── Smart Routing config draft ──
  const [srCookiePool, setSrCookiePool] = useState(true);
  const [srUrlBoost, setSrUrlBoost] = useState(true);
  const [srThreshold, setSrThreshold] = useState(60);
  const [srKeywordText, setSrKeywordText] = useState("");
  const [srClassifierEnabled, setSrClassifierEnabled] = useState(false);
  const [srClassifierModel, setSrClassifierModel] = useState("");

  // H3 FIX: reset local draft whenever the modal is (re)opened. The parent
  // mounts the create modal once with a static key, so useState initializers
  // only ran on first mount — reopening Create after closing showed the
  // previous session's name/models. Re-seed from the `combo` prop (undefined
  // for create) on each open transition so the form starts clean.
  const [wasOpen, setWasOpen] = useState(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen) {
      setName(combo?.name || "");
      setModels(Array.isArray(combo?.models) ? [...combo.models] : []);
      setStrategy(effectiveFallbackStrategy(combo));
      setNameError("");
      setShowModelSelect(false);
      const sr = effectiveSmartRouting(combo);
      setSrCookiePool(sr.cookiePoolEnabled !== false);
      setSrUrlBoost(sr.intentDetection?.urlPatternBoost !== false);
      setSrThreshold(Math.round((sr.intentDetection?.confidenceThreshold ?? 0.6) * 100));
      setSrKeywordText((sr.intentDetection?.keywords || []).join(", "));
      setSrClassifierEnabled(sr.intentDetection?.llmClassifierFallback?.enabled === true);
      setSrClassifierModel(sr.intentDetection?.llmClassifierFallback?.model || "");
    }
    setWasOpen(isOpen);
  }, [isOpen, wasOpen, combo]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const modelItems = models.map((model, i) => ({ uid: `item-${i}`, model }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = modelItems.findIndex((m) => m.uid === active.id);
      const newIndex = modelItems.findIndex((m) => m.uid === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setModels((prev) => arrayMove(prev, oldIndex, newIndex));
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    // L9 FIX: guard against setState-after-unmount. If the modal closes while
    // the fetch is in flight, the cancelled flag prevents a state update on an
    // unmounted component (React warning + potential memory leak).
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/models/alias");
        if (!cancelled && res.ok) {
          const data = await res.json();
          setModelAliases(data.aliases || {});
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const validateName = (value) => {
    if (!value.trim()) { setNameError("Name is required"); return false; }
    if (!VALID_NAME_REGEX.test(value)) { setNameError("Only letters, numbers, -, _ and . allowed"); return false; }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model) => {
    // H4 FIX: functional update — reading `models` from the closure lost rapid
    // adds before re-render (only the last survived). Derive from prev state.
    setModels((prev) => (prev.includes(model.value) ? prev : [...prev, model.value]));
  };

  const handleDeselectModel = (model) => {
    setModels((prev) => prev.filter((m) => m !== model.value));
  };

  const handleRemoveModel = (index) => {
    setModels((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const next = [...models];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setModels(next);
  };

  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const next = [...models];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setModels(next);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    // Merge (not replace) the record's strategyConfig so record-level role
    // models / thinking / autoScale survive an edit — sending only
    // { fallbackStrategy } previously wiped the rest of the record config.
    const mergedStrategyConfig = { ...(combo?.strategyConfig || {}), fallbackStrategy: strategy };
    if (strategy === "smart-routing") {
      mergedStrategyConfig.smartRouting = {
        cookiePoolEnabled: srCookiePool,
        intentDetection: {
          confidenceThreshold: srThreshold / 100,
          urlPatternBoost: srUrlBoost,
          ...(srKeywordText.trim()
            ? { keywords: srKeywordText.split(",").map((k) => k.trim()).filter(Boolean) }
            : {}),
          llmClassifierFallback: {
            enabled: srClassifierEnabled,
            ...(srClassifierModel.trim() ? { model: srClassifierModel.trim() } : {}),
          },
        },
      };
    }
    await onSave({ name: name.trim(), models, strategyConfig: mergedStrategyConfig });
    setSaving(false);
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? "Edit Combo" : "Create Combo"} size="lg">
        <div className="flex flex-col gap-4">
          {/* Name input with live preview */}
          <div>
            <Input
              label="Combo Name"
              value={name}
              onChange={handleNameChange}
              placeholder="my-combo"
              error={nameError}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <p className="text-[10px] text-text-muted">Use this name as the model in your client:</p>
              {name.trim() && (
                <code className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                  {name.trim()}
                </code>
              )}
            </div>
          </div>

          {/* Models section */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-text-main">Models</label>
                {models.length > 0 && (
                  <Badge variant="info" size="sm">{models.length} model{models.length !== 1 ? "s" : ""}</Badge>
                )}
              </div>
              <span className="text-[10px] text-text-muted">Drag to reorder priority</span>
            </div>

            {models.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 border border-dashed border-border rounded-lg bg-surface-2/50">
                <span className="material-symbols-outlined text-text-muted text-2xl mb-2">layers</span>
                <p className="text-xs text-text-muted mb-3">Add models to build your combo</p>
                <Button size="sm" variant="secondary" icon="add" onClick={() => setShowModelSelect(true)}>
                  Add First Model
                </Button>
              </div>
            ) : (
              <>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
                  <SortableContext items={modelItems.map((m) => m.uid)} strategy={verticalListSortingStrategy}>
                    <div className="flex max-h-[45vh] min-w-0 flex-col gap-1 overflow-y-auto rounded-lg bg-surface-2/30 p-1.5">
                      {modelItems.map(({ uid, model }, index) => (
                        <ModelItem
                          key={uid}
                          id={uid}
                          index={index}
                          model={model}
                          modelCaps={modelCaps}
                          providerByRef={providerByRef}
                          isFirst={index === 0}
                          isLast={index === modelItems.length - 1}
                          onEdit={(newVal) => {
                            const updated = [...models];
                            updated[index] = newVal;
                            setModels(updated);
                          }}
                          onMoveUp={() => handleMoveUp(index)}
                          onMoveDown={() => handleMoveDown(index)}
                          onRemove={() => handleRemoveModel(index)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                <button
                  onClick={() => setShowModelSelect(true)}
                  className="w-full mt-2 py-2 border border-dashed border-primary/30 rounded-lg text-xs text-primary font-medium hover:border-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Add Model
                </button>
              </>
            )}
          </div>

          {/* Strategy picker — feeds the simulator below and is saved into
              strategyConfig.fallbackStrategy so the combo runs with the
              simulated strategy immediately after save. */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-text-main">Strategy</label>
              <span className="text-[10px] text-text-muted">How the combo dispatches requests</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
              {STRATEGY_OPTIONS.map((opt) => {
                const active = strategy === opt.value;
                const meta = getStrategyMeta(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStrategy(opt.value)}
                    title={opt.desc}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border-subtle bg-surface-2/50 text-text-muted hover:border-border hover:text-text-main"}`}
                  >
                    <span className="material-symbols-outlined text-[16px]" style={{ color: active ? undefined : meta.color }}>
                      {opt.icon}
                    </span>
                    <span className="font-medium">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Smart Routing config — only when the strategy is selected */}
          {strategy === "smart-routing" && (
            <div className="flex flex-col gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]" style={{ color: "#EC4899" }}>alt_route</span>
                <span className="text-xs font-medium text-text-main">Smart Routing</span>
                <span className="text-[10px] text-text-muted">Routes each request by tool-calling need &amp; research intent</span>
              </div>

              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={srCookiePool}
                  onChange={(e) => setSrCookiePool(e.target.checked)}
                  className="rounded border-border accent-primary"
                />
                <span className="text-[11px] text-text-muted">Route research intents to web (cookie) providers first</span>
              </label>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-text-muted">
                  Research keywords (comma-separated — leave empty for defaults)
                </label>
                <textarea
                  value={srKeywordText}
                  onChange={(e) => setSrKeywordText(e.target.value)}
                  rows={2}
                  placeholder="research, compare, bandingkan, cari sumber, jurnal, ..."
                  className="resize-none rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={srUrlBoost}
                    onChange={(e) => setSrUrlBoost(e.target.checked)}
                    className="rounded border-border accent-primary"
                  />
                  <span className="text-[11px] text-text-muted">Treat prompts containing a URL as research</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={srClassifierEnabled}
                    onChange={(e) => setSrClassifierEnabled(e.target.checked)}
                    className="rounded border-border accent-primary"
                  />
                  <span className="text-[11px] text-text-muted">LLM classifier fallback for ambiguous prompts</span>
                </label>
                {srClassifierEnabled && (
                  <input
                    value={srClassifierModel}
                    onChange={(e) => setSrClassifierModel(e.target.value)}
                    placeholder="kr/claude-haiku-4.5"
                    className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus:border-primary focus:outline-none"
                  />
                )}
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-text-muted">Heuristic confidence threshold</label>
                  <span className="font-mono text-[10px] text-primary">{srThreshold}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={srThreshold}
                  onChange={(e) => setSrThreshold(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            </div>
          )}

          {/* Combo Simulator — live preview of calls/cost/capability/latency/budget */}
          {models.length > 0 && (
            <SimulatorPanel
              models={models}
              strategyConfig={{ fallbackStrategy: strategy }}
            />
          )}

          {/* Strategy hint */}
          {models.length >= 2 && (
            <div className="rounded-lg border border-border-subtle bg-surface-2/50 px-3 py-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="material-symbols-outlined text-[14px] text-text-muted">lightbulb</span>
                <span className="text-xs font-medium text-text-main">Strategy Tips</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {STRATEGY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="flex items-start gap-1.5 text-[11px] text-text-muted">
                    <span className="material-symbols-outlined text-[12px] mt-0.5 text-primary/60">{opt.icon}</span>
                    <span><span className="font-medium text-text-main">{opt.label}</span> — {opt.desc}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-text-muted">
                Set strategy after creating the combo from the Combos tab.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
            <Button
              onClick={handleSave}
              fullWidth
              size="sm"
              icon={isEdit ? "save" : "add"}
              disabled={!name.trim() || !!nameError || saving}
            >
              {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Combo"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Model to Combo — uses the shared ModelSelectModal */}
      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleAddModel}
        onDeselect={handleDeselectModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Add Model to Combo"
        kindFilter={kindFilter}
        addedModelValues={models}
        closeOnSelect={false}
      />
    </>
  );
}
