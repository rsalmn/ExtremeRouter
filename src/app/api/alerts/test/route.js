import { NextResponse } from "next/server";
import { dispatchAlert } from "@/shared/services/alertService";

// POST /api/alerts/test — send a test alert to all configured webhook channels.
export async function POST() {
  try {
    await dispatchAlert("test", {
      message: "✅ Test alert from ExtremeRouter — your webhook configuration is working!",
    });
    return NextResponse.json({ success: true, message: "Test alert dispatched" });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to send test alert" }, { status: 500 });
  }
}
