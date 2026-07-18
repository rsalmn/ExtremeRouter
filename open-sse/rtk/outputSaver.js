// Output-side saver (Caveman / Ponytail) savings estimator.
//
// These two savers reduce RESPONSE length, not request length, so their effect
// is only observable after the upstream call completes and completion_tokens
// are known. This helper consumes the per-request usage + saver flags, records
// a baseline sample, estimates savings, and returns the extended
// { savedTokens, savedTokensByMechanism } to hand to saveUsageStats.
//
// Kept here (not inlined in 3 handlers) so the attribution logic lives in one
// place — the response handlers stay thin.

import { recordCompletionSample, estimateOutputSavings } from "./completionBaseline.js";

/**
 * Augment per-request savings with Caveman/Ponytail output-side estimates.
 *
 * @param {object} opts
 * @param {object} opts.usage       - token usage { prompt_tokens, completion_tokens, ... }
 * @param {string} opts.provider
 * @param {string} opts.model
 * @param {number} opts.savedTokens - prompt-side savings (RTK + Headroom + Pxpipe) so far
 * @param {object} opts.savedTokensByMechanism - per-mechanism breakdown so far (mutated copy)
 * @param {boolean} opts.cavemanActive
 * @param {boolean} opts.ponytailActive
 * @returns {{ savedTokens: number, savedTokensByMechanism: object }}
 */
export function augmentWithOutputSaverSavings({
  usage,
  provider,
  model,
  savedTokens = 0,
  savedTokensByMechanism = {},
  cavemanActive = false,
  ponytailActive = false,
}) {
  const result = {
    savedTokens,
    savedTokensByMechanism: { ...savedTokensByMechanism },
  };

  const completionTokens =
    usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  const modelKey = model && provider ? `${model}|${provider}` : null;
  const hadOutputSaver = !!(cavemanActive || ponytailActive);

  // Always record a sample so the baseline converges. recordCompletionSample
  // ignores saver-ON samples automatically (they would bias the baseline).
  if (modelKey && completionTokens > 0) {
    recordCompletionSample(modelKey, completionTokens, hadOutputSaver);
  }

  if (!hadOutputSaver || !modelKey || completionTokens <= 0) {
    return result;
  }

  const totalSavings = estimateOutputSavings(modelKey, completionTokens);
  if (totalSavings <= 0) return result;

  // Attribute savings between Caveman and Ponytail. When both are active we
  // can't separate their effects without an A/B test, so split 50/50. When only
  // one is active, attribute the full amount to it.
  let cavemanPart = 0;
  let ponytailPart = 0;
  if (cavemanActive && ponytailActive) {
    cavemanPart = Math.round(totalSavings / 2);
    ponytailPart = totalSavings - cavemanPart;
  } else if (cavemanActive) {
    cavemanPart = totalSavings;
  } else {
    ponytailPart = totalSavings;
  }

  if (cavemanPart > 0) result.savedTokensByMechanism.caveman = cavemanPart;
  if (ponytailPart > 0) result.savedTokensByMechanism.ponytail = ponytailPart;
  result.savedTokens = savedTokens + cavemanPart + ponytailPart;

  return result;
}
