// SEA payload helpers — shared by bootstrap.cjs (runtime) and the generator
// (build time). Kept dependency-free and testable without node:sea:
// getAssetBuffer() reads from the SEA blob when embedded, from
// ER_SEA_PAYLOAD_DIR on disk when running under plain node (dev/tests).
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PAYLOAD_PREFIX = "payload/";
const MANIFEST_FILE = ".sea-manifest.json";

// --- asset access -----------------------------------------------------------

function seaAssetBuffer(key) {
  // node:sea is only available inside a SEA binary — require lazily so plain
  // node (dev/tests) never touches it.
  const { getAsset } = require("node:sea");
  return Buffer.from(getAsset(key));
}

function diskAssetBuffer(payloadDir, key) {
  return fs.readFileSync(path.join(payloadDir, key));
}

function getAssetBuffer(key) {
  if (process.env.ER_SEA_PAYLOAD_DIR) {
    return diskAssetBuffer(process.env.ER_SEA_PAYLOAD_DIR, key);
  }
  return seaAssetBuffer(key);
}

// --- runtime directory ------------------------------------------------------

function runtimeDir() {
  // Test hook — production path is the @rsalmn/extremerouter app-data dir.
  if (process.env.ER_SEA_RUNTIME_DIR_OVERRIDE) return process.env.ER_SEA_RUNTIME_DIR_OVERRIDE;
  return path.join(
    process.env.APPDATA && process.platform === "win32"
      ? path.join(process.env.APPDATA, "@rsalmn", "extremerouter")
      : path.join(require("os").homedir(), ".extremerouter"),
    "sea-runtime"
  );
}

// --- manifest ---------------------------------------------------------------

function buildManifest(entries) {
  // entries: Map<key, Buffer>. Hash of hashes — one string compared against
  // the stored manifest so a startup skips extraction entirely when identical.
  const manifest = { version: 1, entries: {} };
  for (const [key, buf] of entries) {
    manifest.entries[key] = crypto.createHash("sha256").update(buf).digest("hex");
  }
  return manifest;
}

function manifestEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function readStoredManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), "utf8"));
  } catch {
    return null;
  }
}

// --- extraction -------------------------------------------------------------

function extractPayload(entries, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [key, buf] of entries) {
    const rel = key.startsWith(PAYLOAD_PREFIX) ? key.slice(PAYLOAD_PREFIX.length) : key;
    if (!rel || rel.includes("..")) continue; // safety: never escape the dir
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(buildManifest(entries)));
}

// Ensure the payload is on disk; returns "extracted" | "cached".
function ensurePayload(keys) {
  const dir = runtimeDir();
  const entries = new Map();
  for (const key of keys) entries.set(key, getAssetBuffer(key));

  const current = buildManifest(entries);
  if (manifestEquals(current, readStoredManifest(dir))) return { dir, state: "cached" };

  extractPayload(entries, dir);
  return { dir, state: "extracted" };
}

function assetKeys() {
  const { getAssetKeys } = require("node:sea");
  return getAssetKeys().filter((k) => k.startsWith(PAYLOAD_PREFIX));
}

module.exports = {
  PAYLOAD_PREFIX,
  MANIFEST_FILE,
  getAssetBuffer,
  runtimeDir,
  buildManifest,
  manifestEquals,
  readStoredManifest,
  extractPayload,
  ensurePayload,
  assetKeys,
};
