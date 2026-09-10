"use client";

import { useState } from "react";
import { Card, Badge, Select, ModelSelectModal, CapacityBadges } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconPath } from "@/shared/utils/providerIcon";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";
import { classifyComboThinking } from "@/shared/utils/comboThinking";
import { STRATEGY_OPTIONS, getStrategyMeta, getStrategyLabel } from "./helpers";

// ── Thinking constants ──────────────────────────────────────────────
const THINKING_TYPE_OPTIONS = [
  { value: "auto",  label: "Auto (provider default)" },
  { value: "off",   label: "Off" },
  { value: "effort", label: "Effort (OpenAI-style)" },
  { value: "extended", label: "Extended (Claude-style)" },
];
const THINKING_EFFORT_OPTIONS = [
  { value: "low",  label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max",  label: "Max" },
];
const SWARM_ROLES = [
  { key: "manager", label: "Manager", icon: "psychology" },
  { key: "staff",   label: "Staff",   icon: "badge" },
  { key: "audit",   label: "Audit",   icon: "fact_check" },
  { key: "worker",  label: "Worker",  icon: "group" },
];
const FUSION_ROLES = [
  { key: "panel", label: "Panel", icon: "dashboard" },
  { key: "judge", label: "Judge", icon: "gavel" },
];

// ── Budget constants ──────────────────────────────────────────────
// Backend no longer enforces a fixed $100 ceiling for combo cost budgets,
// so the UI can allow user-defined budgets above the old cap as well.
const COMBO_DEFAULT_BUDGET_USD = 5;

const isUnlimitedBudget = (raw) =>
  raw === "unlimited" || raw === Infinity || raw === "Infinity";

// Resolve the effective per-request cost budget ($USD) for a combo. Uses the
// persisted value when present, otherwise falls back to the runtime default.
const resolveBudgetUsd = (strategy) => {
  const raw = strategy?.budgets?.maxEstimatedCostUsd;
  if (isUnlimitedBudget(raw)) return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : COMBO_DEFAULT_BUDGET_USD;
};

/**
 * Check if a provider (by id) can serve a control role (manager/staff/audit/judge).
 * Web cookie providers lack toolUse + fileAccess and are blocked from these roles.
 */
function canServeControlRole(providerId) {
  const pid = resolveProviderId(providerId);
  const caps = AI_PROVIDERS[pid]?.capabilities;
  if (!caps) return true; // unknown provider — allow (don't over-block)
  return caps.toolUse !== false && caps.fileAccess !== false;
}

/**
 * Resolve the provider id from a "provider/model" combo model string.
 */
function providerIdFromModelStr(modelStr) {
  if (!modelStr || typeof modelStr !== "string") return null;
  const slashIdx = modelStr.indexOf("/");
  return slashIdx >= 0 ? modelStr.slice(0, slashIdx) : modelStr;
}

/**
 * Check if a role assignment is blocked — considering the panel[0] fallback
 * for empty (Auto) role values. This mirrors the runtime fallback logic:
 *   manager empty → panel[0], judge empty → panel[0].
 *
 * @param {string} roleValue - the role's model string (may be empty for "Auto")
 * @param {string[]} panel - combo.models array for fallback resolution
 * @returns {{blocked:boolean, provider:string|null}} blocked status + the provider id that triggered it
 */
function checkRoleBlocked(roleValue, panel) {
  // If role is explicitly set, check that provider.
  if (roleValue) {
    const providerId = providerIdFromModelStr(roleValue);
    return { blocked: providerId ? !canServeControlRole(providerId) : false, provider: providerId };
  }
  // Role is empty (Auto) — check the panel[0] fallback.
  const fallback = panel && panel.length > 0 ? panel[0] : null;
  const providerId = providerIdFromModelStr(fallback);
  return { blocked: providerId ? !canServeControlRole(providerId) : false, provider: providerId };
}

/**
 * Filter activeProviders to only those eligible for control roles.
 * Used when opening ModelSelectModal for Manager/Staff/Audit/Judge pickers.
 */
function filterControlEligible(providers) {
  return providers.filter((p) => canServeControlRole(p.provider));
}

// ComboCard — redesigned expandable card with strategy visual indicator.
//
// Collapsed: icon + name + model chips + strategy badge + action buttons
// Expanded: full model list + strategy config + fusion/swarm role pickers
export default function ComboCard({ combo, modelCaps = {}, providerByRef = {}, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, onSetStrategy }) {
  const [expanded, setExpanded] = useState(false);
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const [showSwarmRoleSelect, setShowSwarmRoleSelect] = useState(null);

  // M4 FIX: defensive default — combo.models can be undefined if the combos
  // list was fetched mid-write or a row was hand-edited. ComboOverview guards
  // with ?. but ComboCard previously crashed on .length/.slice/.map. Normalize
  // once at the top so every downstream use is safe.
  const models = Array.isArray(combo?.models) ? combo.models : [];

  // Combo-level derived capability (from /api/models combo entries, keyed by
  // combo name): union of member modalities, min limits, strategy-aware
  // thinking. Distinct from the per-member badges rendered on the chips below
  // — this one answers "what can the combo do as a whole". Null when the
  // combo has no entry/caps (e.g. media combos not in the LLM catalog).
  const comboCaps = modelCaps[combo.name] || null;

  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const isSwarm = current === "swarm";
  const swarmManager = strategy.managerModel || "";
  const swarmStaff = strategy.staffModel || "";
  const swarmAudit = strategy.auditModel || "";
  const meta = getStrategyMeta(current);
  // Effective per-request max cost budget ($USD) — read from strategy.budgets,
  // falls back to the runtime default. Used both for the collapsed highlight
  // badge and the expanded editable control.
  const budgetUsd = resolveBudgetUsd(strategy);
  const isUnlimited = isUnlimitedBudget(strategy?.budgets?.maxEstimatedCostUsd);
  const budgetEnabled = strategy?.budgets?.enabled === true; // default OFF
  const hasCustomBudget = budgetEnabled && strategy?.budgets?.maxEstimatedCostUsd != null && !isUnlimited && Number(strategy.budgets.maxEstimatedCostUsd) > 0;
  const setBudgetUsd = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    onSetStrategy({
      budgets: {
        ...(strategy.budgets || {}),
        enabled: true,
        maxEstimatedCostUsd: n,
      },
    });
  };
  const setUnlimitedBudget = () => {
    onSetStrategy({
      budgets: {
        ...(strategy.budgets || {}),
        enabled: true,
        maxEstimatedCostUsd: "unlimited",
      },
    });
  };
  const setBudgetEnabled = (enabled) => {
    onSetStrategy({
      budgets: {
        ...(strategy.budgets || {}),
        enabled,
      },
    });
  };
  const thinking = strategy.thinking || {};
  const thinkingType = thinking.type || "auto";
  const isThinkingActive = thinkingType !== "auto" && thinkingType !== "off";
  const [expandedRoles, setExpandedRoles] = useState([]);

  // ── Thinking helpers ──────────────────────────────────────────────
  const setThinking = (patch) => onSetStrategy({ thinking: { ...thinking, ...patch } });
  const setRoleThinking = (role, patch) => {
    const roles = { ...(thinking.roles || {}) };
    if (patch === null) {
      delete roles[role];
    } else {
      roles[role] = { ...(roles[role] || {}), ...patch };
    }
    setThinking({ roles });
  };
  const roleThinking = (role) => thinking?.roles?.[role];

  // ── Model thinking capability detection ─────────────────────────────
  // Check every model in the combo to determine which thinking modes are
  // supported. Grey-out unsupported options and warn when a mode is active
  // but some models lack it.
  //
  // Classification mirrors what the runtime (thinkingUnified.applyFormat)
  // actually accepts for each mode — not a hardcoded format list:
  //   • effort  → reasoning_effort is translated into EVERY native format
  //               (openai/claude-adaptive/claude-budget/gemini/zai/deepseek/...),
  //               so any reasoning model can honor it.
  //   • extended→ budget_tokens is consumed by the budget-capable formats
  //               (claude-*, gemini-*, qwen, hunyuan, minimax, zai). OpenAI-style
  //               effort formats (openai/deepseek/kimi/step) drop a budget config,
  //               so they can't honor it.
  const { hasEffort, hasExtended, hasMaxEffort, unresolvableModels, unsupportedForCurrent } =
    classifyComboThinking(models.map(model => ({ model, caps: modelCaps[model] || {} })), thinkingType);

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
              {/* Aggregate combo capability (derived from members, monochrome so it
                  reads differently from the per-model badges on the chips). */}
              {comboCaps && (
                <span className="inline-flex items-center gap-1" title="Capabilities derived from member models">
                  <CapacityBadges caps={comboCaps} size={12} colorOverride="text-text-muted" />
                  <span className="text-[9px] uppercase tracking-wide text-text-muted">derived</span>
                </span>
              )}
              {isThinkingActive && (
                <Badge variant="cyan" size="sm" className="flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-[10px]">psychology</span>
                  {thinkingType === "effort" ? thinking.effort || "on" : thinkingType}
                </Badge>
              )}
              {/* Cost budget highlight — only when the budget limit is enabled.
                  Off by default, so no badge shows for a combo with no guard. */}
              {budgetEnabled && (
                <Badge
                  variant="warning"
                  size="sm"
                  className="flex items-center gap-0.5"
                  title={`Max cost budget: $${budgetUsd.toFixed(2)} per request`}
                >
                  <span className="material-symbols-outlined text-[10px]">savings</span>
                  ${budgetUsd.toFixed(2)}
                </Badge>
              )}
              <span className="text-[10px] text-text-muted">{models.length} models</span>
            </div>
            {/* Model chips — first 3 + "+N more" */}
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                models.slice(0, 3).map((model, index) => (
                  <code key={index} className="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted dark:bg-white/5">
                    {providerByRef[model] && (
                      <ProviderIcon
                        src={getProviderIconPath(providerByRef[model])}
                        alt={providerByRef[model]}
                        size={12}
                        fallbackText={providerByRef[model].slice(0, 2).toUpperCase()}
                      />
                    )}
                    <span className="truncate max-w-[120px]">{model}</span>
                    {modelCaps[model] && <CapacityBadges caps={modelCaps[model]} size={11} />}
                  </code>
                ))
              )}
              {models.length > 3 && (
                <span className="text-[10px] text-text-muted">+{models.length - 3} more</span>
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
            {/* div (not p): CapacityBadges renders Tooltip -> nested div, which is
                invalid inside <p> and triggers a hydration error. */}
            <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5 flex items-center gap-1.5">
              Models ({models.length})
              {comboCaps && <CapacityBadges caps={comboCaps} size={11} colorOverride="text-text-muted" />}
            </div>
            <div className="flex flex-col gap-1">
              {models.map((model, index) => (
                <div key={index} className="flex items-center gap-2 rounded px-2 py-1 bg-black/[0.02] dark:bg-white/[0.02]">
                  <span className="text-[10px] font-medium text-text-muted w-4 text-center">{index + 1}</span>
                  {providerByRef[model] ? (
                    <ProviderIcon
                      src={getProviderIconPath(providerByRef[model])}
                      alt={providerByRef[model]}
                      size={14}
                      fallbackText={providerByRef[model].slice(0, 2).toUpperCase()}
                    />
                  ) : <span className="w-[14px] shrink-0" aria-hidden />}
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
              {(() => {
                const { blocked: isJudgeBlocked, provider: judgeProvider } = checkRoleBlocked(judge, models);
                return (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowJudgeSelect(true)}
                        className={`inline-flex max-w-full items-center gap-1 rounded border border-dashed px-2 py-1 font-mono text-xs hover:bg-primary/5 ${isJudgeBlocked ? "border-red-400 text-red-500 hover:border-red-500" : "border-primary/40 text-primary hover:border-primary"}`}
                      >
                        <span className="material-symbols-outlined text-[14px]">gavel</span>
                        <span className="truncate">{judge || `Auto — ${models[0] || "first model"}`}</span>
                      </button>
                      {judge && (
                        <button onClick={() => onSetStrategy({ judgeModel: "" })} className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10" title="Reset to Auto">
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      )}
                    </div>
                    {isJudgeBlocked && (
                      <p className="text-[10px] text-red-500">
                        {judge
                          ? "⚠ Web cookie providers cannot serve as Judge (no tool use / file access)"
                          : `⚠ Auto-fallback to "${judgeProvider}" (first combo model) — web cookie cannot serve as Judge`}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Swarm config */}
          {isSwarm && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">Swarm Roles</p>
              <div className="flex flex-col gap-1.5">
                {[
                  { key: "manager", label: "Manager", icon: "psychology", value: swarmManager, placeholder: `Auto — ${models[0] || "first"}` },
                  { key: "staff", label: "Staff", icon: "badge", value: swarmStaff, placeholder: "Same as Manager" },
                  { key: "audit", label: "Audit", icon: "fact_check", value: swarmAudit, placeholder: "Same as Staff" },
                ].map((role) => {
                  // Detect capability violation — considers panel[0] fallback for empty (Auto) roles.
                  const { blocked: isBlocked, provider: blockedProvider } = checkRoleBlocked(role.value, models);
                  return (
                  <div key={role.key} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-text-muted w-16">{role.label}</span>
                      <button
                        onClick={() => setShowSwarmRoleSelect(role.key)}
                        className={`inline-flex max-w-full items-center gap-1 rounded border border-dashed px-2 py-0.5 font-mono text-[11px] hover:bg-primary/5 ${isBlocked ? "border-red-400 text-red-500 hover:border-red-500" : "border-primary/40 text-primary hover:border-primary"}`}
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
                    {isBlocked && (
                      <p className="text-[10px] text-red-500 pl-[76px]">
                        {role.value
                          ? `⚠ Web cookie providers cannot serve as ${role.label} (no tool use / file access)`
                          : `⚠ Auto-fallback to "${blockedProvider}" (first combo model) — web cookie cannot serve as ${role.label}`}
                      </p>
                    )}
                  </div>
                  );
                })}
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span className="font-medium">Workers</span>
                  <span>= combo models ({models.length})</span>
                  <span className="text-text-subtle">·</span>
                  <a href="/dashboard/swarm" className="text-primary hover:underline">Telemetry →</a>
                </div>
                {/* Auto-scale toggle */}
                <div className="flex items-center gap-3 mt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={strategy.autoScale?.enabled === true}
                      onChange={(e) => onSetStrategy({ autoScale: { ...(strategy.autoScale || {}), enabled: e.target.checked } })}
                      className="rounded border-border accent-primary"
                    />
                    <span className="text-[10px] text-text-muted">Auto-scale</span>
                  </label>
                  {strategy.autoScale?.enabled && (
                    <>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-text-muted">Min:</span>
                        <input
                          type="number"
                          min={1}
                          max={strategy.autoScale?.maxWorkers || 8}
                          value={strategy.autoScale?.minWorkers ?? 1}
                          onChange={(e) => onSetStrategy({ autoScale: { ...(strategy.autoScale || {}), minWorkers: Number(e.target.value) || 1 } })}
                          className="w-10 rounded border border-border bg-background px-1 py-0.5 text-[10px] font-mono text-center focus:outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-text-muted">Max:</span>
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={strategy.autoScale?.maxWorkers ?? models.length}
                          onChange={(e) => onSetStrategy({ autoScale: { ...(strategy.autoScale || {}), maxWorkers: Number(e.target.value) || 1 } })}
                          className="w-10 rounded border border-border bg-background px-1 py-0.5 text-[10px] font-mono text-center focus:outline-none focus:border-primary"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Thinking config */}
          <div className="mt-3 border-t border-border-subtle pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">Thinking</p>
              <button
                onClick={() => setExpandedRoles(expandedRoles.length > 0 ? [] : (isFusion ? FUSION_ROLES : isSwarm ? SWARM_ROLES : []).map(r => r.key))}
                className="text-[10px] text-primary hover:underline"
              >
                {expandedRoles.length > 0 ? "Hide roles" : `Role overrides${isThinkingActive ? " (" + Object.keys(thinking.roles || {}).length + ")" : ""}`}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Mode selector */}
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] text-text-muted">Mode:</label>
                <select
                  value={thinkingType}
                  onChange={(e) => setThinking({ type: e.target.value })}
                  className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-mono focus:outline-none focus:border-primary"
                >
                  {THINKING_TYPE_OPTIONS.map(o => {
                    const supported = o.value === "auto" || o.value === "off"
                      || (o.value === "effort" && hasEffort)
                      || (o.value === "extended" && hasExtended);
                    return (
                      <option key={o.value} value={o.value} disabled={!supported} className={!supported ? "text-text-muted" : ""}>
                        {o.label}{!supported ? " (not supported)" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Warning: current mode not supported by some models */}
              {unsupportedForCurrent.length > 0 && (
                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <span className="material-symbols-outlined text-[12px]">warning</span>
                  <span className="text-[10px]">
                    {thinkingType} not supported by {unsupportedForCurrent.map(m => m.model.split("/").pop()).join(", ")}
                  </span>
                </div>
              )}
              {unresolvableModels.length > 0 && thinkingType !== "auto" && thinkingType !== "off" && (
                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <span className="material-symbols-outlined text-[12px]">warning</span>
                  <span className="text-[10px]">
                    Thinking capability unknown for {unresolvableModels.map(m => m.model.split("/").pop()).join(", ")}
                  </span>
                </div>
              )}

              {/* Effort selector (for effort mode) */}
              {thinkingType === "effort" && (
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-text-muted">Effort:</label>
                  <select
                    value={thinking.effort || "high"}
                    onChange={(e) => setThinking({ effort: e.target.value })}
                    className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-mono focus:outline-none focus:border-primary"
                  >
                    {THINKING_EFFORT_OPTIONS.map(o => {
                      const supported = o.value !== "max" || hasMaxEffort;
                      return (
                        <option key={o.value} value={o.value} disabled={!supported} className={!supported ? "text-text-muted" : ""}>
                          {o.label}{!supported ? " (not supported)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Budget tokens (for extended mode) */}
              {thinkingType === "extended" && (
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-text-muted">Budget:</label>
                  <input
                    type="number"
                    min={1024}
                    max={128000}
                    step={1024}
                    value={thinking.budgetTokens || 4096}
                    onChange={(e) => setThinking({ budgetTokens: Number(e.target.value) || 4096 })}
                    className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-mono focus:outline-none focus:border-primary"
                  />
                </div>
              )}
            </div>

            {/* Role-level overrides */}
            {expandedRoles.length > 0 && isThinkingActive && (
              <div className="mt-2 flex flex-col gap-1.5 pl-1">
                <p className="text-[10px] text-text-muted">Per-role overrides (leave as parent to inherit global)</p>
                {(isFusion ? FUSION_ROLES : isSwarm ? SWARM_ROLES : []).map(role => {
                  const r = roleThinking(role.key);
                  return (
                    <div key={role.key} className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[13px] text-text-muted">{role.icon}</span>
                      <span className="text-[11px] font-medium text-text-muted w-12">{role.label}</span>
                      <select
                        value={r?.type || "inherit"}
                        onChange={(e) => setRoleThinking(role.key, e.target.value === "inherit" ? null : { type: e.target.value })}
                        className="rounded border border-border bg-background px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:border-primary"
                      >
                        <option value="inherit">Inherit</option>
                        <option value="off">Off</option>
                        <option value="effort" disabled={!hasEffort} className={!hasEffort ? "text-text-muted" : ""}>Effort{!hasEffort ? " (not supported)" : ""}</option>
                        <option value="extended" disabled={!hasExtended} className={!hasExtended ? "text-text-muted" : ""}>Extended{!hasExtended ? " (not supported)" : ""}</option>
                      </select>
                      {r?.type === "effort" && (
                        <select
                          value={r.effort || "high"}
                          onChange={(e) => setRoleThinking(role.key, { type: "effort", effort: e.target.value })}
                          className="rounded border border-border bg-background px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:border-primary"
                        >
                          {THINKING_EFFORT_OPTIONS.map(o => {
                            const supported = o.value !== "max" || hasMaxEffort;
                            return (
                              <option key={o.value} value={o.value} disabled={!supported} className={!supported ? "text-text-muted" : ""}>
                                {o.label}{!supported ? " (not supported)" : ""}
                              </option>
                            );
                          })}
                        </select>
                      )}
                      {r?.type === "extended" && (
                        <input
                          type="number"
                          min={1024}
                          max={128000}
                          step={1024}
                          value={r.budgetTokens || 4096}
                          onChange={(e) => setRoleThinking(role.key, { type: "extended", budgetTokens: Number(e.target.value) || 4096 })}
                          className="w-16 rounded border border-border bg-background px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:border-primary"
                        />
                      )}
                      {r && (
                        <button onClick={() => setRoleThinking(role.key, null)} className="p-0.5 rounded text-text-muted hover:text-red-500" title="Reset to inherit">
                          <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Strategy description */}
          <div className="text-xs text-text-muted bg-black/[0.02] dark:bg-white/[0.02] rounded px-2 py-1.5">
            <span className="font-medium">{getStrategyLabel(current)}:</span> {STRATEGY_OPTIONS.find(o => o.value === current)?.desc}
          </div>

          {/* Cost budget control — on/off toggle + amount when enabled */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/20 bg-warning/[0.04] px-3 py-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={budgetEnabled}
                onChange={(e) => setBudgetEnabled(e.target.checked)}
                className="rounded border accent-primary"
                aria-label="Enable cost budget limit"
              />
              <span className="material-symbols-outlined text-[16px] text-warning">savings</span>
              <span className="text-[11px] font-semibold text-text-main">Budget Limit</span>
            </label>
            <span className="text-[10px] text-text-muted">
              {budgetEnabled ? "enabled" : "off (no limit)"}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-text-muted">$</span>
              <input
                type="number"
                min={0.01}
                step={0.5}
                value={isUnlimited ? "" : budgetUsd}
                onChange={(e) => setBudgetUsd(e.target.value)}
                disabled={!budgetEnabled || isUnlimited}
                aria-label="Max cost budget in USD per request"
                className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-mono text-right focus:outline-none focus:border-primary disabled:opacity-60"
              />
              <button
                type="button"
                onClick={isUnlimited ? () => setBudgetUsd(5) : setUnlimitedBudget}
                disabled={!budgetEnabled}
                className={`rounded border px-2 py-0.5 text-[11px] font-medium ${isUnlimited ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted hover:text-text-main"} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {isUnlimited ? "Unlimited" : "∞"}
              </button>
            </div>
            <span className="text-[10px] text-text-muted">per request</span>
            <span className={`text-[10px] ${hasCustomBudget || isUnlimited ? "text-primary" : "text-text-muted"}`}>
              {isUnlimited ? "Unlimited" : hasCustomBudget ? `Custom $${Number(budgetUsd).toFixed(2)}` : `Default $${COMBO_DEFAULT_BUDGET_USD.toFixed(2)}`}
            </span>
          </div>
        </div>
      )}

      {/* Judge model picker — control role, filter out web cookie providers */}
      <ModelSelectModal
        isOpen={showJudgeSelect}
        onClose={() => setShowJudgeSelect(false)}
        onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
        activeProviders={filterControlEligible(activeProviders)}
        title="Select Judge Model"
        addedModelValues={judge ? [judge] : []}
        closeOnSelect={true}
      />

      {/* Swarm role pickers — control roles, filter out web cookie providers */}
      {showSwarmRoleSelect && (
        <ModelSelectModal
          isOpen={true}
          onClose={() => setShowSwarmRoleSelect(null)}
          onSelect={(m) => { onSetStrategy({ [`${showSwarmRoleSelect}Model`]: m?.value || "" }); setShowSwarmRoleSelect(null); }}
          activeProviders={filterControlEligible(activeProviders)}
          title={`Select ${showSwarmRoleSelect === "manager" ? "Manager" : showSwarmRoleSelect === "staff" ? "Staff" : "Audit"} Model`}
          // L5 FIX: highlight the currently-selected model for this role so the
          // user sees which one is already set (consistent with the judge picker
          // above which passes `judge ? [judge] : []`). Previously this was []
          // always, so no selection was ever shown.
          addedModelValues={
            showSwarmRoleSelect === "manager" ? (swarmManager ? [swarmManager] : [])
            : showSwarmRoleSelect === "staff" ? (swarmStaff ? [swarmStaff] : [])
            : (swarmAudit ? [swarmAudit] : [])
          }
          closeOnSelect={true}
        />
      )}
    </Card>
  );
}
