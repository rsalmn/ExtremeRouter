// credentialVault — encrypted at-rest credentials for admin-provided provider keys.
//
// DESIGN PHILOSOPHY (read this before judging the security):
//
// This is NOT "security". There is no way to truly protect a secret that ships
// inside a client-distributed npm package — anyone with the binary + time can
// extract it. This module's goal is purely to raise the effort required above
// "grep sk-" so casual users don't trip over the key, and to make intentional
// extraction a deliberate (and traceable) act.
//
// Mechanism:
//   - AES-256-GCM authenticated encryption
//   - Master key = XOR(FRAGMENT_A, FRAGMENT_B), 32 bytes each
//   - FRAGMENT_A is read from env var VAULT_FRAGMENT_A (set by the deployer,
//     NOT shipped in the package — so a fresh `npm install` alone cannot decrypt)
//   - FRAGMENT_B is a constant in this file (shipped, but useless without A)
//   - Each ciphertext blob embeds its own 12-byte IV + 16-byte GCM tag
//
// Honest threat model: with both fragments, decryption is trivial. FRAGMENT_A
// being env-gated means a published npm tarball alone is insufficient — the
// deployer (you) sets it. But once your instance is running with both fragments,
// anyone who can read the process memory or source can recover the plaintext.
//
// Use this for low-stakes admin-provided keys where the goal is deterrence +
// easy rotation, NOT for secrets where leakage means real harm.
//
// POOL ROTATION:
//   When VAULT_SEED[providerId] is an array, getAdminCredential() implements
//   least-recently-used rotation across the pool. Keys that return 429/403 are
//   marked rate-limited (markVaultKeyRateLimited) and skipped until their
//   cooldown expires. This spreads load across many keys so no single key
//   absorbs all traffic. State is in-process (module-scoped Map) — survives
//   hot-reload via global.

import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import { VAULT_SEED } from "./vaultSeed.js";

// FRAGMENT_B — half of the AES-256 master key. Shipped in the package. Useless
// on its own (XOR partner FRAGMENT_A lives in the deployer's env var).
// Regenerate both fragments together via `node -e "..."` (see commit history).
const FRAGMENT_B = Buffer.from(
  "b5073a2cb47d36f13729759a9c3a0b7f4d1468797c41aa28b504c27c6254ff22",
  "hex",
);

// Default cooldown when a key gets 429/403. Mirrors the per-connection lock
// pattern in auth.js (exponential, capped at MAX_RATE_LIMIT_COOLDOWN_MS).
const DEFAULT_KEY_COOLDOWN_MS = 60_000;

// Per-process pool state: providerId → Map(keyName → { lastUsed, rateLimitedUntil }).
// Survives hot-reload via global.
const POOL_STATE = (global._vaultPoolState ??= new Map());
// Reverse index: providerId → keyName most recently handed out. Lets
// markVaultKeyRateLimited(providerId) target the right key without callers
// having to thread keyName through 7 different handler signatures.
const LAST_ISSUED = (global._vaultLastIssued ??= new Map());

function getPoolState(providerId) {
  let m = POOL_STATE.get(providerId);
  if (!m) {
    m = new Map();
    POOL_STATE.set(providerId, m);
  }
  return m;
}

/**
 * Resolve the AES-256 master key from FRAGMENT_B (code) XOR FRAGMENT_A (env).
 * Returns null if the deployer hasn't set VAULT_FRAGMENT_A — in which case all
 * vault lookups silently fail-open (no admin credentials available).
 */
function resolveMasterKey() {
  const envA = process.env.VAULT_FRAGMENT_A;
  if (!envA || !/^[0-9a-f]{64}$/i.test(envA)) return null;
  const a = Buffer.from(envA, "hex");
  if (a.length !== 32) return null;
  const out = Buffer.allocUnsafe(32);
  for (let i = 0; i < 32; i++) out[i] = a[i] ^ FRAGMENT_B[i];
  return out;
}

/**
 * Decrypt a vault blob. Format: <iv:12b><ciphertext+tag> hex-encoded.
 * Returns null if the master key isn't available (env unset) or decryption
 * fails (tampered blob / wrong key) — callers MUST treat null as "not available"
 * and never throw, to keep the vault fail-open per the design contract.
 *
 * @param {string} blob - hex-encoded iv+ciphertext+tag
 * @returns {string|null} plaintext, or null on any failure
 */
export function vaultDecrypt(blob) {
  if (!blob || typeof blob !== "string") return null;
  const master = resolveMasterKey();
  if (!master) return null;
  try {
    const buf = Buffer.from(blob, "hex");
    if (buf.length < 12 + 16) return null; // iv(12) + tag(16) minimum
    const iv = buf.subarray(0, 12);
    const ciphertext = buf.subarray(12, buf.length - 16);
    const tag = buf.subarray(buf.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", master, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Encrypt a plaintext string for vault storage. Used OFFLINE by the maintainer
 * (you) to produce the blobs that ship in vaultSeed.js. NOT called at runtime.
 *
 * Requires VAULT_FRAGMENT_A to be set in the env (same one the runtime uses).
 *
 * @param {string} plaintext
 * @returns {string} hex-encoded iv+ciphertext+tag
 */
export function vaultEncrypt(plaintext) {
  const master = resolveMasterKey();
  if (!master) throw new Error("VAULT_FRAGMENT_A env var must be set (64 hex chars) to encrypt");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", master, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("hex");
}

/**
 * Look up an admin-provided credential for a provider.
 *
 * - If the seed is a STRING blob → returns { key, keyName } (single-key mode).
 * - If the seed is an ARRAY → pool rotation: pick the least-recently-used key
 *   that isn't currently rate-limited, mark it as just-used, return it.
 *
 * Returns null if:
 *   - the provider has no seeded credential
 *   - the vault can't decrypt (env unset, tampered)
 *   - the pool is entirely rate-limited (all keys cooling down)
 *
 * @param {string} providerId
 * @returns {{ key: string, keyName: string } | null}
 */
export function getAdminCredential(providerId) {
  const seed = VAULT_SEED?.[providerId];
  if (!seed) return null;

  // Single-key mode (legacy/forward-compat): seed is a hex blob string.
  if (typeof seed === "string") {
    const key = vaultDecrypt(seed);
    return key ? { key, keyName: "vault" } : null;
  }

  // Pool mode: seed is an array of { name, blob }.
  if (!Array.isArray(seed) || seed.length === 0) return null;

  const state = getPoolState(providerId);
  const now = Date.now();

  // Filter to keys that are (a) decryptable and (b) not currently rate-limited.
  const candidates = [];
  for (const entry of seed) {
    if (!entry?.name || !entry?.blob) continue;
    const st = state.get(entry.name);
    if (st?.rateLimitedUntil && st.rateLimitedUntil > now) continue;
    const key = vaultDecrypt(entry.blob);
    if (key) candidates.push({ name: entry.name, key, lastUsed: st?.lastUsed || 0 });
  }

  if (candidates.length === 0) {
    // All rate-limited or undecryptable. Callers fall through to "no credentials".
    return null;
  }

  // Least-recently-used: prefer the key that was used longest ago (spread load).
  candidates.sort((a, b) => a.lastUsed - b.lastUsed);
  const chosen = candidates[0];

  // Mark as just-used.
  const st = state.get(chosen.name) || {};
  st.lastUsed = now;
  state.set(chosen.name, st);
  LAST_ISSUED.set(providerId, chosen.name);

  return { key: chosen.key, keyName: chosen.name };
}

/**
 * Mark a vault pool key as rate-limited (429/403 from upstream). Skipped by
 * getAdminCredential until cooldown expires. Called by auth.js when a vault
 * connection returns a rate-limit error.
 *
 * If keyName is omitted, targets the most recently issued key for that provider
 * (tracked via LAST_ISSUED). This avoids threading keyName through every
 * handler signature — within a single request, only one vault key is active
 * per provider, so the "last issued" key is the one that errored.
 *
 * @param {string} providerId
 * @param {string} [keyName] - the keyName returned by getAdminCredential (optional)
 * @param {number} [cooldownMs] - how long to skip this key (default 60s)
 */
export function markVaultKeyRateLimited(providerId, keyName, cooldownMs = DEFAULT_KEY_COOLDOWN_MS) {
  if (!providerId) return;
  // Resolve keyName: explicit param > last-issued for this provider > no-op.
  const target = keyName || LAST_ISSUED.get(providerId);
  if (!target) return;
  const state = getPoolState(providerId);
  const st = state.get(target) || {};
  st.rateLimitedUntil = Date.now() + cooldownMs;
  state.set(target, st);
}

/**
 * How many keys are in a provider's pool, and how many are currently available.
 * Useful for observability/dashboards. Returns null if the provider has no seed.
 */
export function getPoolStats(providerId) {
  const seed = VAULT_SEED?.[providerId];
  if (!seed) return null;
  if (!Array.isArray(seed)) return { total: 1, available: 1, rateLimited: 0 };
  const state = getPoolState(providerId);
  const now = Date.now();
  let rateLimited = 0;
  for (const entry of seed) {
    const st = state.get(entry.name);
    if (st?.rateLimitedUntil && st.rateLimitedUntil > now) rateLimited++;
  }
  return { total: seed.length, available: seed.length - rateLimited, rateLimited };
}

/**
 * Return the list of provider IDs that have a USABLE vault pool right now
 * (seed present AND decryption works AND at least one key not rate-limited).
 * Used by model-listing endpoints to decide whether to expose a provider's
 * models even when the user has no own connection.
 *
 * Respects VAULT_FRAGMENT_A — if the env var is unset, returns [] (vault
 * inert), so this is safe to call unconditionally. Side-effect-free: does NOT
 * call getAdminCredential (which would mark a key as just-used for rotation).
 *
 * @returns {string[]} providerIds with at least one available vault key
 */
export function getActiveVaultProviders() {
  if (!VAULT_SEED) return [];
  // Fast path: if env var unset, decryption is impossible for all providers.
  if (!resolveMasterKey()) return [];
  const out = [];
  for (const providerId of Object.keys(VAULT_SEED)) {
    const stats = getPoolStats(providerId);
    if (!stats || stats.available === 0) continue;
    // Confirm at least the first key actually decrypts (catches tampered /
    // wrong-fragment cases that pool stats alone wouldn't detect).
    const seed = VAULT_SEED[providerId];
    const firstBlob = Array.isArray(seed) ? seed[0]?.blob : seed;
    if (vaultDecrypt(firstBlob)) out.push(providerId);
  }
  return out;
}

// For maintainer use: expose vaultEncrypt so `node -e` scripts can produce new
// blobs without re-importing internals.
export { vaultEncrypt as _vaultEncrypt };
