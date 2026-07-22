import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName, getSettings, updateSettings } from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";
import { VALID_NAME_REGEX } from "@/app/(dashboard)/dashboard/combos/components/helpers";

// comboStrategies is keyed by combo name (see chat.js:161, CombosPageInner.js:96).
// When a combo is renamed or deleted we MUST keep that map consistent or two
// bugs appear: (1) rename silently reverts a fusion/swarm combo to plain
// fallback because its strategy entry stays under the OLD name; (2) delete
// leaves an orphan entry that a later combo reusing the same name inherits.
//
// These helpers build a PARTIAL patch (not a full snapshot) that is compatible
// with the deep-merge in settingsRepo.updateSettings: a null value signals
// deletion of that combo-name key. Sending a full snapshot would race with
// concurrent edits to other combos (the very bug H2 fixed) AND would fail to
// delete keys (the deep-merge only deletes when it sees `{ [key]: null }`).

// Build a patch that migrates an entry from oldName → newName.
// Returns null if there's nothing to migrate (no-op).
function buildMigratePatch(comboStrategies, oldName, newName) {
  if (!comboStrategies || typeof comboStrategies !== "object") return null;
  if (oldName === newName) return null;
  const hasOld = oldName in comboStrategies;
  const hasNew = newName in comboStrategies;
  if (!hasOld && !hasNew) return null;
  const patch = {};
  if (hasOld) {
    // Move the entry forward ( newName wins if both exist, matching prior behavior ).
    patch[newName] = comboStrategies[oldName];
    // Signal deletion of the old key so the deep-merge removes it. Without this,
    // the old entry would survive as an orphan — the exact C1 bug we're fixing.
    patch[oldName] = null;
  }
  return patch;
}

// Build a patch that removes an entry by name.
// Returns null if the entry doesn't exist (no-op).
function buildRemovePatch(comboStrategies, name) {
  if (!comboStrategies || typeof comboStrategies !== "object" || !(name in comboStrategies)) return null;
  // null signals deletion to the deep-merge in updateSettings.
  return { [name]: null };
}

// Apply a partial comboStrategies patch via the deep-merge path. No-op if the
// transform returns null (nothing to change).
async function patchComboStrategies(buildPatch) {
  const settings = await getSettings();
  const current = settings?.comboStrategies || {};
  const patch = buildPatch(current);
  if (!patch) return;
  await updateSettings({ comboStrategies: patch });
}

// GET /api/combos/[id] - Get combo by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate name: explicit presence check (body.name === "" previously
    // bypassed validation because "" is falsy under `if (body.name)`, storing
    // an empty name and breaking getComboModels lookups downstream).
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        return NextResponse.json({ error: "Name must be a non-empty string" }, { status: 400 });
      }
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }

      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(body.name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }

    // M1: validate models is an array of strings if provided — the engine's
    // getComboModelsFromData expects an array; a non-array value (string/object)
    // would be stringified into the column and crash .find() at request time.
    if (body.models !== undefined) {
      if (!Array.isArray(body.models) || !body.models.every((m) => typeof m === "string")) {
        return NextResponse.json({ error: "Models must be an array of strings" }, { status: 400 });
      }
    }

    // Capture previous name to invalidate rotation state on rename + migrate
    // comboStrategies entry so fusion/swarm config survives a rename.
    const prev = await getComboById(id);
    const combo = await updateCombo(id, body);

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    // Invalidate rotation state (models/strategy/name may have changed)
    if (prev?.name) resetComboRotation(prev.name);
    if (combo.name && combo.name !== prev?.name) resetComboRotation(combo.name);

    // C1 FIX: migrate comboStrategies entry when a combo is renamed, so the
    // per-combo fusion/swarm config (judgeModel/managerModel/staffModel/
    // auditModel) doesn't silently revert to plain fallback under the old name.
    // Sends a partial patch ({ newName: entry, oldName: null }) compatible with
    // the deep-merge in updateSettings — the null deletes the old key.
    if (prev?.name && combo.name && prev.name !== combo.name) {
      await patchComboStrategies((cs) => buildMigratePatch(cs, prev.name, combo.name));
    }

    // L3 FIX: combosRepo.updateCombo returns a `{...row, ...data}` merge that
    // can carry arbitrary client-injected fields through to the response. Only
    // return the canonical combo shape so we don't leak untrusted keys back.
    const { id: _rid, name, kind, models, createdAt, updatedAt } = combo;
    return NextResponse.json({ id, name, kind, models, createdAt, updatedAt });
  } catch (error) {
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const prev = await getComboById(id);
    const success = await deleteCombo(id);

    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(prev.name);

    // C1 FIX: remove the orphaned comboStrategies entry so a later combo that
    // reuses this name doesn't silently inherit the deleted combo's strategy.
    // Sends { [name]: null } so the deep-merge deletes the key.
    if (prev?.name) {
      await patchComboStrategies((cs) => buildRemovePatch(cs, prev.name));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
