// pickProxyPoolId — shared utility for auto-rotating proxy pool selection.
//
// Used by auth.js for no-auth providers that want to distribute requests
// across all active proxy pools instead of pinning to one.
//
// Round-robin state is deliberately in-memory (not persisted) — resetting
// the index on server restart is fairer than resuming from a potentially
// biased last index. If a pool is deleted, the cycle automatically adjusts.

// Per-provider round-robin cursor. Survives hot-reload via global.
const RR_CURSORS = (global._proxyRRcursors ??= new Map()); // providerId → number

/**
 * Pick a proxy pool ID from a list, using the configured strategy.
 *
 * @param {string[]} poolIds — active proxy pool IDs (must have ≥1)
 * @param {string} strategy — "none" | "round-robin" | "random"
 * @param {string} providerId — used as round-robin cursor key
 * @returns {string|null} selected pool ID, or null if no pools
 */
export function pickProxyPoolId(poolIds, strategy, providerId) {
  if (!poolIds || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0]; // no rotation needed

  if (strategy === "round-robin") {
    const idx = RR_CURSORS.get(providerId) || 0;
    const selected = poolIds[idx % poolIds.length];
    RR_CURSORS.set(providerId, (idx + 1) % poolIds.length);
    return selected;
  }

  if (strategy === "random") {
    return poolIds[Math.floor(Math.random() * poolIds.length)];
  }

  // "none" or unknown → first pool
  return poolIds[0];
}
