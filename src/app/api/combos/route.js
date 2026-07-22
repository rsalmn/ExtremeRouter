import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";
import { VALID_NAME_REGEX } from "@/app/(dashboard)/dashboard/combos/components/helpers";

export const dynamic = "force-dynamic";

// GET /api/combos - Get all combos
export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, kind } = body;

    if (!name || typeof name !== "string" || name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format (single source of truth — imported from helpers)
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    // M1 FIX: validate models is an array of strings. A non-array (string or
    // object) would be stringified into the DB column and crash the engine's
    // getComboModelsFromData which expects an array and calls .find() on it.
    if (models !== undefined && (!Array.isArray(models) || !models.every((m) => typeof m === "string"))) {
      return NextResponse.json({ error: "Models must be an array of strings" }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const combo = await createCombo({ name, models: Array.isArray(models) ? models : [], kind: kind || null });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
