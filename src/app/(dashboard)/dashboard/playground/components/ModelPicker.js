"use client";

import PropTypes from "prop-types";
import { useState } from "react";
import { ModelSelectModal } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconPath } from "@/shared/utils/providerIcon";
import { findModelName } from "@/shared/constants/models";

/**
 * Model picker trigger that opens the shared ModelSelectModal.
 *
 * Replaces the previous plain <select> — the modal gives users provider icons,
 * search, capacity badges, combos, and custom-model discovery, consistent with
 * the rest of the dashboard (cli-tools cards use the same modal).
 *
 * Compare mode renders a compact trigger (one per slot); single mode renders a
 * full-width trigger.
 */
export default function ModelPicker({ value, onChange, models, compact = false, modelAliases = {}, activeProviders = [] }) {
  const [isOpen, setIsOpen] = useState(false);

  // Resolve a display name for the currently selected model. Priority:
  //   1. caller-supplied alias override
  //   2. findModelName() lookup against the provider catalog (gives friendly
  //      names like "GPT-4o (Aug 2024)" instead of raw ids)
  //   3. raw model id
  // Normalize value to a string — ModelSelectModal can occasionally pass a
  // non-string (object/number) via onSelect, and compare-mode slots start as "".
  // Without this guard, `.split()` below throws "value.split is not a function".
  const valueStr = typeof value === "string" ? value : value == null ? "" : String(value);

  const providerId = (() => {
    if (!valueStr) return null;
    const found = models?.find((m) => m.id === valueStr);
    return found?.provider || valueStr.split("/")[0];
  })();
  const displayName = (() => {
    if (!valueStr) return "Select a model...";
    if (modelAliases?.[valueStr]) return modelAliases[valueStr];
    // findModelName needs the provider alias; providerId here is best-effort.
    if (providerId) {
      const name = findModelName(providerId, valueStr);
      if (name && name !== valueStr) return name;
    }
    return valueStr;
  })();

  const triggerClass = compact
    ? "flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-2 px-2 text-xs text-text-main hover:border-primary/40"
    : "flex h-9 w-full items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 text-sm text-text-main hover:border-primary/40";

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={triggerClass}
        title={displayName}
      >
        {providerId && (
          <ProviderIcon
            src={getProviderIconPath(providerId)}
            alt={providerId}
            size={compact ? 16 : 18}
            fallbackText={(providerId || "?").slice(0, 2).toUpperCase()}
          />
        )}
        <span className={`truncate ${value ? "font-medium" : "text-text-muted"}`}>
          {displayName}
        </span>
        <span className="material-symbols-outlined ml-auto text-[16px] text-text-muted">
          expand_more
        </span>
      </button>

      <ModelSelectModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSelect={(modelValue) => {
          // ModelSelectModal passes the whole model object on select, not a
          // string. Extract the value field (the "provider/model" identifier
          // used in request bodies); fall back to name/id for safety. Without
          // this, the trigger renders "[object Object]".
          const resolved = typeof modelValue === "string"
            ? modelValue
            : modelValue?.value || modelValue?.name || modelValue?.id || "";
          onChange(resolved);
          setIsOpen(false);
        }}
        selectedModel={valueStr}
        activeProviders={activeProviders}
        title="Select Model"
        modelAliases={modelAliases}
      />
    </>
  );
}

ModelPicker.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  // Flat model list (kept for backward-compat + provider-icon resolution).
  models: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, provider: PropTypes.string })),
  compact: PropTypes.bool,
  modelAliases: PropTypes.object,
  activeProviders: PropTypes.array,
};
