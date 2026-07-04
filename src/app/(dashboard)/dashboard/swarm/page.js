import PageHeader from "@/shared/components/PageHeader";
import SwarmTelemetryMonitor from "@/shared/components/SwarmTelemetryMonitor";

export const dynamic = "force-dynamic";

export default function SwarmPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Swarm Telemetry"
        description="Live Hierarchical Swarm orchestration pipeline"
        icon="hub"
      />
      <SwarmTelemetryMonitor />
    </div>
  );
}
