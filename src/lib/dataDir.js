import fs from "node:fs";
import path from "path";
import os from "os";
import { migrateFromLegacy } from "./dataMigration.js";

const APP_NAME = "extremerouter";

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function getDataDir() {
  const configured = process.env.DATA_DIR;
  const dir = configured || defaultDir();

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && configured && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return resolveDefault();
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    // Best-effort one-time migration from the legacy ~/.extremerouter location.
    // Runs before anything else touches the dir; safe to call on every boot.
    if (!configured) migrateFromLegacy(dir);
    return dir;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${dir}' not writable → fallback ~/.${APP_NAME}`);
      return resolveDefault();
    }
    throw e;
  }
}

function resolveDefault() {
  const dir = defaultDir();
  fs.mkdirSync(dir, { recursive: true });
  migrateFromLegacy(dir);
  return dir;
}

export const DATA_DIR = getDataDir();
