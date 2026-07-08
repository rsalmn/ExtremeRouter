"use client";

import PropTypes from "prop-types";
import { useState } from "react";
import { Card, Button, Badge } from "@/shared/components";
import { COMBO_TEMPLATES } from "@/shared/constants/comboTemplates";

/**
 * Renders a grid of prebuilt combo templates. Users can one-click apply a template
 * to create a combo with the models + strategy pre-configured. Provider availability
 * is checked — connected providers show green, missing show gray.
 */
export default function ComboTemplates({ combos, connections, onApply }) {
  const [applying, setApplying] = useState(null);

  // Build set of connected provider IDs
  const connectedProviders = new Set(
    connections?.filter((c) => c.isActive !== false).map((c) => c.provider) || []
  );

  // Build set of existing combo names (to detect duplicates)
  const existingNames = new Set((combos || []).map((c) => c.name));

  const handleApply = async (template) => {
    setApplying(template.id);
    try {
      // 1. Create the combo
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          models: template.models,
          kind: null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to create combo from template");
        return;
      }
      // 2. Set the strategy
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comboStrategies: {
            [template.name]: { fallbackStrategy: template.strategy },
          },
        }),
      });
      // 3. Notify parent to refresh
      if (onApply) onApply();
    } catch (err) {
      alert("Failed to apply template: " + (err?.message || String(err)));
    } finally {
      setApplying(null);
    }
  };

  return (
    <Card title="Combo Templates" subtitle="Pre-built combos — one click to apply" icon="auto_awesome" padding="sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {COMBO_TEMPLATES.map((tpl) => {
          const alreadyExists = existingNames.has(tpl.name);
          const connectedCount = tpl.requiredProviders.filter((p) => connectedProviders.has(p)).length;
          const allConnected = connectedCount === tpl.requiredProviders.length;

          return (
            <div
              key={tpl.id}
              className="flex flex-col gap-3 rounded-brand border border-border-subtle bg-surface-2 p-4 transition-colors hover:border-primary/30"
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-brand bg-primary/10 text-primary ring-1 ring-primary/15">
                  <span className="material-symbols-outlined text-[20px]">{tpl.icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-text-main">{tpl.name}</h4>
                  <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{tpl.description}</p>
                </div>
              </div>

              {/* Models */}
              <div className="flex flex-wrap gap-1.5">
                {tpl.models.map((m) => {
                  const provider = m.split("/")[0];
                  const isConnected = connectedProviders.has(provider);
                  return (
                    <span
                      key={m}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        isConnected
                          ? "bg-success/10 text-success"
                          : "bg-surface-3 text-text-muted"
                      }`}
                    >
                      <span className={`size-1.5 rounded-full ${isConnected ? "bg-success" : "bg-text-muted"}`} />
                      {m}
                    </span>
                  );
                })}
              </div>

              {/* Provider availability + apply */}
              <div className="flex items-center justify-between gap-2 mt-auto">
                <span className="text-xs text-text-muted">
                  {connectedCount}/{tpl.requiredProviders.length} providers connected
                </span>
                {alreadyExists ? (
                  <Badge variant="default" size="sm" icon="check">Created</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant={allConnected ? "primary" : "secondary"}
                    icon={applying === tpl.id ? "progress_activity" : "add"}
                    disabled={!!applying}
                    onClick={() => handleApply(tpl)}
                    className={applying === tpl.id ? "animate-pulse" : ""}
                  >
                    {applying === tpl.id ? "Applying..." : "Apply"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

ComboTemplates.propTypes = {
  combos: PropTypes.arrayOf(PropTypes.shape({ name: PropTypes.string })),
  connections: PropTypes.arrayOf(PropTypes.shape({ provider: PropTypes.string, isActive: PropTypes.bool })),
  onApply: PropTypes.func,
};
