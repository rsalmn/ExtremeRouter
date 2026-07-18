import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";

// GET /api/providers/[id]/freebuff-profile
//
// Fetches the FreeBuff user profile (name, email, avatar, session expiry) by
// calling /api/auth/session with the connection's cookie. Used to display
// profile info in the provider detail page.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const rawCookie = connection.apiKey || "";
    let cookie = rawCookie.replace(/^Cookie:\s*/i, "").trim();
    // Bare UUID → wrap as session cookie
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cookie)) {
      cookie = `__Secure-next-auth.session-token=${cookie}`;
    }

    const res = await fetch("https://freebuff.com/api/auth/session", {
      method: "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      },
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    if (!res.ok) {
      return NextResponse.json({ error: `FreeBuff returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    if (!data?.user) {
      return NextResponse.json({ error: "No user in session" }, { status: 401 });
    }

    return NextResponse.json({
      name: data.user.name || data.user.email?.split("@")[0] || "User",
      email: data.user.email || "",
      image: data.user.image || "",
      expires: data.expires || null,
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to fetch profile" }, { status: 500 });
  }
}
