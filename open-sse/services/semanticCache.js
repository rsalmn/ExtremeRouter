// Semantic Cache — lightweight in-memory response cache with token-similarity matching.
//
// Caches successful non-streaming chat responses keyed by a normalized hash of
// (provider + model + messages). On lookup, checks for:
//   1. Exact hash match (instant, free)
//   2. Near-match via Jaccard token-set similarity above a configurable threshold
//
// Design decisions:
//   - No external dependency (no embedding model, no vector DB)
//   - In-memory Map with TTL + max-entry eviction (LRU-ish)
//   - Only caches non-streaming responses (streaming is harder to replay)
//   - Skips cache when: tools present, system prompt contains "do not cache",
//     or messages < 10 chars (too generic)
//   - Jaccard similarity on normalized token sets (lowercase, strip punctuation)
//   - Fail-open: any error → cache miss, request proceeds normally

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_THRESHOLD = 0.85; // Jaccard similarity for near-match
const MIN_MESSAGE_LEN = 10;

// Per-process cache store. Survives hot-reload via global.
const CACHE = (global._semanticCache ??= new Map());
const STATS = (global._semanticCacheStats ??= { hits: 0, misses: 0, nearHits: 0, stored: 0, evicted: 0 });

/**
 * Normalize a string into a token set for Jaccard comparison.
 * Lowercase, strip punctuation, split on whitespace, filter short tokens.
 */
function tokenize(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

/**
 * Jaccard similarity between two token sets: |A ∩ B| / |A ∪ B|.
 * Returns 0..1. Higher = more similar.
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Extract the "cacheable content" from request messages — concatenate user
 * message texts (skip system, skip images, skip tool calls/results).
 */
function extractCacheableText(messages) {
  if (!Array.isArray(messages)) return "";
  const parts = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") {
      parts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) parts.push(part.text);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Build a cache key from provider + model + normalized message text hash.
 * SECURITY: Includes a hash of the API key to prevent cross-user cache leakage.
 * Without this, user A's cached response could be served to user B in multi-user deployments.
 */
function buildCacheKey(provider, model, text, identity = "") {
  // Simple FNV-1a hash (no crypto needed for cache keys)
  let hash = 2166136261;
  const str = `${identity}::${provider}::${model}::${text}`;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0; // unsigned
}

/**
 * Should this request be cached? Returns false for:
 * - Streaming requests (harder to replay)
 * - Requests with tools/function calls
 * - Very short messages
 * - System prompts containing "do not cache"
 */
export function isCacheable(body, stream, provider, model) {
  if (stream) return false;
  if (!body?.messages) return false;
  if (body.tools || body.tool_choice || body.functions) return false;
  const text = extractCacheableText(body.messages);
  if (text.length < MIN_MESSAGE_LEN) return false;
  // Check system prompt for cache opt-out
  for (const m of body.messages) {
    if (m.role === "system" && typeof m.content === "string" && /do not cache|no cache/i.test(m.content)) {
      return false;
    }
  }
  return true;
}

/**
 * Look up a cached response. Checks exact match first, then near-match.
 *
 * @param {string} provider
 * @param {string} model
 * @param {object} body - request body with messages
 * @param {number} threshold - Jaccard threshold for near-match (0..1)
 * @returns {{ response: object, similarity: number, exact: boolean } | null}
 */
export function cacheLookup(provider, model, body, threshold = DEFAULT_THRESHOLD, identity = "") {
  const text = extractCacheableText(body.messages);
  if (!text) { STATS.misses++; return null; }

  const key = buildCacheKey(provider, model, text, identity);
  const now = Date.now();

  // 1. Exact match
  const exact = CACHE.get(key);
  if (exact && exact.expiresAt > now) {
    exact.lastAccessed = now;
    STATS.hits++;
    return { response: exact.response, similarity: 1.0, exact: true };
  }
  if (exact) CACHE.delete(key); // expired

  // 2. Near-match via Jaccard similarity
  const queryTokens = tokenize(text);
  let bestMatch = null;
  let bestSim = 0;

  for (const [k, entry] of CACHE) {
    if (entry.expiresAt <= now) {
      CACHE.delete(k);
      STATS.evicted++;
      continue;
    }
    // SECURITY: Only match entries from the same identity (API key) to prevent
    // cross-user cache leakage.
    if (entry.identity !== identity) continue;
    if (entry.provider !== provider || entry.model !== model) continue;

    const sim = jaccardSimilarity(queryTokens, entry.tokenSet);
    if (sim >= threshold && sim > bestSim) {
      bestSim = sim;
      bestMatch = entry;
    }
  }

  if (bestMatch) {
    bestMatch.lastAccessed = now;
    STATS.nearHits++;
    return { response: bestMatch.response, similarity: bestSim, exact: false };
  }

  STATS.misses++;
  return null;
}

/**
 * Store a successful response in the cache.
 *
 * @param {string} provider
 * @param {string} model
 * @param {object} body - original request body
 * @param {object} response - the response data to cache
 * @param {number} ttlMs - time-to-live in milliseconds
 */
export function cacheStore(provider, model, body, response, ttlMs = DEFAULT_TTL_MS, identity = "") {
  const text = extractCacheableText(body.messages);
  if (!text) return;

  const key = buildCacheKey(provider, model, text, identity);
  const now = Date.now();

  // Evict expired entries (lazy GC)
  if (CACHE.size >= DEFAULT_MAX_ENTRIES) {
    // Find and remove the oldest entry by lastAccessed
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [k, v] of CACHE) {
      if (v.lastAccessed < oldestTime) {
        oldestTime = v.lastAccessed;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      CACHE.delete(oldestKey);
      STATS.evicted++;
    }
  }

  CACHE.set(key, {
    provider,
    model,
    identity,
    response,
    tokenSet: tokenize(text),
    text,
    createdAt: now,
    lastAccessed: now,
    expiresAt: now + ttlMs,
  });
  STATS.stored++;
}

/**
 * Get aggregate cache statistics for dashboards.
 */
export function getCacheStats() {
  let expired = 0;
  const now = Date.now();
  for (const entry of CACHE.values()) {
    if (entry.expiresAt <= now) expired++;
  }
  return {
    size: CACHE.size,
    active: CACHE.size - expired,
    expired,
    ...STATS,
    hitRate: STATS.hits + STATS.nearHits + STATS.misses > 0
      ? Math.round(((STATS.hits + STATS.nearHits) / (STATS.hits + STATS.nearHits + STATS.misses)) * 100)
      : 0,
  };
}

/**
 * Clear all cached entries (for testing or manual reset).
 */
export function clearCache() {
  const cleared = CACHE.size;
  CACHE.clear();
  STATS.hits = 0;
  STATS.misses = 0;
  STATS.nearHits = 0;
  STATS.stored = 0;
  STATS.evicted = 0;
  return cleared;
}
