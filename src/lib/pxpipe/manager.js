// Managed pxpipe install — handles npm install of pxpipe-proxy into DATA_DIR/pxpipe.
// Mirrors the Headroom process pattern but for an in-process library, not a subprocess.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DATA_DIR } from "@/lib/dataDir.js";

const POMPIPED_DIR = join(DATA_DIR || ".", "pxpipe");
const POMPIPED_VERSION_FILE = join(POMPIPED_DIR, ".installed-version");
const POMPIPED_PACKAGE = "pxpipe-proxy";

/**
 * Get the pxpipe install directory.
 */
export function getPxpipeDir() {
  return POMPIPED_DIR;
}

/**
 * Check if pxpipe is installed by looking for the package entry.
 */
export function isPxpipeInstalled() {
  try {
    const { createRequire } = require("node:module");
    const req = createRequire(import.meta.url);
    req.resolve("pxpipe-proxy/transform", { paths: [POMPIPED_DIR] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the installed pxpipe version, or null.
 */
export function getPxpipeVersion() {
  try {
    return readFileSync(POMPIPED_VERSION_FILE, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Install or upgrade pxpipe-proxy into DATA_DIR/pxpipe.
 * Creates the directory, runs npm install, writes version file.
 *
 * @returns {{ success: boolean, version?: string, error?: string }}
 */
export function installPxpipe() {
  try {
    if (!existsSync(POMPIPED_DIR)) {
      mkdirSync(POMPIPED_DIR, { recursive: true });
    }

    // Write a minimal package.json so npm install works in this dir.
    const pkgPath = join(POMPIPED_DIR, "package.json");
    if (!existsSync(pkgPath)) {
      writeFileSync(pkgPath, JSON.stringify({
        name: "extremerouter-pxpipe",
        private: true,
        type: "module",
      }, null, 2));
    }

    // Install the package.
    execSync(`npm install ${POMPIPED_PACKAGE}@latest --no-save --prefix "${POMPIPED_DIR}"`, {
      cwd: POMPIPED_DIR,
      stdio: "pipe",
      timeout: 60_000,
    });

    // Read installed version.
    let version = "unknown";
    try {
      const pkgJson = JSON.parse(readFileSync(join(POMPIPED_DIR, "node_modules", POMPIPED_PACKAGE, "package.json"), "utf-8"));
      version = pkgJson.version || "unknown";
    } catch {}

    writeFileSync(POMPIPED_VERSION_FILE, version);
    return { success: true, version };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
}

/**
 * Get comprehensive status for the pxpipe system.
 */
export function getPxpipeStatus() {
  return {
    installed: isPxpipeInstalled(),
    version: getPxpipeVersion(),
    dir: POMPIPED_DIR,
  };
}
