// TLS Client — Chrome TLS fingerprint impersonation via wreq-js.
//
// Many web providers (Claude Web, ChatGPT Web, Gemini Web, Poe) sit behind
// Cloudflare/WAF that fingerprints the TLS ClientHello (JA3/JA4 hash). Node.js
// fetch has a distinctive fingerprint that WAF blocks. wreq-js is a Rust-powered
// HTTP client that perfectly matches Chrome's TLS fingerprint.
//
// Ported from OmniRoute's open-sse/utils/tlsClient.ts (MIT).
//
// Features:
//   - Chrome 124 JA3/JA4 fingerprint (exact match via Rust BoringSSL)
//   - HTTP/2 support (Chrome uses h2 by default)
//   - fetch-compatible Response (drop-in replacement)
//   - Circuit breaker (3 failures → cooldown → exponential backoff)
//   - Proxy support (reads HTTPS_PROXY env)
//
// Usage:
//   import { tlsFetch } from "./tlsClient.js";
//   const res = await tlsFetch(url, { method: "POST", headers, body });
//
// Graceful fallback: if wreq-js is not installed or circuit is open,
// tlsFetch falls back to globalThis.fetch (no impersonation but still works
// for providers that don't check TLS fingerprint).

import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

let createSession = null;
try {
  const loaded = _require("wreq-js");
  createSession = typeof loaded.createSession === "function" ? loaded.createSession : null;
} catch {
  createSession = null;
}

function getProxyFromEnv() {
  return (
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy ||
    undefined
  );
}

// ─── Circuit breaker ────────────────────────────────────────────────────────

const circuit = {
  failureCount: 0,
  maxFailures: 3,
  baseCooldownMs: 30_000,
  cooldownMs: 30_000,
  cooldownMultiplier: 1,
  maxCooldownMs: 600_000,
  tripped: false,
  openUntil: 0,
};

function isCircuitOpen() {
  if (!circuit.tripped) return false;
  if (Date.now() >= circuit.openUntil) {
    console.log("[TlsClient] Half-open: retrying after cooldown");
    return false;
  }
  return true;
}

function recordTlsFailure() {
  circuit.failureCount++;
  if (circuit.failureCount >= circuit.maxFailures) {
    circuit.openUntil = Date.now() + circuit.cooldownMs;
    circuit.tripped = true;
    console.warn(
      `[TlsClient] Circuit opened after ${circuit.failureCount} consecutive failures, ` +
      `cooling down for ${circuit.cooldownMs}ms`
    );
    circuit.cooldownMultiplier = Math.min(circuit.cooldownMultiplier * 2, 20);
    circuit.cooldownMs = Math.min(circuit.baseCooldownMs * circuit.cooldownMultiplier, circuit.maxCooldownMs);
  }
}

function recordTlsSuccess() {
  circuit.failureCount = 0;
  if (circuit.tripped) {
    circuit.cooldownMultiplier = 1;
    circuit.cooldownMs = circuit.baseCooldownMs;
    console.log("[TlsClient] Circuit closed (success after cooldown)");
    circuit.tripped = false;
  }
}

// ─── Session management ─────────────────────────────────────────────────────

let session = null;

async function getSession() {
  if (!createSession) return null;
  if (isCircuitOpen()) return null;
  if (session) return session;

  const proxy = getProxyFromEnv();
  const opts = { browser: "chrome_124", os: "macos" };
  if (proxy) {
    opts.proxy = proxy;
    console.log(`[TlsClient] Using proxy: ${proxy}`);
  }

  session = await createSession(opts);
  console.log("[TlsClient] Session created (Chrome 124 TLS fingerprint)");
  return session;
}

/**
 * Check if TLS impersonation is available (wreq-js installed + circuit not open).
 */
export function isTlsAvailable() {
  return !!createSession && !isCircuitOpen();
}

/**
 * Fetch with Chrome TLS fingerprint impersonation.
 *
 * Falls back to globalThis.fetch if wreq-js is not available or circuit is open.
 * Returns a standard Response object (fetch-compatible).
 *
 * @param {string} url
 * @param {object} options — standard fetch options (method, headers, body, signal)
 * @returns {Promise<Response>}
 */
export async function tlsFetch(url, options = {}) {
  const sess = await getSession();
  if (!sess) {
    // Fallback to regular fetch (no impersonation)
    return globalThis.fetch(url, options);
  }

  try {
    const res = await sess.fetch(url, options);
    recordTlsSuccess();
    return res;
  } catch (err) {
    recordTlsFailure();

    // If circuit just opened or session is broken, close it
    if (circuit.tripped && session) {
      try { await session.close(); } catch {}
      session = null;
    }

    // Fallback to regular fetch on TLS failure
    console.warn(`[TlsClient] TLS fetch failed (${err?.message || err}), falling back to regular fetch`);
    return globalThis.fetch(url, options);
  }
}

export default { tlsFetch, isTlsAvailable };
