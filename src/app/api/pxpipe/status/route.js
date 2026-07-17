import { NextResponse } from "next/server";
import { getPxpipeStatus } from "@/lib/pxpipe/manager.js";
import { isPxpipeLoaded } from "open-sse/rtk/pxpipe.js";

export const dynamic = "force-dynamic";

// GET /api/pxpipe/status — returns install status + module loaded state.
export async function GET() {
  try {
    const status = getPxpipeStatus();
    return NextResponse.json({ ...status, loaded: isPxpipeLoaded() });
  } catch (error) {
    return NextResponse.json({ installed: false, loaded: false, error: error.message }, { status: 500 });
  }
}
