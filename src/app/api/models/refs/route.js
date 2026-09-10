import { NextResponse } from "next/server";
import { resolveModelRefCaps } from "open-sse/providers/refsResolve.js";
import { toClientCaps } from "@/shared/utils/modelCaps";

// POST /api/models/refs — resolve arbitrary model-reference strings (combo
// member format: "alias/model", "provider/model", nested-id refs like
// "xbyNara/deepseek/deepseek-v4-pro", or bare ids) into canonical provider +
// compact capabilities. The combos dashboard keys its badge/icon lookups by
// the EXACT stored member string, which never matches /api/models fullModel
// for bare/dynamic/aliased refs. Server-side resolution keeps ONE source of
// truth (same tables + alias handling the runtime uses). Read-only.

const MAX_REFS = 500;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const refs = Array.isArray(body?.refs) ? body.refs : null;
    if (!refs) {
      return NextResponse.json({ error: "refs array required" }, { status: 400 });
    }
    const out = {};
    for (const ref of refs.slice(0, MAX_REFS)) {
      if (typeof ref !== "string" || out[ref]) continue;
      const resolved = resolveModelRefCaps(ref);
      if (resolved) {
        out[ref] = { provider: resolved.provider, model: resolved.model, caps: toClientCaps(resolved.caps) };
      }
    }
    return NextResponse.json({ refs: out });
  } catch (error) {
    console.log("Error resolving model refs:", error);
    return NextResponse.json({ error: "Failed to resolve refs" }, { status: 500 });
  }
}
