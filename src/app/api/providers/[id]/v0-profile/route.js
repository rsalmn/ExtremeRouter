import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";

// GET /api/providers/[id]/v0-profile
//
// Fetches the v0.app user profile + credit balance by calling:
//   1. /api/auth/info → user info (name, email, avatar, plan)
//   2. /chat/api/plan-info → credit balance (remaining, total, billing cycle)
//
// Used to display profile + balance info in the provider detail page.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const cookie = (connection.apiKey || "").replace(/^Cookie:\s*/i, "").trim();
    if (!cookie) {
      return NextResponse.json({ error: "No cookie" }, { status: 400 });
    }

    const headers = {
      Cookie: cookie,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    };

    // Fetch profile + balance in parallel
    const [profileRes, balanceRes] = await Promise.allSettled([
      fetch("https://v0.app/api/auth/info", { method: "GET", headers }),
      fetch("https://v0.app/chat/api/plan-info", { method: "GET", headers }),
    ]);

    // Profile
    let profile = null;
    if (profileRes.status === "fulfilled" && profileRes.value.ok) {
      const data = await profileRes.value.json().catch(() => null);
      if (data?.user) {
        const u = data.user;
        profile = {
          name: u.name || u.username || u.email?.split("@")[0] || "User",
          email: u.email || "",
          image: u.avatar || "",
          plan: u.v0plan || u.plan || "free",
          username: u.username || "",
          teamName: u.teamName || "",
        };
      }
    }

    // Balance
    let balance = null;
    if (balanceRes.status === "fulfilled" && balanceRes.value.ok) {
      const data = await balanceRes.value.json().catch(() => null);
      if (data?.balance) {
        balance = {
          remaining: data.balance.remaining ?? 0,
          total: data.balance.total ?? 0,
          onDemand: data.onDemand?.spendableBalance ?? 0,
        };
      }
      if (data?.billingCycle) {
        balance = balance || {};
        balance.billingStart = data.billingCycle.start;
        balance.billingEnd = data.billingCycle.end;
      }
    }

    if (!profile && !balance) {
      return NextResponse.json({ error: "Session expired or invalid" }, { status: 401 });
    }

    return NextResponse.json({ profile, balance });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to fetch v0 profile" }, { status: 500 });
  }
}
