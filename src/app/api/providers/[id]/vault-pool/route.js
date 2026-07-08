import { NextResponse } from "next/server";
import { getPoolStats } from "open-sse/services/credentialVault.js";

// GET /api/providers/[id]/vault-pool
//
// Returns aggregate stats for a provider's admin-provided key pool WITHOUT
// exposing any key material. Used by the provider detail page to show users
// that shared pool keys are available even when they haven't added their own
// connection.
//
// Response shape:
//   {
//     hasPool: true,                    // false if provider has no vault seed
//     total: 69,                        // total keys in pool
//     available: 67,                    // keys not currently rate-limited
//     rateLimited: 2,                   // keys in cooldown
//     status: "healthy" | "degraded" | "exhausted"
//   }
//
// status logic:
//   - "healthy"   — all (or nearly all) keys available
//   - "degraded"  — some keys rate-limited but pool still usable
//   - "exhausted" — every key is rate-limited (pool unusable right now)
//
// Security: this endpoint NEVER returns key names, blobs, or any plaintext.
// Only aggregate counts. Safe to expose to authenticated dashboard users.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const stats = getPoolStats(id);

    if (!stats) {
      // Provider has no vault pool — return hasPool: false so the UI knows to
      // hide the badge entirely (rather than show "0 keys").
      return NextResponse.json({ hasPool: false });
    }

    // Derive a coarse status from the available/total ratio. Thresholds are
    // intentionally simple — this is a UX hint, not an SLO.
    const ratio = stats.total > 0 ? stats.available / stats.total : 0;
    let status;
    if (stats.available === 0) status = "exhausted";
    else if (ratio >= 0.9) status = "healthy";
    else status = "degraded";

    return NextResponse.json({
      hasPool: true,
      total: stats.total,
      available: stats.available,
      rateLimited: stats.rateLimited,
      status,
    });
  } catch (err) {
    // Vault module failures (env unset, tampered) collapse to hasPool: false
    // so the UI hides the badge rather than showing an error to the user.
    return NextResponse.json({ hasPool: false });
  }
}
