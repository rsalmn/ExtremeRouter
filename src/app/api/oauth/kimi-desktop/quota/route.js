/*
 * GET /api/oauth/kimi-desktop/quota
 *
 * Returns the current quota view for the Kimi desktop connection (tier, usage
 * detail, my quota). Reads the local desktop token store — the same file the
 * auto-import flow uses.
 */
import { NextResponse } from "next/server";
import { getKimiDesktopQuota } from "@/lib/oauth/services/kimi-desktop-quota";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const quota = await getKimiDesktopQuota();
    if (!quota) {
      return NextResponse.json(
        {
          found: false,
          error:
            "Kimi Desktop token store not found. Log in on the Kimi desktop app so it writes its session file.",
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ found: true, quota });
  } catch (error) {
    return NextResponse.json(
      { found: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
