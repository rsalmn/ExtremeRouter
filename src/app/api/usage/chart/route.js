import { NextResponse } from "next/server";
import {
  getChartData,
  getStackedChartData,
  getLatencyChartData,
  getErrorChartData,
} from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    const view = (searchParams.get("view") || "tokens").toLowerCase();

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    // Dispatch by view. "tokens"/"cost" return the legacy single-series shape
    // (backward-compat). "stacked"/"latency"/"errors" return new shapes.
    let data;
    if (view === "stacked") data = await getStackedChartData(period);
    else if (view === "latency") data = await getLatencyChartData(period);
    else if (view === "errors") data = await getErrorChartData(period);
    else data = await getChartData(period); // tokens | cost (single series)

    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
