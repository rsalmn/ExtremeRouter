import { NextResponse } from "next/server";
import { getCacheStats, clearCache } from "open-sse/services/semanticCache.js";

// GET /api/cache — return semantic cache statistics for dashboard display.
export async function GET() {
  try {
    const stats = getCacheStats();
    return NextResponse.json(stats);
  } catch {
    return NextResponse.json({ size: 0, hits: 0, misses: 0, hitRate: 0 });
  }
}

// DELETE /api/cache — clear all cached entries.
export async function DELETE() {
  try {
    const cleared = clearCache();
    return NextResponse.json({ success: true, cleared });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to clear cache" }, { status: 500 });
  }
}
