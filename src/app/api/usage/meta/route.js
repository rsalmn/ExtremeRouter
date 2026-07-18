import { NextResponse } from "next/server";
import { getMeta } from "@/lib/db/helpers/metaStore";
import { getUsageStats } from "@/lib/usageDb";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { getProviderConnections } from "@/lib/localDb";
import { FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS } from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage/meta
 * Returns lifetime totals + free/cookie provider breakdown for the Overview page.
 */
export async function GET() {
  try {
    const [
      requestsRaw, savedRaw,
      rtkSaved, headroomSaved, pxpipeSaved, cacheSaved, cavemanSaved, ponytailSaved,
      cacheHitsRaw,
      stats, settings, connections,
    ] = await Promise.all([
      getMeta("totalRequestsLifetime", "0"),
      getMeta("tokensSavedLifetime", "0"),
      getMeta("tokensSavedLifetime.rtk", "0"),
      getMeta("tokensSavedLifetime.headroom", "0"),
      getMeta("tokensSavedLifetime.pxpipe", "0"),
      getMeta("tokensSavedLifetime.cache", "0"),
      getMeta("tokensSavedLifetime.caveman", "0"),
      getMeta("tokensSavedLifetime.ponytail", "0"),
      getMeta("semanticCacheHitsLifetime", "0"),
      getUsageStats("all"),
      getSettings(),
      getProviderConnections(),
    ]);

    const freeIds = new Set([
      ...Object.keys(FREE_PROVIDERS),
      ...Object.keys(FREE_TIER_PROVIDERS),
      ...Object.keys(WEB_COOKIE_PROVIDERS),
    ]);

    // Build usage map from stats.byProvider
    const usageMap = {};
    for (const [id, data] of Object.entries(stats.byProvider || {})) {
      usageMap[id] = {
        requests: data.requests || 0,
        tokens: (data.promptTokens || 0) + (data.completionTokens || 0),
      };
    }

    // Build connected set from actual connections
    const connectedIds = new Set(
      connections
        .filter((c) => freeIds.has(c.provider) && c.isActive !== false)
        .map((c) => c.provider)
    );

    // Merge: show all connected free/cookie providers + any with usage data
    const allIds = new Set([...Object.keys(usageMap), ...connectedIds]);
    const freeProviders = [...allIds]
      .filter((id) => freeIds.has(id))
      .map((id) => {
        const info = FREE_PROVIDERS[id] || FREE_TIER_PROVIDERS[id] || WEB_COOKIE_PROVIDERS[id] || {};
        const usage = usageMap[id] || { requests: 0, tokens: 0 };
        return {
          id,
          name: info.name || id,
          icon: info.icon || "smart_toy",
          color: info.color || "#6b7280",
          requests: usage.requests,
          tokens: usage.tokens,
          connected: connectedIds.has(id),
        };
      })
      .sort((a, b) => b.requests - a.requests || (b.connected ? 1 : 0) - (a.connected ? 1 : 0));

    return NextResponse.json({
      totalRequestsLifetime: parseInt(requestsRaw, 10) || 0,
      tokensSavedLifetime: parseInt(savedRaw, 10) || 0,
      // Per-mechanism lifetime breakdown so the Overview dashboard can attribute
      // savings to each saver. Falls back to 0 when no counter exists yet
      // (pre-feature installs only have the legacy aggregate `tokensSavedLifetime`).
      tokensSavedByMechanism: {
        rtk: parseInt(rtkSaved, 10) || 0,
        headroom: parseInt(headroomSaved, 10) || 0,
        pxpipe: parseInt(pxpipeSaved, 10) || 0,
        cache: parseInt(cacheSaved, 10) || 0,
        caveman: parseInt(cavemanSaved, 10) || 0,
        ponytail: parseInt(ponytailSaved, 10) || 0,
      },
      semanticCacheHits: parseInt(cacheHitsRaw, 10) || 0,
      totalCachedTokens: stats.totalCachedTokens || 0,
      freeProviders,
      tokenSaverSettings: {
        rtkEnabled: settings.rtkEnabled !== false,
        headroomEnabled: !!settings.headroomEnabled,
        pxpipeEnabled: !!settings.pxpipeEnabled,
        semanticCacheEnabled: !!settings.semanticCacheEnabled,
        cavemanEnabled: !!settings.cavemanEnabled,
        ponytailEnabled: !!settings.ponytailEnabled,
      },
    });
  } catch (error) {
    console.error("[API] Failed to get overview meta:", error);
    return NextResponse.json({ error: "Failed to fetch overview data" }, { status: 500 });
  }
}
