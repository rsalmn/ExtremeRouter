"use client";

import { useMemo } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import { CardSkeleton } from "@/shared/components/Loading";
import EmptyState from "@/shared/components/EmptyState";
import LatencyChart from "@/shared/components/charts/LatencyChart";
import { fmt, fmtMs } from "./format";
import { useFetchJson } from "./useFetch";

export default function OverviewLatencyChart({ period, stats }) {
  const url = `/api/usage/chart?view=latency&period=${period}`;
  const { data: rawData, loading } = useFetchJson(url, {
    initial: null,
    deps: [period],
  });

  const data = useMemo(
    () => (Array.isArray(rawData) ? rawData : []),
    [rawData]
  );

  // Summary row: prefer the authoritative stats.latency, else fall back to the
  // last chart bucket's avg/p95. p50 isn't in the chart payload, so use stats.
  const summary = useMemo(() => {
    if (stats?.latency && (stats.latency.avg != null || stats.latency.p95 != null)) {
      return {
        avg: stats.latency.avg,
        p50: stats.latency.p50,
        p95: stats.latency.p95,
        samples: stats.latency.sampleCount,
      };
    }
    const tail = data.length ? data[data.length - 1] : null;
    if (tail) {
      return { avg: tail.avgMs, p50: null, p95: tail.p95Ms, samples: tail.samples };
    }
    return null;
  }, [stats, data]);

  const hasData = data.length > 0;

  return (
    <Card
      title="Latency (avg vs p95)"
      subtitle="Response time distribution over the selected period"
      icon="timer"
    >
      {loading ? (
        <CardSkeleton />
      ) : !hasData ? (
        <div className="flex items-center justify-center py-6">
          <EmptyState
            icon="timer"
            title="No latency data"
            description="Latency samples will appear here once requests complete."
            className="border-0 p-0"
          />
        </div>
      ) : (
        <>
          {summary && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryStat label="Avg" value={summary.avg != null ? fmtMs(summary.avg) : "—"} />
              <SummaryStat label="p50" value={summary.p50 != null ? fmtMs(summary.p50) : "—"} />
              <SummaryStat label="p95" value={summary.p95 != null ? fmtMs(summary.p95) : "—"} accent />
              <SummaryStat
                label="Samples"
                value={summary.samples != null ? fmt(summary.samples) : "—"}
              />
            </div>
          )}
          <LatencyChart data={data} height={240} />
        </>
      )}
    </Card>
  );
}

function SummaryStat({ label, value, accent = false }) {
  return (
    <div className="rounded-brand border border-border-subtle bg-surface-2 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div
        className={`truncate text-sm font-semibold ${accent ? "text-cyan" : "text-text-main"}`}
      >
        {value}
      </div>
    </div>
  );
}

SummaryStat.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  accent: PropTypes.bool,
};

OverviewLatencyChart.propTypes = {
  period: PropTypes.string,
  stats: PropTypes.object,
};
