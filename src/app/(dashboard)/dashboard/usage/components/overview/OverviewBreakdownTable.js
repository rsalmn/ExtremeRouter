"use client";

import { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
import SegmentedControl from "@/shared/components/SegmentedControl";
import Badge from "@/shared/components/Badge";
import UsageTable, { fmt, fmtTime } from "../UsageTable";

// ---- dimension configs -------------------------------------------------
// Each dimension maps to a stats.by* map and a set of column + render fns that
// match UsageTable's expected props. UsageTable handles grouping + expand state
// internally; we just feed it the right grouping key and cell renderers.

const DIMENSIONS = [
  { value: "byModel", label: "Model", groupKey: "rawModel", storageKey: "ov-models" },
  { value: "byAccount", label: "Account", groupKey: "accountName", storageKey: "ov-accounts" },
  { value: "byApiKey", label: "API Key", groupKey: "keyName", storageKey: "ov-apikeys" },
  { value: "byEndpoint", label: "Endpoint", groupKey: "endpoint", storageKey: "ov-endpoints" },
];

const VALUE_VIEWS = [
  { value: "tokens", label: "Tokens" },
  { value: "costs", label: "Cost" },
];

// Columns per dimension. The "identity" leading columns match UsageTable's
// existing convention (group label cell is rendered by UsageTable itself).
const COLS = {
  byModel: [
    { field: "rawModel", label: "Model" },
    { field: "provider", label: "Provider" },
    { field: "requests", label: "Requests", align: "right" },
    { field: "lastUsed", label: "Last Used", align: "right" },
  ],
  byAccount: [
    { field: "rawModel", label: "Model" },
    { field: "provider", label: "Provider" },
    { field: "accountName", label: "Account" },
    { field: "requests", label: "Requests", align: "right" },
    { field: "lastUsed", label: "Last Used", align: "right" },
  ],
  byApiKey: [
    { field: "keyName", label: "API Key Name" },
    { field: "rawModel", label: "Model" },
    { field: "provider", label: "Provider" },
    { field: "requests", label: "Requests", align: "right" },
    { field: "lastUsed", label: "Last Used", align: "right" },
  ],
  byEndpoint: [
    { field: "endpoint", label: "Endpoint" },
    { field: "rawModel", label: "Model" },
    { field: "provider", label: "Provider" },
    { field: "requests", label: "Requests", align: "right" },
    { field: "lastUsed", label: "Last Used", align: "right" },
  ],
};

// ---- data shaping (lifted from UsageStats orchestrator) -----------------
function sortData(dataMap, sortBy, sortOrder) {
  return Object.entries(dataMap || {})
    .map(([key, data]) => {
      const totalTokens = (data.promptTokens || 0) + (data.completionTokens || 0);
      const totalCost = data.cost || 0;
      const cachedTokens = data.cachedTokens || 0;
      const nonCachedInput = Math.max(0, (data.promptTokens || 0) - cachedTokens);
      const inputCost = totalTokens > 0 ? nonCachedInput * (totalCost / totalTokens) : 0;
      const cachedCost = totalTokens > 0 ? cachedTokens * (totalCost / totalTokens) : 0;
      const outputCost = totalTokens > 0 ? (data.completionTokens || 0) * (totalCost / totalTokens) : 0;
      return { ...data, key, totalTokens, totalCost, inputCost, cachedCost, outputCost };
    })
    .sort((a, b) => {
      let va = a[sortBy];
      let vb = b[sortBy];
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return sortOrder === "asc" ? -1 : 1;
      if (va > vb) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

function groupDataByKey(rows, keyField) {
  if (!Array.isArray(rows)) return [];
  const groups = {};
  for (const item of rows) {
    const gk = item[keyField] || `Unknown ${keyField}`;
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          cost: 0,
          inputCost: 0,
          cachedCost: 0,
          outputCost: 0,
          lastUsed: null,
        },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.cachedTokens += item.cachedTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.cachedCost += item.cachedCost || 0;
    s.outputCost += item.outputCost || 0;
    if (item.lastUsed && (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  }
  return Object.values(groups);
}

// Detail cell renderers per dimension (the leading cells before value cells).
const RENDERERS = {
  byModel: {
    detail: (item) => (
      <>
        <td className="px-6 py-3 font-medium">{item.rawModel}</td>
        <td className="px-6 py-3">
          <Badge variant="default" size="sm">
            {item.provider}
          </Badge>
        </td>
        <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
        <td className="px-6 py-3 text-right whitespace-nowrap text-text-muted">
          {fmtTime(item.lastUsed)}
        </td>
      </>
    ),
    summary: (group) => (
      <>
        <td className="px-6 py-3 text-text-muted">—</td>
        <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
        <td className="px-6 py-3 text-right whitespace-nowrap text-text-muted">
          {fmtTime(group.summary.lastUsed)}
        </td>
      </>
    ),
  },
  byAccount: {
    detail: (item) => (
      <>
        <td className="px-6 py-3 font-medium">
          {item.accountName || (item.connectionId ? `Account ${String(item.connectionId).slice(0, 8)}…` : "Unknown")}
        </td>
        <td className="px-6 py-3 font-medium">{item.rawModel}</td>
        <td className="px-6 py-3">
          <Badge variant="default" size="sm">
            {item.provider}
          </Badge>
        </td>
        <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
        <td className="px-6 py-3 text-right whitespace-nowrap text-text-muted">
          {fmtTime(item.lastUsed)}
        </td>
      </>
    ),
    summary: (group) => (
      <>
        <td className="px-6 py-3 text-text-muted">—</td>
        <td className="px-6 py-3 text-text-muted">—</td>
        <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
        <td className="px-6 py-3 text-right whitespace-nowrap text-text-muted">
          {fmtTime(group.summary.lastUsed)}
        </td>
      </>
    ),
  },
  byApiKey: {
    detail: (item) => (
      <>
        <td className="px-6 py-3 font-medium">{item.keyName || "Unknown Key"}</td>
        <td className="px-6 py-3">{item.rawModel}</td>
        <td className="px-6 py-3">
          <Badge variant="default" size="sm">
            {item.provider}
          </Badge>
        </td>
        <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
        <td className="px-6 py-3 text-right whitespace-nowrap text-text-muted">
          {fmtTime(item.lastUsed)}
        </td>
      </>
    ),
    summary: (group) => (
      <>
        <td className="px-6 py-3 text-text-muted">—</td>
        <td className="px-6 py-3 text-text-muted">—</td>
        <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
        <td className="px-6 py-3 text-right whitespace-nowrap text-text-muted">
          {fmtTime(group.summary.lastUsed)}
        </td>
      </>
    ),
  },
  byEndpoint: {
    detail: (item) => (
      <>
        <td className="px-6 py-3 font-mono text-sm font-medium">{item.endpoint}</td>
        <td className="px-6 py-3">{item.rawModel}</td>
        <td className="px-6 py-3">
          <Badge variant="default" size="sm">
            {item.provider}
          </Badge>
        </td>
        <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
        <td className="px-6 py-3 text-right whitespace-nowrap text-text-muted">
          {fmtTime(item.lastUsed)}
        </td>
      </>
    ),
    summary: (group) => (
      <>
        <td className="px-6 py-3 text-text-muted">—</td>
        <td className="px-6 py-3 text-text-muted">—</td>
        <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
        <td className="px-6 py-3 text-right whitespace-nowrap text-text-muted">
          {fmtTime(group.summary.lastUsed)}
        </td>
      </>
    ),
  },
};

const EMPTY_MSG = {
  byModel: "No model usage recorded yet.",
  byAccount: "No account usage recorded yet.",
  byApiKey: "No API key usage recorded yet.",
  byEndpoint: "No endpoint usage recorded yet.",
};

export default function OverviewBreakdownTable({ stats }) {
  const [dimension, setDimension] = useState("byModel");
  const [viewMode, setViewMode] = useState("tokens");
  const [sortBy, setSortBy] = useState("rawModel");
  const [sortOrder, setSortOrder] = useState("asc");

  const cfg = DIMENSIONS.find((d) => d.value === dimension);

  const groupedData = useMemo(() => {
    if (!stats || !cfg) return [];
    const rows = sortData(stats[dimension], sortBy, sortOrder);
    return groupDataByKey(rows, cfg.groupKey);
  }, [stats, dimension, cfg, sortBy, sortOrder]);

  const handleToggleSort = useCallback(
    (_tableType, field) => {
      setSortBy((prev) => {
        if (prev === field) {
          setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
          return prev;
        }
        setSortOrder("asc");
        return field;
      });
    },
    []
  );

  // Reset sort to a sane default when switching dimension, so we don't sort a
  // by-account column that doesn't exist in by-model.
  const changeDimension = useCallback((next) => {
    setDimension(next);
    const nextCfg = DIMENSIONS.find((d) => d.value === next);
    setSortBy(nextCfg?.groupKey || "rawModel");
    setSortOrder("asc");
  }, []);

  const renderer = RENDERERS[dimension];
  const dimCfg = DIMENSIONS.find((d) => d.value === dimension);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={DIMENSIONS.map((d) => ({ value: d.value, label: d.label }))}
          value={dimension}
          onChange={changeDimension}
          size="sm"
          className="overflow-x-auto"
        />
        <SegmentedControl
          options={VALUE_VIEWS}
          value={viewMode}
          onChange={setViewMode}
          size="sm"
        />
      </div>
      <div className="min-w-0">
        <UsageTable
          title={`Usage by ${dimCfg?.label || "Dimension"}`}
          columns={COLS[dimension]}
          groupedData={groupedData}
          tableType={dimension}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onToggleSort={handleToggleSort}
          viewMode={viewMode}
          storageKey={cfg?.storageKey || "ov-default"}
          renderDetailCells={renderer.detail}
          renderSummaryCells={renderer.summary}
          emptyMessage={EMPTY_MSG[dimension]}
        />
      </div>
    </div>
  );
}

OverviewBreakdownTable.propTypes = {
  stats: PropTypes.object,
  period: PropTypes.string,
};
