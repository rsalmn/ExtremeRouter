import { NextResponse } from "next/server";
import { getProviderHealthTimeline } from "@/lib/db/repos/usageRepo";

// GET /api/providers/[id]/health-timeline?hours=24
//
// Returns hourly health buckets for a provider: success/error counts + avg latency.
// Used by the HealthTimeline sparkline in the provider detail page.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const hours = Math.min(Math.max(parseInt(searchParams.get("hours") || "24", 10), 1), 168);
    const data = await getProviderHealthTimeline(id, hours);
    return NextResponse.json({ timeline: data });
  } catch {
    return NextResponse.json({ timeline: [] });
  }
}
