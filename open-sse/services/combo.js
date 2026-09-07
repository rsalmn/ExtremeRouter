/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { extractTextContent } from "../translator/formats/gemini.js";
import { isBreakerBlocking } from "./circuitBreaker.js";
import { validateComboRoles } from "./providerCapabilities.js";
import { resolveProviderAlias } from "./model.js";
import { createAbortableTask } from "./abortableTask.js";
import { appendDirective, buildCoordinatorBody, inferConversationFormat, clampText } from "./comboConversation.js";
import { buildSmartRoutingOrder, buildIntentResolver, lastUserMessageText } from "./smartRouting.js";
import {
  createSmartRoutingRun,
  updateRoutingDecision,
  markServedModel,
  markRunError,
  markRunComplete,
} from "./smartRoutingTelemetry.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { mapCanonicalAttemptToRequestStatus } from "../utils/requestDetailStatus.js";

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

/**
 * Pre-filter a combo's model list: drop models whose provider circuit breaker
 * is currently OPEN (blocking traffic). This avoids a wasted credential-
 * selection round-trip per broken model before the reactive fallback path
 * would have skipped it anyway.
 *
 * Read-only: uses isBreakerBlocking (no probe-slot claiming), so it's safe to
 * call without consuming the single HALF_OPEN probe allotment.
 *
 * If EVERY model is breaker-blocked, returns the original list unchanged —
 * the lazy OPEN→HALF_OPEN transition inside isCircuitOpen may have fired by
 * the time we actually attempt, so we don't hard-block a fully-depleted combo.
 * The worst case is one extra failed attempt, which is strictly better than
 * refusing to serve a request that could have succeeded.
 *
 * @param {string[]} models - combo model strings ("provider/model")
 * @param {object} breakerSettings - settings object (reads settings.circuitBreaker)
 * @returns {{ active: string[], skipped: string[] }}
 */
export async function filterBreakerOpenModels(models, breakerSettings) {
  if (!Array.isArray(models) || models.length <= 1) {
    return { active: models || [], skipped: [] };
  }
  const active = [];
  const skipped = [];
  for (const m of models) {
    const slash = typeof m === "string" ? m.indexOf("/") : -1;
    const prefix = slash > 0 ? m.slice(0, slash) : "";
    const providerId = prefix ? resolveProviderAlias(prefix) : "";
    if (providerId && isBreakerBlocking(providerId, breakerSettings)) {
      skipped.push(m);
    } else if (providerId) {
      // H2 fix: shed traffic from severely degraded providers (success rate < 50%).
      // Lazy import to avoid circular dependency chain: combo.js → healthMonitor.js
      // → alertService.js → (back to combo). Static import causes TDZ error in CLI build.
      let health = null;
      try {
        const { getProviderHealth } = await import("./healthMonitor.js");
        health = getProviderHealth(providerId);
      } catch { /* health monitor not available — skip shedding */ }
      if (health && health.total >= 10 && health.successRate !== null && health.successRate < 0.5) {
        skipped.push(m);
      } else {
        active.push(m);
      }
    } else {
      active.push(m);
    }
  }
  // Last-resort: if every model is blocked, return the original list. A probe
  // window may open during the attempt, and one failed call beats a hard 503.
  if (active.length === 0) {
    return { active: models, skipped: [] };
  }
  return { active, skipped };
}

// Prefixes used when flattening tool turns into plain prose for panel models.
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

// Flatten tool turns into prose so panel models keep the context but can't loop
// on tools: drop the request's tools, turn tool/function results into assistant
// text, and inline assistant tool_calls names instead of the structured field.
// Convert tool/function turns into prose so panel/worker models keep context
// but cannot loop on tools. Exported for reuse by the Hierarchical Swarm engine.
export function flattenToolHistory(messages) {
  return messages
    .filter((msg) => msg)
    .map((msg) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = tool_calls.map((c) => c?.function?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((c) => c.type === "tool_use");
        const hasToolResult = msg.content.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts = [];
          const toolNames = [];
          const toolResults = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}

// Resolve capability object for a "provider/model" string (alias prefix resolved).
function modelCapabilitiesFor(modelStr) {
  const slash = typeof modelStr === "string" ? modelStr.indexOf("/") : -1;
  const provider = slash > 0 ? resolveProviderAlias(modelStr.slice(0, slash)) : "";
  const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;
  return getCapabilitiesForModel(provider, model);
}

// Reorder combo models by capability fit. Stable; never drops a model (fallback intact).
// Tier 0: satisfies all hard + all soft. Tier 1: all hard only. Tier 2: rest.
export function reorderByCapabilities(models, required) {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1) return models;
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  const soft = [...required].filter((c) => !HARD_CAPS.has(c));

  const tierOf = (m) => {
    const caps = modelCapabilitiesFor(m);
    if (!hard.every((c) => caps[c] === true)) return 2;
    return soft.every((c) => caps[c] === true) ? 0 : 1;
  };

  // Stable sort by tier (Array.prototype.sort is stable in modern engines).
  return models
    .map((m, i) => ({ m, i, t: tierOf(m) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);
}

// Default fallback prepended when no combo member covers the request's hard
// input modalities. `oc/mimo-v2.5-free` is vision-capable per MODEL_CAPABILITIES
// pattern `*mimo*v2.5*`; audio/video are NOT asserted there, so the adapter
// guard below deliberately refuses to route audio/video to it until upstream
// metadata proves otherwise — routing to a not-proven-capable model would just
// produce broken requests.
export const DEFAULT_CAPABILITY_FALLBACK_MODEL = "oc/mimo-v2.5-free";

/**
 * Capability adapter. If the request needs hard input modalities (vision/pdf/
 * audio/video) and NO combo member covers all of them, prepend the configured
 * fallback model — but only when the fallback is KNOWN to cover them (unknown
 * capability ≠ capable). Pure: returns a new array or the SAME array reference
 * when nothing changes, so callers can detect insertion via identity.
 */
export function applyCapabilityAdapter(members, required, fallbackModel = "") {
  if (!Array.isArray(members) || members.length === 0) return members;
  const hard = [...(required || [])].filter((c) => HARD_CAPS.has(c));
  if (hard.length === 0) return members;
  const satisfies = (m) => {
    const caps = modelCapabilitiesFor(m);
    return hard.every((c) => caps[c] === true);
  };
  // 1. A member already covers every required modality → nothing to do.
  if (members.some(satisfies)) return members;
  // 2. Fallback must be known-capable and not already in the list.
  if (!fallbackModel || members.includes(fallbackModel) || !satisfies(fallbackModel)) return members;
  // 3. Prepend so the fallback is attempted first; original order preserved after.
  return [fallbackModel, ...members];
}

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

// Trailing run of items after the last assistant/model turn = the current user
// turn. It may span several messages (e.g. text + image split across blocks),
// so we return all of them. History media (older turns) must not pin the combo
// to a vision model — those get stripped + placeholdered downstream instead.
function trailingUserItems(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role)) i--;
  return arr.slice(i + 1);
}

// Detect which capabilities a request needs. Modalities (vision/pdf/audio/video)
// are scanned only on the current user turn; "search" is request-wide (lives in
// tools). Returns a Set of hard-caps: "vision" | "pdf" | "audioInput" | "videoInput".
export function detectRequiredCapabilities(body) {
  const required = new Set();
  if (!body || typeof body !== "object") return required;

  const scanBlock = (b) => {
    if (!b || typeof b !== "object") return;
    const t = b.type;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "audio_url" || t === "audio" || t === "input_audio") required.add("audioInput");
    if (t === "video_url" || t === "video" || t === "input_video") required.add("videoInput");
    if (t === "file" || t === "document" || t === "input_file") required.add("pdf");
    // gemini parts: inlineData/fileData carry a mime
    const mime = b.inlineData?.mimeType || b.fileData?.mimeType;
    if (typeof mime === "string" && mime.startsWith("image/")) required.add("vision");
    if (typeof mime === "string" && (mime.startsWith("audio/") || mime === "application/ogg")) required.add("audioInput");
    if (typeof mime === "string" && (mime.startsWith("video/") || mime === "application/mp4")) required.add("videoInput");
    if (mime === "application/pdf") required.add("pdf");
  };

  const scanContent = (content) => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b);
  };

  // Modalities: current user turn only (trailing user run across each known shape).
  for (const m of trailingUserItems(body.messages)) scanContent(m.content);      // openai / claude
  for (const it of trailingUserItems(body.input)) scanContent(it.content);       // responses
  const contents = body.contents || body.request?.contents;                      // gemini / antigravity
  for (const c of trailingUserItems(contents)) scanContent(c.parts);

  // Search capability detection is intentionally NOT implemented here. The
  // tools array carries provider-specific search tool definitions whose shape
  // varies across OpenAI/Claude/Gemini, and the combo auto-switch only needs
  // to reorder for HARD input modalities (vision/pdf/audio/video). A model
  // lacking search still answers — it just won't call the search tool — so
  // there's no correctness reason to float search-capable models. Revisit if
  // we ever want to prefer search-capable models for search-flagged requests.

  return required;
}

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  // State shape is always { index, consecutiveUseCount }. The previous version
  // carried a legacy `typeof existingState === "number"` branch for an old
  // on-disk format that was never persisted across restarts (comboRotationState
  // is an in-memory Map) — dead code, removed.
  const state = comboRotationState.get(rotationKey) || { index: 0, consecutiveUseCount: 0 };

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;

  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);

  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Commit F: finalized semantic-success gate for a provider attempt.
 *
 * Two distinct concepts (must NOT be collapsed):
 *  - Candidate admission — the candidate's response has been committed to the
 *    downstream client (a live stream handed off at the outer Fallback/RoundRobin
 *    boundary). Once admitted it cannot be retroactively replaced.
 *  - Final attempt outcome — canonicalAttempt.logicalSuccess, known only after the
 *    provider attempt completes. Purely informational for an admitted stream.
 *
 * Rules:
 *  - Streaming outer-handoff candidate (text/event-stream Response delivered to
 *    the client): admission = committed 2xx transport success. The provisional
 *    canonicalAttempt is deferred to telemetry and never read here — a streaming
 *    candidate that already admitted output must not be re-judged mid-stream.
 *  - Buffered attempts (non-streaming / forced-SSE / Fusion panels / Cascade stages
 *    / Swarm legs — all stream:false and consumed via .json()): use the FINALIZED
 *    canonicalAttempt.logicalSuccess.
 *  - Null-attempt paths (cache / bypass / pre-provider validation): canonicalAttempt
 *    is null → keep the legacy handler-level result.success. Null is NOT logical
 *    failure (§12); this branch is isolated + documented, not a broad `success ?? ok`.
 */
function candidateServed(result) {
  if (!result || !result.response) return false;
  const isStreaming = /^text\/event-stream/.test(result.response.headers?.get?.("content-type") || "");
  if (isStreaming) return result.success === true; // admission (outer handoff)
  const ca = result.canonicalAttempt;
  return ca ? ca.logicalSuccess === true : result.success === true; // buffered / null-attempt compat
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" or "round-robin"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @param {Object} [options.breakerSettings] - Settings (reads circuitBreaker config) for proactive breaker pre-filter
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true, breakerSettings = null, signal, runBudget, onModelServed }) {
  // Fusion/swarm/cascade are chat-only strategies — chat.js dispatches them to
  // their own handlers before reaching here. The media/fetch/search handlers
  // (image, tts, stt, search, fetch) also route through handleComboChat, so a
  // user who sets one of those strategies on a combo would otherwise silently
  // degrade to plain fallback with no error. Reject loudly instead.
  if (comboStrategy === "fusion" || comboStrategy === "swarm" || comboStrategy === "cascade") {
    log.warn("COMBO", `Combo "${comboName}" strategy ${comboStrategy} not supported here (fallback/round-robin only)`);
    return new Response(
      JSON.stringify({ error: { message: `Combo strategy "${comboStrategy}" is only supported for chat requests`, type: "invalid_request_error", code: "combo_strategy_not_supported" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Apply rotation strategy if enabled
  let rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);

  // Proactive breaker pre-filter: skip models whose provider circuit breaker
  // is currently OPEN. This avoids a wasted credential-selection round-trip
  // per broken model (the reactive fallback path would skip them anyway, but
  // only after a failed attempt). Read-only check — does not claim probe slots.
  if (breakerSettings) {
    const { active, skipped } = await filterBreakerOpenModels(rotatedModels, breakerSettings);
    if (skipped.length > 0) {
      log.info("COMBO", `breaker pre-filter: skipped ${skipped.length} open-breaker model(s) [${skipped.join(", ")}]`);
      rotatedModels = active;
    }
  }

  // Auto-switch: float models that satisfy the request's required capabilities to the front.
  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }

  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;
  // Bounded canonical summary of the most recent failed candidate (model id +
  // classification/reason/finishReason — never content). Surfaced in the
  // all-failed envelope when the transport error text is uninformative, so
  // clients stop rendering generic "empty response" templates for a truncation
  // (finish_reason=max_tokens) or another diagnosable outcome.
  let lastAttemptLabel = null;
  // Awaiting the enqueue (not the database write — the repo buffers in memory
  // and flushes asynchronously) serializes forensic attempt ordering: candidate
  // N's record is pushed to the write buffer before candidate N+1's execution
  // starts, so evidence can never overtake an earlier candidate.
  const persistAttempt = async ({ forensic, result = null, attempt = null, fallbackDecision }) => {
    if (!forensic?.attemptId || !forensic?.requestId) return;
    const record = {
      ...forensic,
      status: result?.status ?? result?.response?.status ?? null,
      classification: attempt?.classification || null,
      reason: attempt?.reason || null,
      outcome: attempt?.outcome || null,
      logicalSuccess: attempt?.logicalSuccess === true,
      completionState: attempt?.completionState || null,
      completionType: attempt?.completionType || null,
      terminalState: attempt?.terminalState || null,
      terminalType: attempt?.terminalType || null,
      finishReason: attempt?.finishReason || null,
      usableOutput: attempt?.usableOutput === true,
        fallbackDecision,
        streamObservability: result?.streamObservability || null,
        canonicalAttempt: attempt || null,
    };
    await saveRequestDetail({
      id: forensic.requestId,
      provider: forensic.physicalProviderId || null,
      model: forensic.physicalModel || null,
      status: attempt
        ? mapCanonicalAttemptToRequestStatus(attempt)
        : (record.status >= 400 ? "error" : "incomplete"),
      combo: { name: comboName, strategy: comboStrategy },
      correlation: forensic,
      attempts: [record],
    }).catch(() => {});
  };

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr, { role: "worker", candidateIndex: i, candidateOrder: [...rotatedModels] });
      const forensic = result?.correlation;
      const attempt = result?.canonicalAttempt;
      // Wave 1C: ChatResult.success was the authoritative application-success signal.
      // Commit F: migrate to candidateServed — finalized canonicalAttempt.logicalSuccess
      // for buffered attempts, admission (committed 2xx stream) for the outer streaming
      // handoff (chat.js returns this Response directly to the client). Transport data
      // (status/headers/body) stays on result.response.
      if (candidateServed(result)) {
        await persistAttempt({ forensic, result, attempt, fallbackDecision: "served" });
        log.info("COMBO", `Model ${modelStr} succeeded`);
        // Combo observability: notify the strategy wrapper which member actually
        // served the request (used by smart-routing telemetry).
        if (typeof onModelServed === "function") onModelServed(modelStr);
        return result.response;
      }

      const status = result.status ?? result.response?.status;

      // Extract error info from response
      let errorText = result.error || "";
      let retryAfter = null;
      try {
        const errorBody = await result.response.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch {
        // Ignore JSON parse errors
      }

      // Track earliest retryAfter across all combo models
      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      // Normalize error text to string (Worker-safe)
      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      // G2-D: canonicalAttempt.policy is the source of truth for candidate
      // progression. `stopProgression` stops the loop (client_abort, the
      // non-retryable user-error set, cache/bypass); `fallbackEligible` permits
      // trying the next candidate. The 503/502/504 delay below is a lifecycle
      // guard (brief-overload recovery wait), NOT another fallback decision —
      // policy already allowed fallback before we get there. Legacy status-based
      // rules are kept only as a temporary compatibility path when no finalized
      // canonical policy exists (pre-provider validation / older internal paths).
      let shouldFallback;
      let cooldownMs = 0;
      const finalizedPolicy = (attempt && attempt.completionState !== "unknown") ? attempt.policy : null;
      if (finalizedPolicy) {
        shouldFallback = finalizedPolicy.stopProgression === true
          ? false
          : finalizedPolicy.fallbackEligible === true;
        if (shouldFallback) cooldownMs = checkFallbackError(status, errorText).cooldownMs;
      } else {
        // Legacy compatibility bridge: only reached when no FINALIZED canonical
        // policy exists (pre-provider validation / older internal paths). It must
        // NEVER run once result.canonicalAttempt.policy is present — that path is
        // authoritative above. Diagnosed (not spammed) so the bridge is observable
        // and removable once every provider attempt finalizes a canonical policy.
        log.warn("COMBO", `Legacy fallback bridge used (no finalized canonical policy) for ${modelStr}`, { status });
        const nonRetryableClientError = [400, 405, 406, 413, 415, 422].includes(status);
        ({ shouldFallback, cooldownMs } = nonRetryableClientError
          ? { shouldFallback: false, cooldownMs: 0 }
          : checkFallbackError(status, errorText));
      }

      if (!shouldFallback) {
        await persistAttempt({ forensic, result, attempt, fallbackDecision: "stopped" });
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status });
        return result.response;
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
        (status === 503 || status === 502 || status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      // Fallback to next model
      await persistAttempt({ forensic, result, attempt, fallbackDecision: "fallback" });
      lastError = errorText || String(status);
      if (!lastStatus) lastStatus = status;
      lastAttemptLabel = `${forensic?.physicalModel || modelStr}: ${attempt?.classification || "failed"}${attempt?.reason ? `/${attempt.reason}` : ""}${attempt?.finishReason ? ` (finish_reason=${attempt.finishReason})` : ""}`;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues. The provider
      // attempt may have thrown before returning a ChatResult, so retain the
      // attempt identity attached by the dispatch closure without persisting
      // exception text or request content.
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
      await persistAttempt({
        forensic: error?.forensic,
        result: { status: 500 },
        attempt: {
          classification: "transport_failure",
          reason: "execution_exception",
          outcome: "failure",
          logicalSuccess: false,
          completionState: "failure",
          completionType: "execution_exception",
          errorSeen: true,
        },
        fallbackDecision: i < rotatedModels.length - 1 ? "fallback" : "stopped",
      });
    }
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  // Wave 1C: a failed candidate can now carry a 2xx transport status
  // (success=false + response.ok=true). Never synthesize the all-failed error
  // with a success-range status — clamp to 503 unless a real error status exists.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const lastStatusIsError = lastStatus == null || lastStatus === 0 || lastStatus >= 400;
  const status = allDisabled ? 503 : (lastStatusIsError ? (lastStatus || 503) : 503);
  // A 2xx candidate with an empty/unusable body yields errorText === "200" —
  // noise to clients (they render generic "empty response" templates for it).
  // When the error text carries nothing beyond the raw status, fall back to the
  // last canonical classification so the failure is diagnosable.
  const informativeError = lastError && lastError !== String(lastStatus);
  const msg = informativeError
    ? lastError
    : (lastAttemptLabel
        ? `All combo models failed — last candidate ${lastAttemptLabel}`
        : "All combo models unavailable");

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg, type: "server_error", code: "all_models_failed" } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Extract assistant text from a non-stream completion across formats
 * (OpenAI chat, Claude messages, Gemini, OpenAI Responses). Returns "" if none.
 * Panel responses are already translated to the client format by chatCore, so the
 * leaf content→string step reuses the translator's own extractTextContent.
 */
// Extract assistant text from a non-stream completion across all supported
// formats. Exported for reuse by the Hierarchical Swarm engine (worker outputs).
export function extractPanelText(json) {
  if (!json || typeof json !== "object") return "";

  // OpenAI chat completion
  const choice = json.choices?.[0];
  if (choice) {
    const msg = choice.message ?? choice.delta ?? {};
    const t = extractTextContent(msg.content);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  // Claude messages (text blocks share OpenAI's {type:"text"} shape)
  const claudeText = extractTextContent(json.content);
  if (claudeText.trim()) return claudeText;

  // Gemini (parts carry .text without a type discriminator)
  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts.map((p) => p?.text || "").join("");
    if (t.trim()) return t;
  }

  // OpenAI Responses API
  if (Array.isArray(json.output)) {
    const t = json.output
      .flatMap((o) => (Array.isArray(o.content) ? o.content.map((c) => c?.text || "") : []))
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

// Append a synthesized user turn to whichever message array the request format
// uses. Exported for reuse by the Hierarchical Swarm engine (role directives).
export function appendUserTurn(body, text) {
  const next = { ...body };
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

/**
 * Build the judge directive. Per OpenRouter's Fusion design, the judge does NOT
 * merge — it analyzes (consensus / contradictions / partial coverage / unique
 * insights / blind spots) then writes one answer grounded in that analysis.
 * ~3/4 of fusion's quality lift comes from this synthesis step.
 *
 * Sources are anonymized ("Source N") so the judge weighs substance, not the
 * reputation of a model brand.
 */
function buildJudgePrompt(answers) {
  const panel = answers
    .map((a, i) => `[Source ${i + 1}]\n${a.text}`)
    .join("\n\n");

  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

// Fusion tuning. Overridable per-combo via settings.comboStrategies[name].
const FUSION_DEFAULTS = {
  minPanel: 2,             // answers needed before stragglers get a grace window
  stragglerGraceMs: 8000,  // wait this long for laggards once quorum is reached
  panelHardTimeoutMs: 90000, // absolute cap so one hung model can't stall forever
};

// Backward-compatible timeout helper. New orchestration should pass a task
// factory `(signal) => Promise` so timeout aborts the underlying provider call.
export function withTimeout(taskOrPromise, ms, parentSignal) {
  if (typeof taskOrPromise === "function") {
    return createAbortableTask(taskOrPromise, ms, parentSignal).promise;
  }
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(taskOrPromise)
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); resolve({ __error: e }); });
  });
}

/**
 * Collect panel responses with quorum-grace: as soon as `minPanel` calls succeed,
 * start a short grace timer for the rest, then proceed with whatever arrived. This
 * caps the straggler penalty (the slowest model otherwise dominates wall time) while
 * still preferring a full panel when everyone is fast. Bounded by a hard timeout.
 * Returns a sparse array aligned to `calls` (undefined = not yet / dropped).
 */
// Quorum-grace parallel collection. Exported for reuse by the Hierarchical Swarm
// engine (parallel worker fan-out).
export function collectPanel(calls, { minPanel, stragglerGraceMs, panelHardTimeoutMs, onFinish }) {
  return new Promise((resolve) => {
    const out = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      onFinish?.();
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p, i) => {
      Promise.resolve(p)
        .then((v) => { out[i] = v; })
        .catch((e) => { out[i] = { __error: e }; })
        .finally(() => {
          settled++;
          // Quorum counts application success across heterogeneous leg shapes:
          // ChatResult legs carry .success (Wave 1C), swarm worker legs use the
          // internal { ok, text } marker. Neither is a raw Response here.
          const leg = out[i];
          const legSucceeded = !!leg && (leg.success === true || (leg.success === undefined && leg.ok === true));
          if (legSucceeded) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

/**
 * Handle a smart-routing combo: order the member pool per-request based on the
 * two routing signals (tool-calling need + research intent), then run a plain
 * fallback chain over the ordered pool via handleComboChat (which adds the
 * breaker pre-filter, capability auto-switch and per-model failover).
 *
 * Cookie providers are ordered FIRST for research intents and EXCLUDED for
 * tool-calling requests. Runtime failures (cookie 403 / Cloudflare block) fall
 * through the chain automatically — a dead cookie provider can never kill a
 * research request because the normal pool follows it in the same chain.
 *
 * @param {Object} options
 * @param {Object} options.body - request body
 * @param {string[]} options.models - combo member refs
 * @param {Function} options.handleSingleModel - (body, model, opts) => Promise<Response>
 * @param {Object} options.log - logger
 * @param {string} options.comboName - combo name (logging)
 * @param {Object} [options.config] - normalized smartRouting config
 * @param {AbortSignal} [options.signal] - run-level abort signal
 * @param {Object} [options.runBudget] - combo budget
 * @param {Object} [options.breakerSettings] - settings (breaker pre-filter)
 * @returns {Promise<Response>}
 */
export async function handleSmartRoutingChat({ body, models, handleSingleModel, log, comboName, config, signal, runBudget, breakerSettings, telemetry = true }) {
  const members = Array.isArray(models) ? models.filter(Boolean) : [];
  if (members.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Smart Routing combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Telemetry: register the run so the routing decision is observable ────
  // per request (reason + selected pool + excluded cookies) on the dashboard.
  // The full last user message is persisted alongside the preview so the
  // A/B Lab can re-run the routing decision on the exact original prompt.
  const promptText = lastUserMessageText(body);
  const runId = telemetry ? createSmartRoutingRun({ comboName, promptPreview: promptText, lastUserMessage: promptText }).runId : null;
  const telemetryRun = (fn, ...args) => { if (runId) fn(runId, ...args); };

  // The intent resolver reports HOW it decided (heuristic signal/confidence or
  // classifier model); buffered here so the routing snapshot below can carry it.
  let intentDetail = null;
  const resolveIntent = buildIntentResolver({
    config,
    handleSingleModel,
    log,
    onIntent: (detail) => { intentDetail = detail; },
  });

  let routing;
  try {
    routing = await buildSmartRoutingOrder({ body, members, config, resolveIntent });
  } catch (error) {
    // Ordering must never kill the request — degrade to the plain member order.
    log.warn("SMART", `Combo "${comboName}" routing failed (${error?.message || error}) — using default order`);
    routing = { order: members, reason: "general", details: {} };
    telemetryRun(markRunError, `routing failed: ${error?.message || error}`);
  }

  const { order, reason, details } = routing;
  log.info("SMART", `Combo "${comboName}" routing=${reason} → [${order.join(", ")}]`);
  if (details?.excludedCookies?.length) {
    log.info("SMART", `Combo "${comboName}" tool_calling: excluded cookie models [${details.excludedCookies.join(", ")}]`);
  }

  // Publish the decision (reason + selected pool + excluded cookies / pool
  // split + intent detail).
  telemetryRun(updateRoutingDecision, { reason, order, ...details, intent: intentDetail });

  try {
    const res = await handleComboChat({
      body,
      models: order,
      handleSingleModel,
      log,
      comboName,
      comboStrategy: "fallback",
      breakerSettings,
      signal,
      runBudget,
      onModelServed: (model) => telemetryRun(markServedModel, model),
    });

    // No telemetry — return the response untouched.
    if (!runId) return res;

    // All members failed / non-retryable client error → surface the failure.
    if (!res.ok) {
      let errorText = res.statusText || "all models failed";
      try {
        const errorBody = await res.clone().json();
        errorText = errorBody?.error?.message || errorText;
      } catch {
        // ignore JSON parse errors
      }
      markRunError(runId, errorText || "all models failed");
      return res;
    }

    // Success: mark complete when the response BODY actually finishes (a
    // streaming Response may still be sending tokens), mirroring the swarm
    // synthesis wrap. Non-streaming bodies complete immediately.
    if (res.body) {
      const originalBody = res.body;
      const trackStream = new ReadableStream({
        start(controller) {
          const reader = originalBody.getReader();
          const pump = () =>
            reader.read().then(({ done, value }) => {
              if (done) {
                controller.close();
                markRunComplete(runId);
                return;
              }
              controller.enqueue(value);
              return pump();
            }).catch(() => {
              try { controller.close(); } catch { /* already closed */ }
              markRunComplete(runId);
            });
          pump();
        },
        cancel() {
          // Client disconnected — mark complete to avoid stuck telemetry.
          markRunComplete(runId);
        },
      });
      return new Response(trackStream, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    markRunComplete(runId);
    return res;
  } catch (error) {
    if (runId) markRunError(runId, error?.message || error);
    throw error;
  }
}

/**
 * Handle a fusion combo: fan the prompt out to every panel model in parallel,
 * then a judge model synthesizes one final answer from all panel responses.
 *
 * Panel calls are forced non-streaming with tools stripped (the judge needs
 * complete prose to synthesize). The judge call keeps the client's original
 * stream flag + tools, so streaming and downstream tool use still work.
 *
 * Speed: quorum-grace collection caps the straggler penalty. Quality: the judge
 * runs the consensus/contradiction/blind-spot analysis before writing.
 *
 * Degrades gracefully: 0 panel answers -> 503, exactly 1 -> return it directly.
 *
 * @param {Object} options
 * @param {Object} options.body - Request body (client format)
 * @param {string[]} options.models - Panel model strings
 * @param {Function} options.handleSingleModel - (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger
 * @param {string} [options.comboName] - Combo name (logging)
 * @param {string} [options.judgeModel] - Judge model; falls back to panel[0]
 * @param {Object} [options.tuning] - Override FUSION_DEFAULTS (minPanel, grace, timeout)
 * @returns {Promise<Response>}
 */
export async function handleFusionChat({ body, models, handleSingleModel, log, comboName, judgeModel, tuning, signal, runBudget }) {
  const panel = Array.isArray(models) ? models.filter(Boolean) : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Fusion combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // A single-model fusion has nothing to fuse — just answer directly.
  if (panel.length === 1) {
    const single = await handleSingleModel(body, panel[0], { role: "judge" });
    return single.response;
  }

  // Capability gate: the Judge role requires tool use + file access. Web cookie
  // providers cannot review/synthesize panel outputs with codebase context.
  // Pass `panel` as fallback so empty judgeModel (Auto) is validated against panel[0].
  const roleViolations = validateComboRoles("fusion", { judgeModel }, panel);
  if (roleViolations.length > 0) {
    const details = roleViolations.map((v) => v.reason).join(" ");
    return new Response(
      JSON.stringify({ error: { message: `Fusion role validation failed: ${details}`, type: "capability_error" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  log.info("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  // Bounded-leg helper: the synthesis legs (survivor re-run, judge) get the
  // same hard cap as the panel fan-out. Without it a hung model stalls the
  // whole request until the client disconnects — the fan-out was capped but
  // these final calls were unbounded. Uses createAbortableTask directly (like
  // the panel fan-out) so the timeout ABORTS the underlying provider call and
  // cleanup() releases the run-level abort listener. Timeout → 504;
  // client-disconnect aborts rethrow so the caller's contract
  // (dispatchComboByName catch) is preserved unchanged.
  const runTimedLeg = async (taskFactory, label) => {
    const task = createAbortableTask(taskFactory, cfg.panelHardTimeoutMs, signal);
    const result = await task.promise;
    task.cleanup();
    if (result?.__error?.name === "AbortError") throw result.__error;
    if (result?.__timeout) {
      log.warn("FUSION", `${label} timed out after ${cfg.panelHardTimeoutMs}ms`);
      return new Response(
        JSON.stringify({ error: { message: `${label} timed out` } }),
        { status: 504, headers: { "Content-Type": "application/json" } },
      );
    }
    if (result?.__error) {
      log.warn("FUSION", `${label} error: ${result.__error?.message || result.__error}`);
      return new Response(
        JSON.stringify({ error: { message: `${label} failed: ${result.__error?.message || "unknown error"}` } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    return result;
  };

  // 1. Fan out to the panel in parallel: non-streaming, tools stripped.
  const format = inferConversationFormat(body);
  const panelBody = buildCoordinatorBody(body, format);
  const tasks = panel.map((m) => createAbortableTask(
    (childSignal) => handleSingleModel(panelBody, m, { isPanel: true, signal: childSignal, trafficClass: "panel", role: "panel" }),
    cfg.panelHardTimeoutMs,
    signal,
  ));
  const t0 = Date.now();
  const settled = await collectPanel(tasks.map((task) => task.promise), {
    ...cfg,
    minPanel,
    onFinish: () => tasks.forEach((task) => task.abort("fusion panel closed")),
  });
  tasks.forEach((task) => task.cleanup());
  log.info("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  // 2. Collect successful answers.
  // We keep the original Response object alongside the extracted text so that
  // the single-survivor path can return it directly without re-running the
  // model (which would waste a second inference call + be non-deterministic).
  const answers = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = panel[i];
    if (!res) { log.warn("FUSION", `Panel ${model} dropped (straggler/timeout)`); continue; }
    if (res.__timeout) { log.warn("FUSION", `Panel ${model} timed out`); continue; }
    if (res.__error) { log.warn("FUSION", `Panel ${model} threw`, { error: res.__error?.message || String(res.__error) }); continue; }
    // Wave 1C: application success came from ChatResult.success. Commit F: panels are
    // stream:false and consumed via .json(), so use the finalized canonical attempt.
    if (!candidateServed(res)) { log.warn("FUSION", `Panel ${model} failed`, { status: res.status ?? res.response?.status }); continue; }
    try {
      const json = await res.response.clone().json();
      const text = extractPanelText(json);
      if (text) {
        const budgeted = runBudget ? runBudget.clampOutput(text) : text;
        if (!budgeted) { log.warn("FUSION", `Panel ${model} exceeded output budget`); continue; }
        answers.push({ model, text: budgeted, res });
        log.info("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e) {
      log.warn("FUSION", `Panel ${model} unparseable`, { error: e.message || String(e) });
    }
  }

  // 3. Degrade gracefully when the panel is too thin to fuse.
  if (answers.length === 0) {
    log.warn("FUSION", "All panel models failed");
    return new Response(
      JSON.stringify({ error: { message: "All fusion panel models failed" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (answers.length === 1) {
    // Single-survivor fallback. We already have a valid panel response, but it
    // was forced to stream:false (the panel needs complete prose for judging).
    // If the client requested streaming, returning that non-streaming response
    // would silently downgrade SSE→JSON and break clients waiting on an event
    // stream. In that case, re-invoke the survivor with the ORIGINAL body so
    // the stream flag (and tools) are honored. For non-streaming requests we
    // return the panel response directly — no point re-billing the same call.
    const wantsStream = body?.stream === true;
    if (wantsStream) {
      log.info("FUSION", `Only ${answers[0].model} succeeded — re-running with stream:true to honor client SSE request (no fusion)`);
      return runTimedLeg(
        // Wave 1C: the closure yields ChatResult — unwrap to the transport
        // Response so runTimedLeg's contract (and the caller) stay unchanged.
        (childSignal) => handleSingleModel(body, answers[0].model, { role: "panel", signal: childSignal, trafficClass: "user" }).then((r) => r.response),
        `Re-run ${answers[0].model}`,
      );
    }
    log.info("FUSION", `Only ${answers[0].model} succeeded — returning its response directly (no fusion, no re-run)`);
    return answers[0].res.response;
  }

  // 4. Judge analyzes + writes one final answer (streams to client if requested).
  const maxJudgeChars = runBudget?.limits?.maxOutputChars || 120000;
  const judgeBody = appendDirective(body, clampText(buildJudgePrompt(answers), maxJudgeChars), format);
  log.info("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return runTimedLeg(
    (childSignal) => handleSingleModel(judgeBody, judge, { role: "judge", signal: childSignal, trafficClass: "user" }).then((r) => r.response),
    `Judge ${judge}`,
  );
}

// ── Cascade ────────────────────────────────────────────────────────────
//
// Progressive escalation: try models in order (cheapest → most capable).
// Each stage asks the model to self-rate its confidence (0-100). If confidence
// ≥ threshold, return the answer. If below, inject the prior answer as context
// and escalate to the next (stronger) model. The final stage always returns
// regardless of confidence — guaranteeing a response.
//
// Cost savings: ~80% of simple requests finish at stage 1 (cheap model), so
// the expensive model is only invoked for genuinely hard tasks.
//
// Config (strategyConfig.cascade):
//   confidenceThreshold: 0-100 (default 70) — escalate below this
//   confidencePrompt:    suffix appended to ask the model to rate itself
//   escalatePrompt:     prefix injected when escalating with prior output
//   maxStages:           1-8 (default 3) — cap iterations

const CASCADE_DEFAULTS = {
  confidenceThreshold: 70,
  confidencePrompt: "Rate your confidence in this answer from 0 to 100. End your response with exactly: CONFIDENCE: <number>",
  escalatePrompt: "A prior model gave the following answer with low confidence. Review it, correct any issues, and provide a better answer.",
  maxStages: 3,
};

// Parse "CONFIDENCE: <number>" from the end of the model's text output.
// Returns -1 when no confidence marker is found (treat as "unknown → escalate").
function parseConfidence(text) {
  if (!text || typeof text !== "string") return -1;
  const match = text.match(/CONFIDENCE:\s*(\d{1,3})\s*$/i);
  if (!match) return -1;
  const val = Number.parseInt(match[1], 10);
  return Number.isFinite(val) && val >= 0 && val <= 100 ? val : -1;
}

// Strip the confidence marker from the answer so the client never sees it.
function stripConfidenceMarker(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/\s*CONFIDENCE:\s*\d{1,3}\s*$/i, "").trim();
}

/**
 * External protocol adapter for Cascade. Internal stages are consumed as
 * finalized JSON (stream:false) so CONFIDENCE can be parsed; the client's
 * stream contract must still be honored on the outer boundary.
 *
 * When the client requested stream:true, wrap the finalized JSON as OpenAI SSE
 * (the dominant client format for Cascade); otherwise return the JSON Response.
 * Fail-safe: if JSON parsing or adaptation throws, return the original JSON
 * Response (preserving an observable success rather than masking it as a 502).
 */
async function adaptCascadeResponse(result, clientBody, log, label) {
  if (!clientBody?.stream) return result.response;
  // Best-effort: convert the finalized OpenAI chat.completion JSON to a
  // virtual SSE stream so a streaming client's event parser sees content.
  // Loaded lazily to avoid circular import cycles.
  try {
    const json = await result.response.clone().json();
    const { openAICompletionJsonToSSE } = await import("../utils/sse.js");
    const sseResponse = openAICompletionJsonToSSE(json);
    log.info("CASCADE", `${label} converted finalized JSON → SSE for stream:true client`);
    return sseResponse;
  } catch (err) {
    log.warn("CASCADE", `${label} adapter failed, returning JSON fallback: ${err?.message || err}`);
    return result.response;
  }
}

/**
 * Handle a cascade combo: progressive escalation from cheap to capable models.
 *
 * @param {Object} options
 * @param {Object} options.body - request body
 * @param {string[]} options.models - ordered list of models (cheapest first)
 * @param {Function} options.handleSingleModel - (body, model, opts) => Response
 * @param {Object} options.log - logger
 * @param {string} options.comboName - combo name (logging)
 * @param {Object} [options.tuning] - override CASCADE_DEFAULTS
 * @param {AbortSignal} [options.signal] - run-level abort signal
 * @param {Object} [options.runBudget] - combo output-budget guard (clamp per stage)
 * @returns {Promise<Response>}
 */
export async function handleCascadeChat({ body, models, handleSingleModel, log, comboName, tuning, signal, runBudget }) {
  const panel = Array.isArray(models) ? models.filter(Boolean) : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Cascade combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const cfg = { ...CASCADE_DEFAULTS, ...(tuning || {}) };
  const maxStages = Math.min(Math.max(1, cfg.maxStages), panel.length);
  const format = inferConversationFormat(body);

  // The coordinator body strips tools (cascade stages are plain-text Q&A).
  const baseBody = buildCoordinatorBody(body, format);

  let priorAnswer = null;
  let priorModel = null;

  for (let stage = 0; stage < maxStages; stage++) {
    const model = panel[stage];
    const isFinal = stage === maxStages - 1;

    // Build the stage body: first stage gets the confidence prompt appended;
    // escalation stages get the prior answer + escalate prompt + confidence prompt.
    let stageBody = baseBody;
    if (priorAnswer != null) {
      const escalateText = `${cfg.escalatePrompt}\n\n--- Prior Answer (${priorModel}) ---\n${clampText(priorAnswer, 60000)}\n--- End Prior Answer ---\n\n${cfg.confidencePrompt}`;
      stageBody = appendDirective(stageBody, escalateText, format);
    } else {
      stageBody = appendDirective(stageBody, cfg.confidencePrompt, format);
    }

    log.info("CASCADE", `Stage ${stage + 1}/${maxStages}: ${model}${priorAnswer ? " (escalated)" : ""}`);

    let res;
    try {
      res = await handleSingleModel(stageBody, model, { isPanel: true, role: "worker", signal });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      log.warn("CASCADE", `Stage ${stage + 1} (${model}) threw: ${err?.message || err}`);
      if (isFinal) {
        return new Response(
          JSON.stringify({ error: { message: `Cascade failed at final stage: ${err?.message || "unknown"}` } }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }
      priorAnswer = null;
      priorModel = model;
      continue;
    }

    // Handle timeout/error markers from withTimeout-style wrappers.
    if (res?.__timeout || res?.__error) {
      log.warn("CASCADE", `Stage ${stage + 1} (${model}) ${res.__timeout ? "timed out" : "errored"}`);
      if (isFinal) {
        return new Response(
          JSON.stringify({ error: { message: `Cascade failed at final stage` } }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }
      priorAnswer = null;
      priorModel = model;
      continue;
    }

    // Wave 1C: application success came from ChatResult.success. Commit F: cascade stages are
    // stream:false and consumed via .json(), so use the finalized canonical attempt.
    if (!candidateServed(res)) {
      log.warn("CASCADE", `Stage ${stage + 1} (${model}) returned status ${res?.status ?? res?.response?.status}`);
      if (isFinal) return res.response;
      priorAnswer = null;
      priorModel = model;
      continue;
    }

    // Final stage always returns — no confidence check needed.
    if (isFinal) {
      log.info("CASCADE", `Final stage (${model}) returning`);
      return await adaptCascadeResponse(res, body, log, `Stage ${stage + 1} (${model})`);
    }

    // Extract text + parse confidence.
    let text = "";
    try {
      const json = await res.response.clone().json().catch(() => ({}));
      text = extractPanelText(json);
      // Budget guard: clamp stage output before it feeds the next escalation.
      if (text && runBudget) text = runBudget.clampOutput(text);
    } catch { /* best-effort */ }

    const confidence = parseConfidence(text);
    log.info("CASCADE", `Stage ${stage + 1} (${model}) confidence=${confidence}`);

    if (confidence >= 0 && confidence >= cfg.confidenceThreshold) {
      // Confident enough — return. The CONFIDENCE marker is a trailing line
      // that most clients will ignore; we don't re-serialize the response.
      log.info("CASCADE", `Stage ${stage + 1} confident (${confidence} ≥ ${cfg.confidenceThreshold}) — returning`);
      return await adaptCascadeResponse(res, body, log, `Stage ${stage + 1} (${model})`);
    }

    // Below threshold (or unparseable) — escalate with prior answer as context.
    priorAnswer = stripConfidenceMarker(text) || text;
    priorModel = model;
  }

  // Should not reach here (final stage always returns), but guard anyway.
  return new Response(
    JSON.stringify({ error: { message: "Cascade exhausted all stages" } }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  );
}

// Re-export the Hierarchical Swarm engine from this barrel so chat.js keeps a
// single import surface for all combo strategies.
export { handleSwarmChat, SWARM_DEFAULTS } from "./swarm.js";

// Commit F: shared finalized-success gate, consumed by the outer fallback loop,
// Fusion panels, Cascade stages, and (via swarm.js) Swarm worker legs.
export { candidateServed };
