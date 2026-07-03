import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * One-time migration of user data from the legacy ~/.9router (or %APPDATA%/9router)
 * location to the new ExtremeRouter home.
 *
 * Strategy (idempotent, non-destructive):
 *  1. Resolve legacy dir based on platform (mirrors old dataDir.js).
 *  2. Resolve new dir from newDataDir argument.
 *  3. If legacy dir missing OR new dir already has data → nothing to do.
 *  4. Copy (not move) the legacy tree into the new dir so users can roll back.
 *  5. Write a `.migrated-from` marker in the new dir so we never re-run.
 *
 * Designed to run synchronously at process boot, before the DB is opened.
 * Failures are logged to stderr and swallowed — the app must still boot.
 */
export function migrateFromLegacy(newDataDir) {
  if (!newDataDir) return false;
  try {
    const marker = path.join(newDataDir, ".migrated-from");
    if (fs.existsSync(marker)) return false; // already migrated

    const legacy = resolveLegacyDir();
    if (!legacy || !fs.existsSync(legacy)) {
      // No legacy data; just stamp the marker so we never scan again.
      fs.mkdirSync(newDataDir, { recursive: true });
      fs.writeFileSync(marker, "none\n");
      return false;
    }

    // If new dir already has real content, assume user is ahead of us.
    const existing = listSignificantFiles(newDataDir);
    if (existing.length > 0) {
      fs.writeFileSync(marker, "skipped: new dir already populated\n");
      return false;
    }

    fs.mkdirSync(newDataDir, { recursive: true });
    copyDir(legacy, newDataDir);
    fs.writeFileSync(marker, `${legacy}\n`);
    console.log(`[extremerouter] migrated data from ${legacy} → ${newDataDir}`);
    return true;
  } catch (e) {
    console.warn(`[extremerouter] data migration skipped: ${e?.message || e}`);
    return false;
  }
}

function resolveLegacyDir() {
  // Windows: %APPDATA%/9router ; Unix: ~/.9router
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

// Files that indicate the dir actually holds user data (not just runtime/cache).
function listSignificantFiles(dir) {
  const significant = ["db.sqlite", "db.json", "usage.json", "settings.json"];
  const out = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (significant.includes(name)) out.push(name);
    }
  } catch {
    // dir may not exist yet
  }
  return out;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // Skip the runtime dir — it holds native deps tied to the legacy install
    // and should be re-provisioned for the new package, not copied.
    if (entry.name === "runtime") continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
