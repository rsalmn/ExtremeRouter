"use client";

import { useState } from "react";
import { Card, Button, Badge, EmptyState } from "@/shared/components";
import { COMBO_TEMPLATES } from "@/shared/constants/comboTemplates";
import { getStrategyMeta, getStrategyLabel } from "./helpers";

// ComboTemplatesTab — redesigned template gallery with provider availability badges.
// Replaces the old ComboTemplates.js component.
export default function ComboTemplatesTab({ combos, connections, onApply }) {
  const [applying, setApplying] = useState(null);

  const connectedProviders = new Set(
    connections?.filter((c) => c.isActive !== false).map((c) => c.provider) || [],
  );
  const existingNames = new Set((combos || []).map((c) => c.name));

  const handleApply = async (template) => {
    setApplying(template.id);
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: template.name, models: template.models, kind: null }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to create combo from template");
        return;
      }
      // IMPORTANT: /api/settings does a shallow merge of top-level keys, so
      // PATCHing { comboStrategies: {...} } would REPLACE the whole object and
      // wipe every other combo's strategy. Fetch current strategies first and
      // merge the new entry in.
      const cur = await fetch("/api/settings").then((r) => r.json()).catch(() => ({}));
      const merged = {
        ...(cur?.comboStrategies || {}),
        [template.name]: { fallbackStrategy: template.strategy },
      };
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: merged }),
      });
      if (onApply) onApply();
    } catch (err) {
      alert("Failed to apply template: " + (err?.message || String(err)));
    } finally {
      setApplying(null);
    }
  };

  if (COMBO_TEMPLATES.length === 0) {
    return (
      <EmptyState icon="dashboard_customize" title="No templates available" description="Combo templates will appear here when added." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-1">
        <h2 className="text-sm font-semibold text-text-main">Combo Templates</h2>
        <p className="text-xs text-text-muted mt-0.5">One-click prebuilt combos. Provider availability is checked automatically.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COMBO_TEMPLATES.map((tpl) => {
          const connectedCount = (tpl.requiredProviders || []).filter((p) => connectedProviders.has(p)).length;
          const totalCount = (tpl.requiredProviders || []).length;
          const isCreated = existingNames.has(tpl.name);
          const meta = getStrategyMeta(tpl.strategy);
          const allConnected = connectedCount === totalCount;

          return (
            <Card key={tpl.id} padding="sm" className="flex flex-col gap-3 hover:border-primary/20 transition-all">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.color}15` }}>
                    <span className="material-symbols-outlined text-[18px]" style={{ color: meta.color }}>{tpl.icon || meta.icon}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-main">{tpl.name}</p>
                    <Badge variant={meta.badge} size="sm">{getStrategyLabel(tpl.strategy)}</Badge>
                  </div>
                </div>
                {isCreated && <Badge variant="success" size="sm" dot>Created</Badge>}
              </div>

              {/* Description */}
              <p className="text-xs text-text-muted leading-relaxed">{tpl.description}</p>

              {/* Model chips */}
              <div className="flex flex-wrap gap-1">
                {(tpl.models || []).slice(0, 4).map((model, i) => (
                  <code key={i} className="inline-flex items-center rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5">
                    {model}
                  </code>
                ))}
                {(tpl.models || []).length > 4 && (
                  <span className="text-[10px] text-text-muted">+{(tpl.models || []).length - 4} more</span>
                )}
              </div>

              {/* Provider availability */}
              <div className="flex flex-wrap gap-1">
                {(tpl.requiredProviders || []).map((provider) => {
                  const isConn = connectedProviders.has(provider);
                  return (
                    <span
                      key={provider}
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        isConn ? "bg-success/10 text-success" : "bg-surface-2 text-text-muted"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[10px]">{isConn ? "check_circle" : "radio_button_unchecked"}</span>
                      {provider}
                    </span>
                  );
                })}
              </div>

              {/* Apply button */}
              <div className="mt-auto pt-1">
                <Button
                  size="sm"
                  fullWidth
                  variant={isCreated ? "secondary" : "primary"}
                  icon={applying === tpl.id ? "progress_activity" : "add"}
                  disabled={isCreated || applying === tpl.id}
                  onClick={() => handleApply(tpl)}
                >
                  {applying === tpl.id ? "Creating..." : isCreated ? "Already Created" : allConnected ? "Apply Template" : `Apply (${connectedCount}/${totalCount} ready)`}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
