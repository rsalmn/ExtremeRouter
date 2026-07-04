import { getRecentSwarms } from "open-sse/services/swarmTelemetry.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/swarm/active — one-shot snapshot of recent swarm runs.
 * Used for dashboard initial load without SSE.
 */
export async function GET() {
  return Response.json({ runs: getRecentSwarms(20) });
}
