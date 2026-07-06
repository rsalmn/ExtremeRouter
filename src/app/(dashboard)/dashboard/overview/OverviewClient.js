"use client";

import { useState, useEffect } from "react";
import { Card, PageHeader, CardSkeleton } from "@/shared/components";
import OverviewKpiCards from "./components/OverviewKpiCards";
import TokenSaverStatus from "./components/TokenSaverStatus";
import FreeProvidersGrid from "./components/FreeProvidersGrid";

export default function OverviewClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/usage/meta")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Overview" description="Gateway summary, savings, and free-tier usage" icon="dashboard" />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Gateway summary, savings, and free-tier usage"
        icon="dashboard"
      />

      {/* Hero KPI cards */}
      <OverviewKpiCards data={data} />

      {/* Token Saver status */}
      <Card
        title="Token Savers"
        subtitle="Input compression and output optimization"
        icon="savings"
        padding="sm"
      >
        <TokenSaverStatus settings={data?.tokenSaverSettings} />
      </Card>

      {/* Free Providers Used */}
      <Card
        title="Free Providers Used"
        subtitle="Providers with no API cost routing through your gateway"
        icon="redeem"
        padding="sm"
      >
        <FreeProvidersGrid providers={data?.freeProviders || []} />
      </Card>
    </div>
  );
}
