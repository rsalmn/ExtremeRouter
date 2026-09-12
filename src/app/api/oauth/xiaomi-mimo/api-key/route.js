import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { readDesktopPassToken } from "open-sse/shared/mimoAccount.js";

const VALIDATE_URL = "https://api.xiaomimimo.com/v1/models";

/**
 * POST /api/oauth/xiaomi-mimo/api-key
 * Connect a Xiaomi MiMo API key (sk-). Optionally also persist the local
 * Desktop passToken so the account-session endpoints (Preview models, weekly
 * quota) work without a separate browser sign-in.
 */
export async function POST(request) {
  try {
    const { apiKey, desktopLinked, passToken: bodyPassToken } = await request.json();

    // Desktop-only import: no sk- key, just the account passToken. This path
    // skips cloud validation — the passToken itself is the credential.
    if (desktopLinked) {
      const desktop = await readDesktopPassToken().catch(() => null);
      const passToken = bodyPassToken || desktop?.passToken;
      if (!passToken) {
        return NextResponse.json({ error: "No MiMo Desktop passToken available" }, { status: 400 });
      }
      const connection = await createProviderConnection({
        provider: "xiaomi-mimo",
        authType: "oauth",
        providerSpecificData: {
          authMethod: "desktop_session",
          mimoPassToken: passToken,
          mimoUserId: desktop?.userId || null,
          mimoCUserId: desktop?.cUserId || null,
        },
        testStatus: "active",
      });
      return NextResponse.json({
        success: true,
        connection: { id: connection.id, provider: connection.provider, email: connection.email || null },
        desktopLinked: true,
      });
    }

    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "API key is required" }, { status: 400 });
    }
    const key = apiKey.trim();

    // Validate against the cloud API before persisting — a bad key must not
    // become a connection the user then has to delete.
    const res = await fetch(VALIDATE_URL, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!res) {
      return NextResponse.json({ error: "Could not reach the Xiaomi MiMo API" }, { status: 502 });
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `API returned ${res.status}` }, { status: 502 });
    }

    // Fold in the Desktop passToken when present — it unlocks the Preview
    // models and weekly quota that the sk- key alone cannot reach.
    const providerSpecificData = { authMethod: "api_key" };
    const desktop = await readDesktopPassToken().catch(() => null);
    if (desktop?.passToken) {
      providerSpecificData.mimoPassToken = desktop.passToken;
      providerSpecificData.mimoUserId = desktop.userId || null;
      providerSpecificData.mimoCUserId = desktop.cUserId || null;
    }

    const connection = await createProviderConnection({
      provider: "xiaomi-mimo",
      authType: "api_key",
      apiKey: key,
      providerSpecificData,
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email || null,
      },
      desktopLinked: !!desktop?.passToken,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "API key import failed" }, { status: 500 });
  }
}
