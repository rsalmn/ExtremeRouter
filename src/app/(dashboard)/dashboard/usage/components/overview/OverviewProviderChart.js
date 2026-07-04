"use client";

import { useMemo } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import { CardSkeleton } from "@/shared/components/Loading";
import EmptyState from "@/shared/components/EmptyState";
import StackedAreaChart from "@/shared/components/charts/StackedAreaChart";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { useFetchJson } from "./useFetch";

// Derive the providers list from the actual data keys (every key except "label"
// is a providerId, with "Other" being the server's overflow bucket). Order by
// total tokens across all buckets so the biggest contributor sits on the bottom
// of the stack for visual stability.
function deriveProviders(data) {
  if (!data || data.length === 0) return [];
  const totals = {};
  for (const row of data) {
    for (const [key, val] of Object.entries(row)) {
      if (key === "label") continue;
      totals[key] = (totals[key] || 0) + (Number(val) || 0);
    }
  }
  return Object.keys(totals)
    .sort((a, b) => totals[b] - totals[a])
    .map((id) => ({ id, name: AI_PROVIDERS[id]?.name || id }));
}

export default function OverviewProviderChart({ period }) {
  const url = `/api/usage/chart?view=stacked&period=${period}`;
  const { data: rawData, loading } = useFetchJson(url, {
    initial: null,
    deps: [period],
  });

  const data = useMemo(
    () => (Array.isArray(rawData) ? rawData : []),
    [rawData]
  );
  const providers = useMemo(() => deriveProviders(data), [data]);
  const hasData = data.length > 0 && providers.length > 0;

  return (
    <Card
      title="Token Share by Provider"
      subtitle="Stacked token volume per provider over the selected period"
      icon="stacked_bar_chart"
    >
      {loading ? (
        <CardSkeleton />
      ) : !hasData ? (
        <div className="flex items-center justify-center py-6">
          <EmptyState
            icon="stacked_bar_chart"
            title="No provider breakdown"
            description="No token volume recorded for this period yet."
            className="border-0 p-0"
          />
        </div>
      ) : (
        <StackedAreaChart data={data} providers={providers} height={280} />
      )}
    </Card>
  );
}

OverviewProviderChart.propTypes = {
  period: PropTypes.string,
};
