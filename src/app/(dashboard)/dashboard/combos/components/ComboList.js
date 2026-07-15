"use client";

import { useState, useMemo } from "react";
import { Card, Input, EmptyState, Button } from "@/shared/components";
import ComboCard from "./ComboCard";
import { FILTER_OPTIONS, SORT_OPTIONS, filterCombos, sortCombos } from "./helpers";

// ComboList — searchable, filterable combo list with redesigned expandable cards.
export default function ComboList({ combos, modelCaps, activeProviders, comboStrategies, copied, copy, onEdit, onDelete, onSetStrategy, onCreate }) {
  const [search, setSearch] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");

  const filtered = useMemo(() => {
    const result = filterCombos(combos, search, strategyFilter, comboStrategies);
    return sortCombos(result, sortBy);
  }, [combos, search, strategyFilter, sortBy, comboStrategies]);

  if (combos.length === 0) {
    return (
      <EmptyState
        icon="layers"
        title="No combos yet"
        description="Create model combos with fallback, round-robin, fusion, or swarm strategies"
        actionText="Create Combo"
        onAction={onCreate}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search + filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search combos or models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <div className="flex items-center gap-2">
          {/* Filter chips */}
          <div className="flex flex-wrap gap-1">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStrategyFilter(opt.value)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  strategyFilter === opt.value
                    ? "bg-primary/15 text-primary ring-1 ring-primary/20"
                    : "bg-surface-2 text-text-muted hover:text-text-main"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Sort dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="appearance-none rounded-lg border border-border bg-surface-2 py-1.5 pl-3 pr-8 text-xs text-text-main [-webkit-appearance:none] [-moz-appearance:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Result count */}
      <p className="text-xs text-text-muted">
        {filtered.length === combos.length
          ? `${combos.length} combo${combos.length !== 1 ? "s" : ""}`
          : `${filtered.length} of ${combos.length} combos`}
      </p>

      {/* Filtered empty state */}
      {filtered.length === 0 ? (
        <Card>
          <div className="py-8 text-center text-sm text-text-muted">
            No combos match "{search}" {strategyFilter !== "all" && `with ${strategyFilter} strategy`}
          </div>
        </Card>
      ) : (
        /* Combo cards */
        <div className="flex flex-col gap-3">
          {filtered.map((combo) => (
            <ComboCard
              key={combo.id}
              combo={combo}
              modelCaps={modelCaps}
              activeProviders={activeProviders}
              copied={copied}
              onCopy={copy}
              onEdit={() => onEdit(combo)}
              onDelete={() => onDelete(combo.id)}
              strategy={comboStrategies[combo.name] || {}}
              onSetStrategy={(patch) => onSetStrategy(combo.name, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
