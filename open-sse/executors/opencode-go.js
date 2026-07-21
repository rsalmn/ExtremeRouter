import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";

// Models that use /zen/go/v1/messages (Anthropic/Claude format + x-api-key auth)
const MESSAGES_FORMAT_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
]);

const BASE = "https://opencode.ai/zen/go/v1";

// Effort-tier aliases — models on opencode-go that support per-effort suffixes.
// Each entry maps the canonical base id to the set of effort tiers the upstream
// supports. parseEffortLevel() parses the suffix (e.g. "glm-5.2-high" →
// baseModel "glm-5.2", effort "high"), transformRequest rewrites body.model to
// the canonical id and injects reasoning_effort if not already set by client.
//
// Tier support varies per upstream:
//   - deepseek-v4-pro: all four tiers (low/medium/high/max)
//   - glm-5.2:        high/max only (Z.AI maps these through the reasoning
//                     plane; low/medium are not supported on OpenAI transport)
//   - mimo-v2.5:      high/max only (Xiaomi MiMo does not document low/medium)
//
// Port of OmniRoute commit 1843b34 (PR #6987, issue #6922).
const EFFORT_LEVELS = ["low", "medium", "high", "max"];
const EFFORT_TIERS = {
  "deepseek-v4-pro": EFFORT_LEVELS,
  "glm-5.2": ["high", "max"],
  "mimo-v2.5": ["high", "max"],
};

/**
 * Parse a model string with an effort-level suffix.
 * e.g. "deepseek-v4-pro-low" → { baseModel: "deepseek-v4-pro", effort: "low" }
 *      "glm-5.2-high"         → { baseModel: "glm-5.2", effort: "high" }
 * Returns null if the model doesn't match any known effort-tier pattern.
 */
export function parseEffortLevel(model) {
  const m = String(model || "");
  for (const [baseModel, levels] of Object.entries(EFFORT_TIERS)) {
    for (const level of levels) {
      if (m === `${baseModel}-${level}`) {
        return { baseModel, effort: level };
      }
    }
  }
  return null;
}

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  // buildUrl runs before buildHeaders in BaseExecutor.execute, cache the
  // CANONICAL model here (strip effort-tier suffix if present) so buildHeaders
  // checks the right id against MESSAGES_FORMAT_MODELS.
  buildUrl(model) {
    const parsed = parseEffortLevel(model);
    const canonical = parsed ? parsed.baseModel : model;
    this._lastModel = canonical;
    return MESSAGES_FORMAT_MODELS.has(canonical)
      ? `${BASE}/messages`
      : `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (MESSAGES_FORMAT_MODELS.has(this._lastModel)) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = { ...(body && typeof body === "object" ? body : {}) };

    // Effort-tier alias: rewrite body.model to canonical id and inject
    // reasoning_effort (only if the client hasn't set one explicitly).
    const parsed = parseEffortLevel(model);
    if (parsed) {
      transformed.model = parsed.baseModel;
      if (transformed.reasoning_effort === undefined) {
        transformed.reasoning_effort = parsed.effort;
      }
      // Pass the canonical model to injectReasoningContent so capability
      // lookups (which key on base ids, not aliases) resolve correctly.
      return injectReasoningContent({
        provider: this.provider,
        model: parsed.baseModel,
        body: transformed,
      });
    }

    return injectReasoningContent({ provider: this.provider, model, body: transformed });
  }
}
