import { NextResponse } from "next/server";
import { getRetryStats } from "@/lib/db/repos/usageRepo";

export const dynamic = "force-dynamic";

// GET /api/usage/retry-stats?period=7d
// Returns retry statistics for the usage dashboard.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    const data = await getRetryStats(period);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ totalRequests: 0, retriedRequests: 0, totalRetries: 0, retryRate: 0, byProvider: [] });
  }
}
