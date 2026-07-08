// TLS Impersonation — Chrome-like TLS configuration for undici Agent.
//
// Many web providers (HuggingFace, ChatGPT, Gemini, Claude) sit behind WAF
// (AWS WAF, Cloudflare) that fingerprints the TLS ClientHello (JA3/JA4 hash).
// Node.js fetch has a distinctive fingerprint that WAF blocks. This module
// configures undici's TLS options to approximate Chrome's fingerprint:
//   - Chrome cipher suites order (BoringSSL)
//   - X25519 as primary curve (Chrome default)
//   - Chrome signature algorithms order
//   - h2 ALPN preference
//
// This is NOT a perfect JA3 match (Node.js OpenSSL != Chrome BoringSSL), but
// it's close enough to bypass many WAFs that check for "obviously not a browser"
// fingerprints. For WAFs that require exact JA3 match, a binary solution
// (curl-impersonate / tls-client) is needed.
//
// Usage:
//   import { getImpersonateDispatcher } from "./tlsImpersonate.js";
//   const res = await fetch(url, { dispatcher: getImpersonateDispatcher(), ... });

import { Agent } from "undici";

// Chrome 131+ cipher suites in BoringSSL preference order.
// Source: observed from Chrome TLS traces.
const CHROME_CIPHERS = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  // TLS 1.2 fallback suites (Chrome sends these for backward compat)
  "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
  "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
  "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
  "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
  "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
  "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
  "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA",
  "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
  "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA",
  "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
  "TLS_RSA_WITH_AES_128_GCM_SHA256",
  "TLS_RSA_WITH_AES_256_GCM_SHA384",
  "TLS_RSA_WITH_AES_128_CBC_SHA",
  "TLS_RSA_WITH_AES_256_CBC_SHA",
].join(":");

// Chrome signature algorithms in preference order.
const CHROME_SIGALGS = [
  "ecdsa_secp256r1_sha256",
  "rsa_pss_rsae_sha256",
  "rsa_pkcs1_sha256",
  "ecdsa_secp384r1_sha384",
  "rsa_pss_rsae_sha384",
  "rsa_pkcs1_sha384",
  "rsa_pss_rsae_sha512",
  "rsa_pkcs1_sha512",
].join(":");

// Chrome elliptic curves in preference order.
// X25519 is Chrome's primary curve for TLS 1.3 key exchange.
const CHROME_CURVES = "X25519:secp256r1:secp384r1";

let cachedAgent = null;

/**
 * Get (or create) a cached undici Agent configured to approximate Chrome's
 * TLS fingerprint. Reused across all impersonated requests for efficiency.
 */
export function getImpersonateDispatcher() {
  if (cachedAgent) return cachedAgent;

  cachedAgent = new Agent({
    connect: {
      ciphers: CHROME_CIPHERS,
      sigalgs: CHROME_SIGALGS,
      ecdhCurve: CHROME_CURVES,
      // Chrome prefers HTTP/2 via ALPN.
      ALPNProtocols: ["h2", "http/1.1"],
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.3",
      // Don't reject unauthorized certs (we want to look like a browser).
      rejectUnauthorized: true,
    },
    // Keep connections alive for performance.
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000,
  });

  return cachedAgent;
}

/**
 * Fetch with Chrome-like TLS impersonation.
 * Drop-in replacement for proxyAwareFetch when you need WAF bypass.
 *
 * @param {string} url
 * @param {object} options - standard fetch options
 * @param {object} proxyOptions - optional proxy config (ignored for now; WAF
 *   targets typically don't go through proxies)
 */
export async function impersonateFetch(url, options = {}, proxyOptions = null) {
  const dispatcher = getImpersonateDispatcher();
  return fetch(url, { ...options, dispatcher });
}
