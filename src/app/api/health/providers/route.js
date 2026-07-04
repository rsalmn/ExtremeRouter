import { getAllProviderHealth } from "open-sse/services/healthMonitor.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/providers — one-shot snapshot of all provider health.
 */
export async function GET() {
  return Response.json({ providers: getAllProviderHealth() });
}
