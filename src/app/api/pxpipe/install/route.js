import { NextResponse } from "next/server";
import { installPxpipe } from "@/lib/pxpipe/manager.js";
import { unloadPxpipeModule } from "open-sse/rtk/pxpipe.js";

export const dynamic = "force-dynamic";

// POST /api/pxpipe/install — install or upgrade pxpipe-proxy npm package.
export async function POST() {
  try {
    unloadPxpipeModule(); // clear cache so new version loads on next request
    const result = installPxpipe();
    if (result.success) {
      return NextResponse.json({ success: true, version: result.version });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
