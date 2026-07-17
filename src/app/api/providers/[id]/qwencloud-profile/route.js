import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";

// GET /api/providers/[id]/qwencloud-profile
// Fetches QwenCloud user profile (email, avatar, uid) via account/info.json.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    let cookie = (connection.apiKey || "").replace(/^Cookie:\s*/i, "").trim();
    if (cookie.startsWith("cookie=")) cookie = cookie.slice(7).trim();
    // Strip bx-ua/bx-umidtoken
    cookie = cookie.replace(/bx-ua=[^\s;]+;?\s*/g, "").replace(/bx-umidtoken=[^\s;]+;?\s*/g, "").trim();

    const res = await fetch("https://home.qwencloud.com/api/account/info.json", {
      method: "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `QwenCloud returned ${res.status}` }, { status: res.status });
    }

    const json = await res.json();
    const d = json?.data;
    if (!d) return NextResponse.json({ error: "No user data" }, { status: 401 });

    return NextResponse.json({
      name: d.aliyunId?.split("@")[0] || `User ${d.currentId}`,
      email: d.aliyunId || "",
      image: d.headUrl || "",
      uid: d.currentId || "",
      channelId: d.channelId || "",
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to fetch profile" }, { status: 500 });
  }
}
