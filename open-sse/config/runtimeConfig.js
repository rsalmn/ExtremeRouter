// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Shared response MIME types and CORS policy (no hardcoded literals in routes/handlers).
export const CONTENT_TYPE = {
  JSON: "application/json",
  NDJSON: "application/x-ndjson"
};
export const CORS_ANY_ORIGIN = "*";

// Re-export error config (backward compat)
export { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, BACKOFF_CONFIG, COOLDOWN_MS } from "./errorConfig.js";

// Cache TTLs (seconds)
export const CACHE_TTL = {
  userInfo: 300,    // 5 minutes
  modelAlias: 3600  // 1 hour
};

// Memory management config
export const MEMORY_CONFIG = {
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs: 5 * 60 * 1000,
  proxyDispatchersMaxSize: 20,
};

// Parse a positive integer env override, falling back to a default.
function envMs(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// Inter-chunk stall timeout (once tokens are flowing). Generous headroom so
// slow reasoning models aren't aborted mid-stream. Env: STREAM_STALL_TIMEOUT_MS.
export const STREAM_STALL_TIMEOUT_MS = envMs("STREAM_STALL_TIMEOUT_MS", 360 * 1000);

// Time-to-first-token timeout (prompt prefill). Env: STREAM_FIRST_CHUNK_TIMEOUT_MS.
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs("STREAM_FIRST_CHUNK_TIMEOUT_MS", 200 * 1000);

// Fetch connect timeout: abort if upstream doesn't return response headers within this duration
export const FETCH_CONNECT_TIMEOUT_MS = envMs("FETCH_CONNECT_TIMEOUT_MS", 60 * 1000);

// Gemini native TTS fetch timeout: abort if Google does not return response headers in time.
export const GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS = envMs("GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS", 45 * 1000);

// Default token limits
// DEFAULT_MAX_TOKENS is now a *default fallback* (when client omits max_tokens),
// NOT a universal ceiling. Use ROUTER_MAX_OUTPUT_TOKENS for the safety ceiling.
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

// Router-level safety ceiling for output tokens. Models with maxOutput > 128K
// will still be capped here to prevent runaway generation. Set to 0 via env
// to disable (NOT recommended).
export const ROUTER_MAX_OUTPUT_TOKENS = (() => {
  const raw = process.env.ROUTER_MAX_OUTPUT_TOKENS;
  if (raw == null || raw === "") return 128000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 128000;
})();

// Retry config for 429 responses (legacy - kept for backward compatibility)
export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

// Default retry config by status code: { attempts, delayMs }
// Backward compat: if value is a number, treated as attempts with RETRY_CONFIG.delayMs
export const DEFAULT_RETRY_CONFIG = {
  429: { attempts: 0, delayMs: 0 },
  502: { attempts: 3, delayMs: 3000 },
  503: { attempts: 3, delayMs: 2000 },
  504: { attempts: 2, delayMs: 3000 }
};

// Normalize a retry entry to { attempts, delayMs }
export function resolveRetryEntry(entry) {
  if (entry == null) return { attempts: 0, delayMs: RETRY_CONFIG.delayMs };
  if (typeof entry === "number") return { attempts: entry, delayMs: RETRY_CONFIG.delayMs };
  return {
    attempts: entry.attempts || 0,
    delayMs: entry.delayMs != null ? entry.delayMs : RETRY_CONFIG.delayMs
  };
}

// Requests containing these texts will bypass provider
export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];

// ── Dynamic Model Capability Catalog (models.dev background sync) ────────────
// External metadata is an ENHANCEMENT below the hand-written capability tiers:
// sync failures keep the last-known-good snapshot, and the request hot path
// never touches the network or disk for capability lookups.
export const MODEL_CATALOG_CONFIG = {
  // MODEL_CATALOG=off disables the background sync entirely (local tables only).
  enabled: !/^(off|false|0)$/i.test(process.env.MODEL_CATALOG || ""),
  url: process.env.MODEL_CATALOG_URL || "https://models.dev/api.json",
  // Let the server boot and serve first requests before the first sync.
  startupDelayMs: envMs("MODEL_CATALOG_STARTUP_DELAY", 60 * 1000),
  refreshIntervalMs: envMs("MODEL_CATALOG_REFRESH_INTERVAL", 24 * 60 * 60 * 1000),
  retryBackoffMs: envMs("MODEL_CATALOG_RETRY_BACKOFF", 30 * 60 * 1000),
  requestTimeoutMs: envMs("MODEL_CATALOG_REQUEST_TIMEOUT", 60 * 1000),
  workerTimeoutMs: envMs("MODEL_CATALOG_WORKER_TIMEOUT", 120 * 1000),
  // Hard cap on the upstream payload — reject absurd/bomb responses (§38).
  maxPayloadBytes: 25 * 1024 * 1024,
  // A modality needs a majority of catalog sources to declare it, so one
  // reseller mislabelling a text model cannot flip vision on (§17 guard).
  minModalityShare: 0.5,
  // Ignore limit deltas below this share: gateways round 200000 vs 202752.
  limitTolerance: 0.1,
  // Freshness reporting only — a stale catalog remains usable (§35).
  maxStalenessMs: envMs("MODEL_CATALOG_MAX_STALENESS", 7 * 24 * 60 * 60 * 1000),
};
