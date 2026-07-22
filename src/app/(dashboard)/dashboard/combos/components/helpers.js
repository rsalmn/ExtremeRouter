// Combo page helpers — strategy metadata, visual indicators, format utilities.

export const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// Strategy options for dropdowns / button groups.
export const STRATEGY_OPTIONS = [
  { value: "fallback", label: "Fallback", desc: "Try models in order, next on failure", icon: "layers" },
  { value: "round-robin", label: "Round Robin", desc: "Rotate models across requests", icon: "cached" },
  { value: "fusion", label: "Fusion", desc: "Parallel panel + judge synthesis", icon: "hub" },
  { value: "swarm", label: "Swarm", desc: "Hierarchical Manager→Staff→Workers", icon: "account_tree" },
];

// Strategy → visual indicator mapping (Material Symbols icon + color).
export const STRATEGY_META = {
  fallback:    { icon: "layers",        color: "#3B82F6", badge: "info" },
  "round-robin": { icon: "cached",      color: "#10B981", badge: "success" },
  fusion:      { icon: "hub",           color: "#8B5CF6", badge: "primary" },
  swarm:       { icon: "account_tree",  color: "#F59E0B", badge: "warning" },
};

export function getStrategyMeta(strategy) {
  return STRATEGY_META[strategy] || STRATEGY_META.fallback;
}

export function getStrategyLabel(strategy) {
  const opt = STRATEGY_OPTIONS.find((o) => o.value === strategy);
  return opt?.label || "Fallback";
}

export function getStrategyDesc(strategy) {
  const opt = STRATEGY_OPTIONS.find((o) => o.value === strategy);
  return opt?.desc || "";
}

// Filter options for combo list chips.
export const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "fallback", label: "Fallback" },
  { value: "round-robin", label: "Round Robin" },
  { value: "fusion", label: "Fusion" },
  { value: "swarm", label: "Swarm" },
];

// Sort options for combo list.
export const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "models-desc", label: "Most Models" },
  { value: "models-asc", label: "Fewest Models" },
];

// Filter combos by search query and strategy filter.
export function filterCombos(combos, search, strategyFilter, comboStrategies) {
  let result = combos;

  if (strategyFilter !== "all") {
    result = result.filter((c) => {
      const s = comboStrategies[c.name]?.fallbackStrategy || "fallback";
      return s === strategyFilter;
    });
  }

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.models || []).some((m) => m.toLowerCase().includes(q)),
    );
  }

  return result;
}

// Sort combos by selected sort option.
export function sortCombos(combos, sortBy) {
  const sorted = [...combos];
  if (sortBy === "models-desc") {
    sorted.sort((a, b) => (b.models?.length || 0) - (a.models?.length || 0));
  } else if (sortBy === "models-asc") {
    sorted.sort((a, b) => (a.models?.length || 0) - (b.models?.length || 0));
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

// Compute unique models across all combos.
export function getUniqueModels(combos) {
  const set = new Set();
  for (const c of combos) {
    for (const m of c.models || []) set.add(m);
  }
  return set.size;
}

// Compute strategy distribution for donut/bar chart.
export function getStrategyDistribution(combos, comboStrategies) {
  const dist = { fallback: 0, "round-robin": 0, fusion: 0, swarm: 0 };
  // L1 FIX: only the 4 known strategies get buckets. A typo'd/unknown value
  // (e.g. "FUSION" uppercase persisted before M2 normalization) previously
  // created a stray key that ComboOverview rendered as "Fallback" via the
  // getStrategyMeta fallback — masking the misconfiguration. Now unknown
  // values are bucketed under fallback explicitly.
  const KNOWN = new Set(["fallback", "round-robin", "fusion", "swarm"]);
  for (const c of combos) {
    const raw = comboStrategies[c.name]?.fallbackStrategy || "fallback";
    const s = KNOWN.has(raw) ? raw : "fallback";
    dist[s] = (dist[s] || 0) + 1;
  }
  return dist;
}
