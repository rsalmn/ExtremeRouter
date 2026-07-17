// Rate limiter — sliding window per-key/IP limiter for the LLM API.
//
// Prevents DoS amplification: without rate limiting, a single client can exhaust
// provider quotas, trigger OAuth rate limits, and trip circuit breakers for all
// legitimate users.
//
// Design:
//   - Token bucket with configurable burst + refill rate
//   - Keyed on API key (preferred) or client IP (fallback)
//   - In-memory Map (survives hot-reload via global)
//   - Lazy eviction of expired buckets (no background timer)
//   - Fail-open: if the limiter crashes, the request proceeds
//
// Limits (configurable via env):
//   DEFAULT_RPM = 60 requests/minute per key (generous for coding assistants)
//   DEFAULT_BURST = 10 (max burst before refill kicks in)

const DEFAULT_RPM = parseInt(process.env.EXTREMEROUTER_RATE_LIMIT_RPM || "60", 10);
const DEFAULT_BURST = parseInt(process.env.EXTREMEROUTER_RATE_LIMIT_BURST || "10", 10);
const WINDOW_MS = 60_000; // 1 minute
const EVICT_MS = 5 * 60_000; // evict buckets unused for 5 min

const BUCKETS = (global._rateLimitBuckets ??= new Map());

/**
 * Check if a request should be rate-limited.
 * Returns { allowed: boolean, retryAfterMs: number, remaining: number }
 *
 * @param {string} key - API key or client IP
 * @param {number} rpm - max requests per minute (default: 60)
 * @param {number} burst - max burst (default: 10)
 */
export function checkRateLimit(key, rpm = DEFAULT_RPM, burst = DEFAULT_BURST) {
  if (!key) return { allowed: true, retryAfterMs: 0, remaining: burst };

  const now = Date.now();
  const refillRate = rpm / (WINDOW_MS / 1000); // tokens per second

  let bucket = BUCKETS.get(key);
  if (!bucket || now - bucket.lastEvicted > EVICT_MS) {
    bucket = { tokens: burst, lastRefill: now, lastEvicted: now };
    BUCKETS.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(burst, bucket.tokens + elapsed * refillRate);
  bucket.lastRefill = now;
  bucket.lastEvicted = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterMs: 0, remaining: Math.floor(bucket.tokens) };
  }

  // Rate limited — calculate retry-after
  const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillRate * 1000);
  return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000), remaining: 0 };
}

/**
 * Evict expired buckets (call periodically or on each check).
 */
export function evictExpiredBuckets() {
  const now = Date.now();
  for (const [key, bucket] of BUCKETS) {
    if (now - bucket.lastEvicted > EVICT_MS) {
      BUCKETS.delete(key);
    }
  }
}

/**
 * Get rate limiter stats for dashboards.
 */
export function getRateLimiterStats() {
  return {
    trackedKeys: BUCKETS.size,
    config: { rpm: DEFAULT_RPM, burst: DEFAULT_BURST, windowMs: WINDOW_MS },
  };
}
