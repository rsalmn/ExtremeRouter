"use client";

import { Card, Badge, Button } from "@/shared/components";
import { getStrategyMeta, getStrategyLabel, getUniqueModels, getStrategyDistribution } from "./helpers";

// ComboOverview — KPI summary + strategy distribution + combo health table.
// Shown when user selects the "Overview" tab.
export default function ComboOverview({ combos, comboStrategies, activeProviders, onViewCombos, onCreate }) {
  const totalCombos = combos.length;
  const uniqueModels = getUniqueModels(combos);
  const dist = getStrategyDistribution(combos, comboStrategies);
  const strategiesUsed = Object.values(dist).filter((v) => v > 0).length;
  const avgModels = totalCombos > 0 ? Math.round((combos.reduce((s, c) => s + (c.models?.length || 0), 0) / totalCombos) * 10) / 10 : 0;

  const kpis = [
    { label: "Total Combos", value: totalCombos, icon: "layers", color: "#3B82F6" },
    { label: "Unique Models", value: uniqueModels, icon: "model_training", color: "#10B981" },
    { label: "Strategies Used", value: strategiesUsed, icon: "account_tree", color: "#8B5CF6" },
    { label: "Avg Models/Combo", value: avgModels, icon: "analytics", color: "#F59E0B" },
  ];

  const maxDist = Math.max(...Object.values(dist), 1);

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} padding="sm">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${kpi.color}15` }}>
                <span className="material-symbols-outlined text-[18px]" style={{ color: kpi.color }}>{kpi.icon}</span>
              </div>
              <div>
                <p className="font-mono text-lg font-bold text-text-main">{kpi.value}</p>
                <p className="text-[10px] uppercase tracking-wide text-text-muted">{kpi.label}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Strategy Distribution */}
      <Card>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-text-main">Strategy Distribution</h3>
          <p className="text-xs text-text-muted mt-0.5">How combos are distributed across routing strategies</p>
        </div>
        <div className="flex flex-col gap-2.5">
          {Object.entries(dist).map(([strategy, count]) => {
            const meta = getStrategyMeta(strategy);
            const pct = totalCombos > 0 ? Math.round((count / totalCombos) * 100) : 0;
            return (
              <div key={strategy} className="flex items-center gap-3">
                <div className="flex w-28 items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]" style={{ color: meta.color }}>{meta.icon}</span>
                  <span className="text-xs font-medium text-text-main">{getStrategyLabel(strategy)}</span>
                </div>
                <div className="flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-2.5 rounded-full transition-all"
                    style={{ width: `${(count / maxDist) * 100}%`, backgroundColor: meta.color }}
                  />
                </div>
                <span className="w-16 text-right font-mono text-xs text-text-muted">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Combo Health Summary */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-main">Combo Health</h3>
            <p className="text-xs text-text-muted mt-0.5">Overview of each combo's status</p>
          </div>
          <Button size="sm" variant="ghost" icon="list_alt" onClick={onViewCombos}>View All</Button>
        </div>
        {combos.length === 0 ? (
          <div className="py-6 text-center text-sm text-text-muted">
            No combos yet. <button onClick={onCreate} className="text-primary hover:underline">Create one →</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {combos.map((combo) => {
              const strat = comboStrategies[combo.name]?.fallbackStrategy || "fallback";
              const meta = getStrategyMeta(strat);
              const connectedProviders = (combo.models || []).filter((m) => {
                const provider = m.split("/")[0];
                return activeProviders.some((p) => p.provider === provider && p.isActive !== false);
              }).length;
              const totalProviders = (combo.models || []).length;
              const healthPct = totalProviders > 0 ? Math.round((connectedProviders / totalProviders) * 100) : 0;

              return (
                <div key={combo.id} className="flex items-center gap-3 rounded-lg border border-border-subtle px-3 py-2 hover:bg-sidebar/30">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded" style={{ backgroundColor: `${meta.color}15` }}>
                    <span className="material-symbols-outlined text-[15px]" style={{ color: meta.color }}>{meta.icon}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <code className="truncate font-mono text-xs font-medium">{combo.name}</code>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant={meta.badge} size="sm">{getStrategyLabel(strat)}</Badge>
                      <span className="text-[10px] text-text-muted">{totalProviders} models</span>
                    </div>
                  </div>
                  {/* Provider health bar */}
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <div className="w-20 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={`h-1.5 rounded-full ${healthPct >= 80 ? "bg-success" : healthPct >= 50 ? "bg-warning" : "bg-danger"}`}
                        style={{ width: `${healthPct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono text-[10px] text-text-muted">{connectedProviders}/{totalProviders}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
