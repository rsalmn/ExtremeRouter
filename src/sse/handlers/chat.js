import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { readBodyWithLimit } from "../utils/bodyLimiter.js";
import { checkRateLimit, evictExpiredBuckets } from "../utils/rateLimiter.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getPxpipeDir } from "@/lib/pxpipe/manager.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat, handleSwarmChat } from "open-sse/services/combo.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { recordBreakerSuccess, recordBreakerFailure, isRetryableFailure, releaseBreakerProbe } from "open-sse/services/circuitBreaker.js";
import { recordHealthSample } from "open-sse/services/healthMonitor.js";
import { getApiKeyByKey } from "@/lib/localDb";

// M2 FIX: normalize a combo strategy string to a known value. Accepts case
// variants + surrounding whitespace ("FUSION", "Round-Robin ", " Swarm ") and
// maps unknown values to "fallback" so a typo or client-injected junk never
// silently mis-dispatches. The previous exact-case compares meant "FUSION"
// fell through to handleComboChat as plain fallback with no indication.
const KNOWN_STRATEGIES = new Set(["fallback", "round-robin", "fusion", "swarm"]);
function normalizeStrategy(raw) {
  if (typeof raw !== "string") return "fallback";
  const s = raw.trim().toLowerCase();
  return KNOWN_STRATEGIES.has(s) ? s : "fallback";
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    // C2 FIX: Limit body size to prevent OOM/DoS (10 MB max for chat)
    const bodyText = await readBodyWithLimit(request, 10 * 1024 * 1024);
    body = JSON.parse(bodyText);
  } catch (e) {
    if (e.message?.includes("too large")) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, e.message);
    }
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  // Log request endpoint and model
  const url = new URL(request.url);
  const modelStr = body.model;

  // Count messages (support both messages[] and input[] formats)
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`);

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);

  // C3 FIX: Rate limiting — keyed on API key or client IP
  const rateLimitKey = apiKey || clientRawRequest?.headers?.["x-9r-real-ip"] || "anonymous";
  const rateLimit = checkRateLimit(rateLimitKey);
  evictExpiredBuckets(); // lazy eviction
  if (!rateLimit.allowed) {
    log.warn("RATE", `Rate limited: ${rateLimitKey.slice(0, 12)}... retry in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s`);
    return new Response(
      JSON.stringify({
        error: {
          message: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)} seconds.`,
          type: "rate_limit_error",
          code: "rate_limited",
        },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
        },
      },
    );
  }

  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Per-Key Model Access Control: if the resolved API key has an allowedModels
  // list, reject requests to models not in the list.
  // H2 FIX: Enforce ACL whenever an API key is present, regardless of
  // requireApiKey setting. Previously this was gated on requireApiKey=true,
  // meaning local mode (requireApiKey=false) had no model ACL at all.
  if (apiKey) {
    try {
      const keyObj = await getApiKeyByKey(apiKey);
      if (keyObj && Array.isArray(keyObj.allowedModels) && keyObj.allowedModels.length > 0) {
        const allowed = keyObj.allowedModels;
        const requestedModel = modelStr.includes("/") ? modelStr : modelStr;
        const isAllowed = allowed.some((m) => {
          if (m === requestedModel) return true;
          // Allow prefix match for combo names (e.g. "glm/" matches "glm/glm-5")
          if (m.endsWith("/") && requestedModel.startsWith(m)) return true;
          return false;
        });
        if (!isAllowed) {
          log.warn("AUTH", `Model "${modelStr}" not allowed for key "${keyObj.name || keyObj.id}"`);
          return errorResponse(HTTP_STATUS.FORBIDDEN, `Model "${modelStr}" is not allowed for this API key`);
        }
      }
    } catch (aclErr) {
      log.warn("AUTH", `ACL check error: ${aclErr?.message || aclErr}`);
    }
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = normalizeStrategy(comboSpecificStrategy || settings.comboStrategy || "fallback");

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, { skipBreaker: isPanel });
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    if (comboStrategy === "swarm") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: swarm)`);
      const swarmCfg = comboStrategies[modelStr] || {};
      return handleSwarmChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, { skipBreaker: isPanel });
        },
        log,
        comboName: modelStr,
        managerModel: swarmCfg.managerModel,
        staffModel: swarmCfg.staffModel,
        auditModel: swarmCfg.auditModel,
        workerCount: swarmCfg.workerCount,
        swarmTuning: swarmCfg.swarmTuning,
        telemetry: swarmCfg.enableTelemetry !== false,
      });
    }

    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
      breakerSettings: settings,
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, opts = {}) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = normalizeStrategy(comboSpecificStrategy || chatSettings.comboStrategy || "fallback");

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, { skipBreaker: isPanel });
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      if (comboStrategy === "swarm") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: swarm)`);
        const swarmCfg = comboStrategies[modelStr] || {};
        return handleSwarmChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, { skipBreaker: isPanel });
          },
          log,
          comboName: modelStr,
          managerModel: swarmCfg.managerModel,
          staffModel: swarmCfg.staffModel,
          auditModel: swarmCfg.auditModel,
          workerCount: swarmCfg.workerCount,
          swarmTuning: swarmCfg.swarmTuning,
          telemetry: swarmCfg.enableTelemetry !== false,
        });
      }

      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        breakerSettings: chatSettings,
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Log model routing (alias → actual model)
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Log account selection
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const pxpipeDir = getPxpipeDir();
    const attemptStart = Date.now();
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeDir: pxpipeDir,
      pxpipeMinChars: chatSettings.pxpipeMinChars || 25000,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs || 5000,
      semanticCacheEnabled: !!chatSettings.semanticCacheEnabled,
      semanticCacheThreshold: typeof chatSettings.semanticCacheThreshold === "number" ? chatSettings.semanticCacheThreshold : 0.85,
      providerThinking,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    }).catch(err => {
      // Probe-slot leak fix: if handleChatCore throws (abort, network error),
      // release the claimed half-open probe slot so the breaker doesn't get stuck.
      releaseBreakerProbe(provider);
      throw err;
    });

    if (result.success) {
      const latencyMs = Date.now() - attemptStart;
      // M6 FIX: panel calls (fusion/swarm fan-out) share the per-provider
      // breaker with non-combo traffic. Recording failures here would let a
      // flaky panel model trip the breaker and block single-model requests
      // to the same provider. skipBreaker isolates panel outcomes so only the
      // final user-facing call (judge/synthesis/direct) affects breaker state.
      if (!opts.skipBreaker) recordBreakerSuccess(provider, chatSettings);
      recordHealthSample(provider, { success: true, latencyMs }, chatSettings);
      return result.response;
    }

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    // H3 FIX: Pass the vault keyName from credentials so markVaultKeyRateLimited
    // targets the exact key that errored, not LAST_ISSUED (which races under concurrency).
    const vaultKey = credentials.connectionId === "vault" ? credentials.connectionName?.replace("Vault · ", "") : null;
    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.resetsAtMs, vaultKey);

    // Record health + circuit breaker for retryable failures only.
    const latencyMs = Date.now() - attemptStart;
    recordHealthSample(provider, { success: false, latencyMs, status: result.status }, chatSettings);
    if (isRetryableFailure(result.status) && !opts.skipBreaker) {
      recordBreakerFailure(provider, result.status, chatSettings);
    }

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
