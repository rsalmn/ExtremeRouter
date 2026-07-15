"use client";

import { useState } from "react";
import { Card, Badge, Select, ModelSelectModal, CapacityBadges } from "@/shared/components";
import { STRATEGY_OPTIONS, getStrategyMeta, getStrategyLabel } from "./helpers";

// ComboCard — redesigned expandable card with strategy visual indicator.
//
// Collapsed: icon + name + model chips + strategy badge + action buttons
// Expanded: full model list + strategy config + fusion/swarm role pickers
export default function ComboCard({ combo, modelCaps = {}, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, onSetStrategy }) {
  const [expanded, setExpanded] = useState(false);
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const [showSwarmRoleSelect, setShowSwarmRoleSelect] = useState(null);

  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const isSwarm = current === "swarm";
  const swarmManager = strategy.managerModel || "";
  const swarmStaff = strategy.staffModel || "";
  const swarmAudit = strategy.auditModel || "";
  const meta = getStrategyMeta(current);

  return (
    <Card padding="sm" className="group transition-all hover:border-primary/20">
      {/* Collapsed row — always visible */}
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          className="flex min-w-0 flex-1 items-start gap-3 text-left sm:items-center"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Strategy visual indicator */}
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${meta.color}15` }}
          >
            <span className="material-symbols-outlined text-[18px]" style={{ color: meta.color }}>
              {meta.icon}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <code className="truncate font-mono text-sm font-medium">{combo.name}</code>
              <Badge variant={meta.badge} size="sm">{getStrategyLabel(current)}</Badge>
              <span className="text-[10px] text-text-muted">{combo.models.length} models</span>
            </div>
            {/* Model chips — first 3 + "+N more" */}
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                combo.models.slice(0, 3).map((model, index) => (
                  <code key={index} className="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted dark:bg-white/5">
                    <span className="truncate max-w-[120px]">{model}</span>
                    {modelCaps[model] && <CapacityBadges caps={modelCaps[model]} size={11} />}
                  </code>
                ))
              )}
              {combo.models.length > 3 && (
                <span className="text-[10px] text-text-muted">+{combo.models.length - 3} more</span>
              )}
            </div>
          </div>
          {/* Expand chevron */}
          <span className={`shrink-0 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}>
            <span className="material-symbols-outlined text-[18px]">expand_more</span>
          </span>
        </button>

        {/* Actions */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          <div className="w-full sm:w-[180px]">
            <Select
              options={STRATEGY_OPTIONS}
              value={current}
              onChange={(e) => onSetStrategy({ fallbackStrategy: e.target.value })}
              selectClassName="py-1.5 text-xs"
            />
          </div>
          <div className="grid grid-cols-3 gap-1 sm:flex">
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }}
              className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              title="Copy combo name"
            >
              <span className="material-symbols-outlined text-[18px]">{copied === `combo-${combo.id}` ? "check" : "content_copy"}</span>
              <span className="text-[10px] leading-tight">Copy</span>
            </button>
            <button onClick={onEdit} className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5" title="Edit">
              <span className="material-symbols-outlined text-[18px]">edit</span>
              <span className="text-[10px] leading-tight">Edit</span>
            </button>
            <button onClick={onDelete} className="flex flex-col items-center rounded px-2 py-1 text-red-500 transition-colors hover:bg-red-500/10" title="Delete">
              <span className="material-symbols-outlined text-[18px]">delete</span>
              <span className="text-[10px] leading-tight">Delete</span>
            </button>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          {/* Full model list */}
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">Models ({combo.models.length})</p>
            <div className="flex flex-col gap-1">
              {combo.models.map((model, index) => (
                <div key={index} className="flex items-center gap-2 rounded px-2 py-1 bg-black/[0.02] dark:bg-white/[0.02]">
                  <span className="text-[10px] font-medium text-text-muted w-4 text-center">{index + 1}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-main">{model}</code>
                  {modelCaps[model] && <CapacityBadges caps={modelCaps[model]} size={11} />}
                </div>
              ))}
            </div>
          </div>

          {/* Fusion config */}
          {isFusion && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">Fusion Judge</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowJudgeSelect(true)}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-dashed border-primary/40 px-2 py-1 font-mono text-xs text-primary hover:border-primary hover:bg-primary/5"
                >
                  <span className="material-symbols-outlined text-[14px]">gavel</span>
                  <span className="truncate">{judge || `Auto — ${combo.models[0] || "first model"}`}</span>
                </button>
                {judge && (
                  <button onClick={() => onSetStrategy({ judgeModel: "" })} className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10" title="Reset to Auto">
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Swarm config */}
          {isSwarm && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">Swarm Roles</p>
              <div className="flex flex-col gap-1.5">
                {[
                  { key: "manager", label: "Manager", icon: "psychology", value: swarmManager, placeholder: `Auto — ${combo.models[0] || "first"}` },
                  { key: "staff", label: "Staff", icon: "badge", value: swarmStaff, placeholder: "Same as Manager" },
                  { key: "audit", label: "Audit", icon: "fact_check", value: swarmAudit, placeholder: "Same as Staff" },
                ].map((role) => (
                  <div key={role.key} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-muted w-16">{role.label}</span>
                    <button
                      onClick={() => setShowSwarmRoleSelect(role.key)}
                      className="inline-flex max-w-full items-center gap-1 rounded border border-dashed border-primary/40 px-2 py-0.5 font-mono text-[11px] text-primary hover:border-primary hover:bg-primary/5"
                    >
                      <span className="material-symbols-outlined text-[13px]">{role.icon}</span>
                      <span className="truncate">{role.value || role.placeholder}</span>
                    </button>
                    {role.value && (
                      <button onClick={() => onSetStrategy({ [`${role.key}Model`]: "" })} className="p-0.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10" title={`Reset ${role.label}`}>
                        <span className="material-symbols-outlined text-[13px]">close</span>
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span className="font-medium">Workers</span>
                  <span>= combo models ({combo.models.length})</span>
                  <span className="text-text-subtle">·</span>
                  <a href="/dashboard/swarm" className="text-primary hover:underline">Telemetry →</a>
                </div>
              </div>
            </div>
          )}

          {/* Strategy description */}
          <div className="text-xs text-text-muted bg-black/[0.02] dark:bg-white/[0.02] rounded px-2 py-1.5">
            <span className="font-medium">{getStrategyLabel(current)}:</span> {STRATEGY_OPTIONS.find(o => o.value === current)?.desc}
          </div>
        </div>
      )}

      {/* Judge model picker */}
      <ModelSelectModal
        isOpen={showJudgeSelect}
        onClose={() => setShowJudgeSelect(false)}
        onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
        activeProviders={activeProviders}
        title="Select Judge Model"
        addedModelValues={judge ? [judge] : []}
        closeOnSelect={true}
      />

      {/* Swarm role pickers */}
      {showSwarmRoleSelect && (
        <ModelSelectModal
          isOpen={true}
          onClose={() => setShowSwarmRoleSelect(null)}
          onSelect={(m) => { onSetStrategy({ [`${showSwarmRoleSelect}Model`]: m?.value || "" }); setShowSwarmRoleSelect(null); }}
          activeProviders={activeProviders}
          title={`Select ${showSwarmRoleSelect === "manager" ? "Manager" : showSwarmRoleSelect === "staff" ? "Staff" : "Audit"} Model`}
          addedModelValues={[]}
          closeOnSelect={true}
        />
      )}
    </Card>
  );
}
