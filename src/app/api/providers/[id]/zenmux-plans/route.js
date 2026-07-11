import { NextResponse } from "next/server";
import { getZenmuxPlans, getZenmuxPlanForCtoken } from "open-sse/services/zenmuxModels.js";

// GET /api/providers/[id]/zenmux-plans
//
// Returns the list of ZenMux subscription plans (free/starter/pro/max/ultra)
// with model counts, for populating the plan-selector dropdown in the provider
// detail page. The data comes from ZenMux's public API (no auth required) and
// is cached for 1 hour server-side.
//
// Response shape:
//   {
//     plans: [
//       { planKey: "free", name: "Free Plan", price: 0, desc: "5 Flows/5h", modelCount: 26 },
//       { planKey: "starter", name: "Starter Plan", price: 20, desc: "50 Flows/5h", modelCount: 169 },
//       ...
//     ]
//   }
//
// Returns { plans: [] } on failure so the UI can degrade gracefully.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    // Only meaningful for zenmux-free; other providers get an empty list.
    if (id !== "zenmux-free") {
      return NextResponse.json({ plans: [] });
    }
    const plans = await getZenmuxPlans();
    return NextResponse.json({ plans: plans || [] });
  } catch {
    return NextResponse.json({ plans: [] });
  }
}

// POST /api/providers/[id]/zenmux-plans
//
// Auto-detect the user's subscription plan from their ctoken.
// Body: { ctoken: "<token>" } — the ctoken extracted from the user's cookie.
//
// Response:
//   { planKey: "free" | "starter" | "pro" | "max" | "ultra" | null }
//
// Returns { planKey: null } on any failure (invalid token, network error).
// The UI uses this to show the detected plan and pre-select the dropdown.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    if (id !== "zenmux-free") {
      return NextResponse.json({ planKey: null });
    }
    const body = await request.json().catch(() => ({}));
    const ctoken = body?.ctoken;
    if (!ctoken || typeof ctoken !== "string") {
      return NextResponse.json({ planKey: null });
    }
    const planKey = await getZenmuxPlanForCtoken(ctoken);
    return NextResponse.json({ planKey });
  } catch {
    return NextResponse.json({ planKey: null });
  }
}
