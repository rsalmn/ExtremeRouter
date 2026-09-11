import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import { isMuseSparkModel } from "../providers/models/helpers.js";
import {
  normalizeResponsesInput,
  clampResponsesCallId,
  coerceResponsesArguments,
  coerceResponsesOutput,
  ensureResponsesObjectProperties,
} from "../translator/formats/responsesApi.js";

// Responses-only models live on the Go lane's /responses endpoint —
// /chat/completions 500s for Muse Spark; Grok 4.6 / GPT 5.6 Luna are
// Responses-API upstreams on the Go subscription (opencode.ai/docs/go).
const RESPONSES_BASE_URL = "https://opencode.ai/zen/go/v1/responses";
// Strict Responses upstreams reject nameless/overlong tool names (#444).
const MAX_TOOL_NAME_LEN = 128;

// Models that use /zen/go/v1/messages (Anthropic/Claude format + x-api-key auth)
const MESSAGES_FORMAT_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.8-max",
  "qwen3.8-flash",
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

// Strip the thinking suffix "model(level)" so checks hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  const id = baseModelId(model);
  // Registry targetFormat is the source of truth (muse-spark, grok-4.6,
  // gpt-5.6-luna). isMuseSparkModel catches passthrough discoveries that
  // are not in the static catalog.
  return getModelTargetFormat("opencode-go", id) === "openai-responses" || isMuseSparkModel(id);
}

// Flatten Chat Completions tool declarations into the Responses flat shape and
// drop hosted/nameless tools the /responses endpoint rejects.
function normalizeResponsesTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
    const rawName = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = typeof tool.description === "string" ? tool.description : (typeof fn?.description === "string" ? fn.description : "");
    // Mirror the request translator: strict Responses backends reject a bare
    // {type:"object"} without properties — the shared helper fills it in, so
    // this last-line-of-defense path can never drift from translation.
    const parameters = ensureResponsesObjectProperties(
      (tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters))
        ? tool.parameters
        : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : undefined)
    );
    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, MAX_TOOL_NAME_LEN);
    if (description) tool.description = description;
    tool.parameters = parameters;
    validNames.add(tool.name);
    return true;
  });
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = typeof body.tool_choice.name === "string" ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

// Last line of defense for native Responses clients (sourceFormat === targetFormat
// skips translation): coerce items in place so malformed tool payloads 400 here
// with a clear shape instead of upstream as InputValidationError.
function sanitizeResponsesItems(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    if (item.type === "function_call") {
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") return false;
      item.name = item.name.trim().slice(0, MAX_TOOL_NAME_LEN);
      item.call_id = clampResponsesCallId(item.call_id);
      item.arguments = coerceResponsesArguments(item.arguments);
      return true;
    }
    if (item.type === "function_call_output") {
      item.call_id = clampResponsesCallId(item.call_id);
      item.output = coerceResponsesOutput(item.output);
      return true;
    }
    return true;
  });
}

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  // buildUrl runs before buildHeaders in BaseExecutor.execute, cache the
  // CANONICAL model here (strip effort-tier suffix if present) so buildHeaders
  // checks the right id against MESSAGES_FORMAT_MODELS.
  buildUrl(model) {
    // Muse Spark lives on /responses even when a stale runtimeTransport leaks in.
    if (isResponsesModel(model)) return RESPONSES_BASE_URL;
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

    const out = injectReasoningContent({ provider: this.provider, model, body: transformed });
    if (!isResponsesModel(model || out?.model)) return out;

    // Responses normalization for the Muse Spark /responses lane. injectReasoningContent
    // is a chat-completions concern (messages[]) — a no-op on Responses input[].
    const normalized = normalizeResponsesInput(out.input);
    if (normalized) out.input = normalized;
    if (!Array.isArray(out.input) || out.input.length === 0) {
      out.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }
    // Responses names the output cap max_output_tokens, not max_tokens.
    if (out.max_output_tokens === undefined) {
      if (out.max_completion_tokens !== undefined) out.max_output_tokens = out.max_completion_tokens;
      else if (out.max_tokens !== undefined) out.max_output_tokens = out.max_tokens;
    }
    delete out.max_tokens;
    delete out.max_completion_tokens;
    if (out.reasoning_effort !== undefined && out.reasoning === undefined) {
      out.reasoning = { effort: out.reasoning_effort, summary: "auto" };
    }
    if (out.reasoning && typeof out.reasoning === "object" && !Array.isArray(out.reasoning)) {
      if (!out.reasoning.summary) out.reasoning.summary = "auto";
    }
    delete out.reasoning_effort;
    out.stream = true;
    out.store = false;
    normalizeResponsesTools(out);
    sanitizeResponsesItems(out);
    return out;
  }
}
