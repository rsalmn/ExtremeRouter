"use client";

import PropTypes from "prop-types";

// Group models by provider for the dropdown
function groupByProvider(models) {
  const groups = {};
  for (const m of models) {
    const provider = m.provider || m.id.split("/")[0] || "other";
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(m);
  }
  return groups;
}

export default function ModelPicker({ models, value, onChange, compact = false }) {
  const groups = groupByProvider(models);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${compact ? "h-8 text-xs" : "h-9 text-sm"} rounded-lg border border-border-subtle bg-surface-2 px-3 text-text-main focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30`}
    >
      <option value="">Select a model...</option>
      {Object.entries(groups).map(([provider, modelList]) => (
        <optgroup key={provider} label={provider}>
          {modelList.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

ModelPicker.propTypes = {
  models: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, provider: PropTypes.string })),
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  compact: PropTypes.bool,
};
