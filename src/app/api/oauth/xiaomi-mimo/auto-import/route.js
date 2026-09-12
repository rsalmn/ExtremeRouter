import { NextResponse } from "next/server";
import { readDesktopPassToken } from "open-sse/shared/mimoAccount.js";

/**
 * GET /api/oauth/xiaomi-mimo/auto-import
 * One-click import of the local MiMo Desktop credentials.
 *
 * Reads the Xiaomi account passToken persisted in Desktop's Chromium cookie
 * store. The passToken is what enables the account-session handshake (Preview
 * models + weekly quota); the sk- API key alone cannot reach those endpoints.
 */
export async function GET() {
  try {
    const desktop = await readDesktopPassToken();
    if (!desktop?.passToken) {
      return NextResponse.json({
        found: false,
        error:
          "MiMo Desktop account cookie not found. Install and sign in to MiMo Desktop once, then retry — or connect with an API key / browser sign-in instead.",
      });
    }

    return NextResponse.json({
      found: true,
      passToken: desktop.passToken,
      userId: desktop.userId || null,
      cUserId: desktop.cUserId || null,
      source: "MiMo Desktop cookie store",
    });
  } catch (error) {
    return NextResponse.json({ found: false, error: error.message }, { status: 500 });
  }
}
