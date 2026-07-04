"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Card, CardSkeleton, SegmentedControl, EmptyState } from "@/shared/components";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";
import ProviderTopology from "../ProviderTopology";

import OverviewKpiRow from "./OverviewKpiRow";
import LiveActivityStrip from "./LiveActivityStrip";
import OverviewErrorDonut from "./OverviewErrorDonut";
import OverviewProviderChart from "./OverviewProviderChart";
import OverviewLatencyChart from "./OverviewLatencyChart";
import OverviewBreakdownTable from "./OverviewBreakdownTable";
import { useFetchJson } from "./useFetch";

// Stacked area for the tokens/cost view of the main chart is owned here so the
// SegmentedControl can swap underlying chart components without remounting data.
import StackedAreaChart from "@/shared/components/charts/StackedAreaChart";
import ErrorRateChart from "@/shared/components/charts/ErrorRateChart";
import LatencyChart from "@/shared/components/charts/LatencyChart";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fmt, fmtCost } from "./format";

// Keep only LLM-capable providers for the topology graph.
function isLLMProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}

const CHART_VIEWS = [
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
  { value: "latency", label: "Latency" },
  { value: "errors", label: "Errors" },
];

// A simple single-series area chart for the tokens/cost view of the main card.
// (StackedAreaChart covers the dedicated provider chart; here we want one line.)
function SimpleAreaChart({ data, dataKey, color }) {
  const gradId = `main-${dataKey}`;
  const stroke = `var(--color-${color})`;
  const hasData = data && data.some((d) => (Number(d?.[dataKey]) || 0) > 0);
  if (!hasData) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-text-muted">
        No data for this period
      </div>
    );
  }
  return (
    <div style={{ height: 260, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.4} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v) =>
              dataKey === "cost"
                ? fmtCost(v)
                : v >= 1000
                ? `${(v / 1000).toFixed(0)}k`
                : String(v)
            }
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-panel)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "10px",
              fontSize: "12px",
            }}
            formatter={(value) =>
              dataKey === "cost" ? [fmtCost(value), "Cost"] : [fmt(value), "Tokens"]
            }
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

SimpleAreaChart.propTypes = {
  data: PropTypes.arrayOf(PropTypes.object),
  dataKey: PropTypes.string.isRequired,
  color: PropTypes.string.isRequired,
};

export default function OverviewTab({ period }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState([]);

  // Main chart: view selector + its own data fetch keyed on (view, period).
  const [chartView, setChartView] = useState("tokens");
  const chartUrl = `/api/usage/chart?view=${chartView}&period=${period}`;
  const { data: chartData, loading: chartLoading } = useFetchJson(chartUrl, {
    initial: null,
    deps: [chartView, period],
  });

  const hasLoadedStats = useRef(false);
  const statsReqRef = useRef(0);

  // ---- connected providers (for topology) — fetched once ----
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/providers").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/provider-nodes").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([d, nodesData]) => {
        if (cancelled) return;
        const nodeNameMap = {};
        for (const node of nodesData?.nodes || []) nodeNameMap[node.id] = node.name;
        const seen = new Set();
        const unique = (d?.connections || [])
          .filter((c) => c.isActive !== false && isLLMProvider(c.provider) && !seen.has(c.provider) && seen.add(c.provider))
          .map((c) => ({ ...c, nodeName: nodeNameMap[c.provider] || null }));
        const noAuth = Object.values(FREE_PROVIDERS)
          .filter((p) => p.noAuth && !seen.has(p.id) && isLLMProvider(p.id))
          .map((p) => ({ provider: p.id, name: p.name }));
        setProviders([...unique, ...noAuth]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- stats fetch on period change ----
  // Stale-while-revalidate: keep showing previous period's data while the new
  // one loads (no skeleton flash on period switch). All setState happens in
  // async callbacks to satisfy react-hooks/set-state-in-effect. On the very
  // first load, `loading` is initialised true so the skeleton shows.
  useEffect(() => {
    const myToken = ++statsReqRef.current; // synchronous ref bump, no setState
    let cancelled = false;
    fetch(`/api/usage/stats?period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || statsReqRef.current !== myToken) return;
        if (data) {
          hasLoadedStats.current = true;
          setStats((prev) => ({ ...prev, ...data }));
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || statsReqRef.current !== myToken) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  // ---- SSE: live updates for the real-time fields only ----
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => {
          if (!prev) return prev; // never overwrite REST payload before it lands
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
            pending: data.pending,
            statusCounts: data.statusCounts ?? prev.statusCounts,
            errorRate: data.errorRate ?? prev.errorRate,
            errorCount: data.errorCount ?? prev.errorCount,
            latency: data.latency ?? prev.latency,
          };
        });
        if (hasLoadedStats.current) setLoading(false);
      } catch {
        /* swallow parse errors */
      }
    };
    es.onerror = () => {
      if (hasLoadedStats.current) setLoading(false);
    };
    return () => es.close();
  }, []);

  const renderMainChart = useCallback(() => {
    if (chartLoading || !chartData) {
      return <CardSkeleton />;
    }
    if (!chartData.length) {
      return (
        <div className="flex h-[260px] items-center justify-center">
          <EmptyState
            icon="show_chart"
            title="No chart data"
            description="No requests recorded for this view in the selected period."
            className="border-0 p-0"
          />
        </div>
      );
    }
    switch (chartView) {
      case "tokens":
        return <SimpleAreaChart data={chartData} dataKey="tokens" color="primary" />;
      case "cost":
        return <SimpleAreaChart data={chartData} dataKey="cost" color="warning" />;
      case "latency":
        return <LatencyChart data={chartData} height={260} />;
      case "errors":
        return <ErrorRateChart data={chartData} height={260} />;
      default:
        return null;
    }
  }, [chartData, chartLoading, chartView]);

  const lastProvider = useMemo(
    () => stats?.recentRequests?.[0]?.provider || "",
    [stats]
  );

  if (loading && !stats) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <CardSkeleton />
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <EmptyState
        icon="cloud_off"
        title="Couldn't load usage"
        description="We failed to fetch usage statistics. Please try again."
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
      {/* KPI row */}
      <OverviewKpiRow stats={stats} />

      {/* Live activity */}
      <LiveActivityStrip stats={stats} />

      {/* Charts row: main chart (left) + error donut (right) */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] lg:gap-6">
        <Card
          title="Usage Trend"
          icon="monitoring"
          action={
            <SegmentedControl
              options={CHART_VIEWS}
              value={chartView}
              onChange={setChartView}
              size="sm"
            />
          }
        >
          {renderMainChart()}
        </Card>
        <OverviewErrorDonut stats={stats} />
      </div>

      {/* Provider stacked chart (full width) */}
      <OverviewProviderChart period={period} />

      {/* Latency chart (full width) */}
      <OverviewLatencyChart period={period} stats={stats} />

      {/* Breakdown table */}
      <OverviewBreakdownTable stats={stats} period={period} />

      {/* Provider topology */}
      <Card title="Provider Topology" subtitle="Live routing state across connected providers" icon="hub">
        <ProviderTopology
          providers={providers}
          activeRequests={stats.activeRequests || []}
          lastProvider={lastProvider}
          errorProvider={stats.errorProvider || ""}
        />
      </Card>
    </div>
  );
}

OverviewTab.propTypes = {
  period: PropTypes.string,
};
