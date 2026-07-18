// Completion-token baseline tracker for output-side savers (Caveman / Ponytail).
//
// These savers reduce RESPONSE length, not request length, so their savings
// can't be measured directly — there is no "before" body to diff against.
// Instead we keep a moving average of completion_tokens per (model+provider)
// observed when NO output-side saver was active, and use that as the baseline.
//
// estimateOutputSavings(key, actualCompletion) = baseline - actual, clamped >= 0.
//
// In-memory only (process-volatile): losing the baseline on restart is fine —
// it just means a ~MIN_SAMPLES warm-up period before estimates resume. Trade-off
// chosen over DB persistence to avoid a per-request DB read/write for a value
// that converges quickly and is approximate by nature.

const WINDOW_SIZE = 50;
const MIN_SAMPLES = 10; // below this, baseline is not yet trustworthy → estimate 0

// Map<"model|provider", number[]>
// Stores only saver-OFF samples; saver-ON samples are not needed for the
// baseline (they would bias it downward).
const BASELINES = new Map();

/**
 * Record a completion_tokens sample for baseline tracking.
 * Only samples observed WITHOUT an output-side saver active feed the baseline;
 * samples taken with a saver active are ignored (they reflect compressed output).
 *
 * @param {string} key - `${model}|${provider}`
 * @param {number} completionTokens
 * @param {boolean} hadOutputSaver - was Caveman or Ponytail active for this request?
 */
export function recordCompletionSample(key, completionTokens, hadOutputSaver) {
  if (!key || typeof completionTokens !== "number" || completionTokens <= 0) return;
  if (hadOutputSaver) return; // saver-ON samples would bias the baseline
  let window = BASELINES.get(key);
  if (!window) {
    window = [];
    BASELINES.set(key, window);
  }
  window.push(completionTokens);
  if (window.length > WINDOW_SIZE) window.shift(); // cap memory (ring buffer)
}

/**
 * Estimate tokens saved by output-side savers (Caveman/Ponytail) for a request.
 * Returns `baseline - actualCompletion` clamped to >= 0, or 0 if the baseline
 * has too few samples to be trustworthy.
 *
 * @param {string} key - `${model}|${provider}`
 * @param {number} actualCompletion - completion_tokens of this request
 * @returns {number}
 */
export function estimateOutputSavings(key, actualCompletion) {
  if (!key || typeof actualCompletion !== "number" || actualCompletion <= 0) return 0;
  const window = BASELINES.get(key);
  if (!window || window.length < MIN_SAMPLES) return 0;
  const sum = window.reduce((a, b) => a + b, 0);
  const baseline = sum / window.length;
  const savings = baseline - actualCompletion;
  return savings > 0 ? Math.round(savings) : 0;
}

/**
 * Drop the baseline for a key (test helper).
 */
export function resetBaseline(key) {
  if (key) BASELINES.delete(key);
  else BASELINES.clear();
}

/**
 * Inspect baseline state (for debugging / dashboards).
 */
export function getBaselineDebugInfo() {
  const out = {};
  for (const [key, window] of BASELINES.entries()) {
    const sum = window.reduce((a, b) => a + b, 0);
    out[key] = { samples: window.length, avg: window.length ? Math.round(sum / window.length) : null };
  }
  return out;
}
