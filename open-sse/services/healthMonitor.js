/**
 * Provider Health Monitor — in-memory sliding window per provider.
 *
 * Tracks success/failure/latency samples per provider in a rolling window.
 * Provides aggregates for the Health dashboard: success rate, avg latency,
 * p95 latency, error count, last error.
 *
 * State is in-memory and resets on restart. This is intentional for a
 * real-time monitoring view; persisted historical data lives in usageHistory.
 */
import { EventEmitter } from "node:events";

const MAX_SAMPLES = 200; // hard cap per provider to bound memory

if (!global._healthMonitors) {
  global._healthMonitors = new Map(); // provider → { samples: [], windowMs }
  global._healthEmitter = new EventEmitter();
  global._healthEmitter.setMaxListeners(50);
}
const monitors = global._healthMonitors;
export const healthEmitter = global._healthEmitter;

const HEALTH_DEFAULTS = {
  enabled: true,
  windowMs: 300000, // 5 min
};

function getOrCreate(provider, windowMs) {
  let m = monitors.get(provider);
  if (!m) {
    m = { provider, samples: [], windowMs: windowMs || HEALTH_DEFAULTS.windowMs };
    monitors.set(provider, m);
  }
  return m;
}

/**
 * Record a health sample (called from chat.js on both success and failure).
 */
export function recordHealthSample(provider, { success, latencyMs, status }, settings = {}) {
  const cfg = { ...HEALTH_DEFAULTS, ...(settings?.healthMonitor || {}) };
  if (!cfg.enabled) return;

  const m = getOrCreate(provider, cfg.windowMs);
  const now = Date.now();
  const sample = { ts: now, success: !!success, latencyMs: latencyMs || 0, status: status || (success ? 200 : 0) };
  m.samples.push(sample);

  // Prune: remove samples outside the window + enforce hard cap.
  const cutoff = now - m.windowMs;
  m.samples = m.samples.filter((s) => s.ts >= cutoff);
  if (m.samples.length > MAX_SAMPLES) {
    m.samples = m.samples.slice(-MAX_SAMPLES);
  }

  // Debounced emit (lightweight: just notify that this provider changed).
  scheduleHealthEmit(provider);
}

const emitTimers = {};
function scheduleHealthEmit(provider) {
  if (emitTimers[provider]) clearTimeout(emitTimers[provider]);
  emitTimers[provider] = setTimeout(() => {
    delete emitTimers[provider];
    const health = getProviderHealth(provider);
    if (health) healthEmitter.emit("health:update", health);
  }, 500); // coalesce bursts — max 2 updates/sec per provider
}

/**
 * Compute health aggregates for a single provider from its sample window.
 */
export function getProviderHealth(provider) {
  const m = monitors.get(provider);
  if (!m) return null;

  const now = Date.now();
  const cutoff = now - m.windowMs;
  const samples = m.samples.filter((s) => s.ts >= cutoff);
  if (samples.length === 0) {
    return { provider, total: 0, successes: 0, failures: 0, successRate: null, avgLatencyMs: null, p95LatencyMs: null, lastError: null, lastErrorAt: null };
  }

  const successes = samples.filter((s) => s.success).length;
  const failures = samples.length - successes;
  const latencySamples = samples.filter((s) => s.latencyMs > 0).map((s) => s.latencyMs);
  const avgLatencyMs = latencySamples.length > 0
    ? Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)
    : null;
  const p95LatencyMs = latencySamples.length > 0
    ? Math.round(percentile(latencySamples.sort((a, b) => a - b), 0.95))
    : null;

  const lastFailure = [...samples].reverse().find((s) => !s.success);

  return {
    provider,
    total: samples.length,
    successes,
    failures,
    successRate: successes / samples.length,
    avgLatencyMs,
    p95LatencyMs,
    lastError: lastFailure ? String(lastFailure.status) : null,
    lastErrorAt: lastFailure ? lastFailure.ts : null,
  };
}

/**
 * Snapshot all provider health (for dashboard initial load).
 */
export function getAllProviderHealth() {
  return [...monitors.keys()]
    .map((p) => getProviderHealth(p))
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil(p * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, idx))];
}
