import { detectFormat, getTargetFormat, resolveTransport } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { normalizeClaudePassthrough } from "../translator/formats/claude.js";
import { COLORS } from "../utils/stream.js";
import { createStreamController } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { getModelTargetFormat, getModelStrip, getModelUpstreamId, getModelType, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { parseSuffix } from "../translator/concerns/thinkingUnified.js";
import { isCacheable, cacheLookup, cacheStore } from "../services/semanticCache.js";
import { PROVIDERS } from "../config/providers.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { trackPendingRequest, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";

const cookieRefreshInProgress = new Set();
import { injectCaveman } from "../rtk/caveman.js";
import { compressWithPxpipe, formatPxpipeLog, formatPxpipeSizeLog, isPxpipePhantomSavings } from "../rtk/pxpipe.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog, isHeadroomPhantomSavings } from "../rtk/headroom.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
export async function handleChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId, userAgent, apiKey, ccFilterNaming, rtkEnabled, headroomEnabled, headroomUrl, headroomCompressUserMessages, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel, sourceFormatOverride, providerThinking, semanticCacheEnabled, semanticCacheThreshold, pxpipeEnabled, pxpipeDir, pxpipeMinChars, pxpipeTimeoutMs }) {
  const { provider, model } = modelInfo;
  const requestStartTime = Date.now();

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  // Semantic Cache — check for cached response before executing request.
  // Only applies to non-streaming, tool-free, sufficiently-long requests.
  if (semanticCacheEnabled && isCacheable(body, false, provider, model)) {
    const threshold = typeof semanticCacheThreshold === "number" ? semanticCacheThreshold : 0.85;
    // SECURITY: Partition cache by API key to prevent cross-user leakage
    const cacheIdentity = apiKey || connectionId || "local";
    const cached = cacheLookup(provider, model, body, threshold, cacheIdentity);
    if (cached) {
      log?.info?.("CACHE", `semantic cache ${cached.exact ? "HIT" : "near-hit"} (${(cached.similarity * 100).toFixed(0)}% similarity) — returning cached response`);

      try {
        const forUsage = cached.response.clone ? cached.response.clone() : cached.response;
        const usageBody = await forUsage.json();
        const u = extractUsageFromResponse(usageBody);
        if (u && (u.prompt_tokens > 0 || u.completion_tokens > 0)) {
          const cacheTokensSaved = (u.prompt_tokens || 0) + (u.completion_tokens || 0);
          saveUsageStats({
            provider, model, tokens: u,
            connectionId, apiKey,
            endpoint: clientRawRequest?.endpoint || null,
            latency: { ttft: 0, total: Date.now() - requestStartTime },
            savedTokens: cacheTokensSaved,
            savedTokensByMechanism: { cache: cacheTokensSaved },
            fromCache: true,
            label: "CACHE",
          });
        }
      } catch { /* non-fatal: return the cached response without savings */ }

      const cachedResponse = cached.response.clone ? cached.response.clone() : cached.response;
      return { response: cachedResponse, url: "(cache)", headers: {}, transformedBody: body, fromCache: true, cacheSimilarity: cached.similarity };
    }
  }

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const targetFormat = modelTargetFormat || runtimeTransport?.format || getTargetFormat(provider);
  if (runtimeTransport && credentials) credentials.runtimeTransport = runtimeTransport;
  const stripList = getModelStrip(alias, model);
  const { cleanModel: cleanModelForUpstream } = parseSuffix(model);
  const upstreamModel = getModelUpstreamId(alias, cleanModelForUpstream);

  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  const clientRequestedStreaming = body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = PROVIDERS[provider]?.forceStream === true;
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, model);
  const isImageGenModel = modelType === "imageGen" || /image|imagen|image-generation/i.test(model);
  if (isImageGenModel && (provider === "antigravity" || provider === "gemini-cli")) {
    stream = false;
  }

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  // Only force non-streaming when client didn't explicitly request it.
  const detectedTool = detectClientTool(clientRawRequest?.headers || {}, body);
  if (detectedTool === "deepseek-tui" && body.stream !== true) stream = false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true && !providerRequiresStreaming) {
    stream = false;
  }

  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model);
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  // Expose raw client headers to translators/executors for session-id resolution
  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, model);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.("MODALITY", `stripped unsupported media for ${provider}/${model}`);
    }
    // Convert remote image URLs to base64 for targets that can't fetch URLs.
    try {
      // C4 FIX: Pass a real abort signal with timeout (not undefined) to prevent
      // indefinite hangs on slow/unresponsive image hosts. SSRF guard is applied
      // inside fetchImageAsBase64 via resolvePinnedIps which validates resolved IPs.
      const imgCtrl = new AbortController();
      const imgTimer = setTimeout(() => imgCtrl.abort(), 10_000); // 10s max per prefetch
      const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, { signal: imgCtrl.signal, timeoutMs: 10_000 });
      clearTimeout(imgTimer);
      if (n > 0) log?.debug?.("MODALITY", `prefetched ${n} remote image(s) for ${targetFormat}`);
    } catch (e) { log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`); }
  }

  let translatedBody;
  let toolNameMap;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model: upstreamModel };
    // Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
    if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, upstreamModel);
  } else {
    // C2 FIX: Pass the original `model` (WITH thinking suffix like "(high)") to
    // translateRequest so applyThinking's parseSuffix can extract the override.
    // The body.model is overwritten with the stripped upstreamModel on line 156
    // AFTER translation, so the suffix never leaks to the upstream provider.
    translatedBody = translateRequest(sourceFormat, targetFormat, model, body, stream, credentials, provider, reqLogger, stripList, connectionId, clientTool);
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    translatedBody.model = upstreamModel;
  }

  // Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // TTS models don't support tool messages/function calling
  if (getModelType(alias, model) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(msg => msg.role !== "tool");
    delete translatedBody.tools;
  }

  // RTK: compress tool_result content
  const rtkStats = compressMessages(translatedBody, rtkEnabled);
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);

  // Headroom: optional external proxy compression; fail open if proxy is absent.
  const headroomDiagnostics = {};
  const headroomStats = await compressWithHeadroom(translatedBody, { enabled: headroomEnabled, url: headroomUrl, model: upstreamModel, format: finalFormat, compressUserMessages: headroomCompressUserMessages, diagnostics: headroomDiagnostics });
  const headroomLine = formatHeadroomLog(headroomStats);
  const headroomSizeLine = formatHeadroomSizeLog(headroomDiagnostics);
  if (headroomLine) {
    log?.info?.("HEADROOM", `${headroomLine}${headroomSizeLine ? ` | ${headroomSizeLine}` : ""}`);
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics)) {
      log?.warn?.("HEADROOM", `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${headroomSizeLine}`);
    }
  } else if (headroomEnabled) log?.warn?.("HEADROOM", `skipped: ${headroomDiagnostics.reason || "compression unavailable"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`);

  // Caveman: inject terse-style system prompt
  if (cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    log?.debug?.("CAVEMAN", `${cavemanLevel} | ${finalFormat}`);
  }

  // Ponytail: inject lazy-senior-dev system prompt
  if (ponytailEnabled && ponytailLevel) {
    injectPonytail(translatedBody, finalFormat, ponytailLevel);
    log?.debug?.("PONYTAIL", `${ponytailLevel} | ${finalFormat}`);
  }

  // Pxpipe: multimodal prompt compression — render dense Claude bodies as PNGs.
  // Runs after Caveman/Ponytail so it compresses the final body including injected prompts.
  // Only applies to Claude format; fail-open on any error.
  const pxpipeDiagnostics = {};
  const pxpipeStats = await compressWithPxpipe(translatedBody, {
    enabled: pxpipeEnabled && finalFormat === "claude",
    pxpipeDir,
    minChars: pxpipeMinChars,
    timeoutMs: pxpipeTimeoutMs,
    diagnostics: pxpipeDiagnostics,
  });
  const pxpipeLine = formatPxpipeLog(pxpipeStats);
  const pxpipeSizeLine = formatPxpipeSizeLog(pxpipeDiagnostics);
  if (pxpipeLine) {
    log?.info?.("PXPIPE", `${pxpipeLine}${pxpipeSizeLine ? ` | ${pxpipeSizeLine}` : ""}`);
    if (isPxpipePhantomSavings(pxpipeStats, pxpipeDiagnostics)) {
      log?.warn?.("PXPIPE", `reported token delta, but body barely shrank | ${pxpipeSizeLine}`);
    }
  } else if (pxpipeEnabled && finalFormat === "claude") {
    log?.warn?.("PXPIPE", `skipped: ${pxpipeDiagnostics.reason || "unavailable"}`);
  }

  // Compute total tokens saved by RTK + Headroom + Pxpipe for this request.
  // Caveman/Ponytail savings are estimated later in the response handlers
  // (once completion_tokens are known) from a per-model moving-average baseline.
  const rtkBytesSaved = rtkStats ? (rtkStats.bytesBefore || 0) - (rtkStats.bytesAfter || 0) : 0;
  const rtkTokensSaved = Math.round(rtkBytesSaved / 4);
  const headroomTokensSaved = headroomStats?.tokens_saved || 0;
  const pxpipeTokensSaved = pxpipeStats?.tokensSaved || 0;
  const savedTokens = rtkTokensSaved + headroomTokensSaved + pxpipeTokensSaved;

  // Per-mechanism breakdown for the prompt-side savers (cache handled separately
  // on the HIT path). Caveman/Ponytail are appended by the response handlers.
  const savedTokensByMechanism = {};
  if (rtkTokensSaved > 0) savedTokensByMechanism.rtk = rtkTokensSaved;
  if (headroomTokensSaved > 0) savedTokensByMechanism.headroom = headroomTokensSaved;
  if (pxpipeTokensSaved > 0) savedTokensByMechanism.pxpipe = pxpipeTokensSaved;


  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => { });

  const msgCount = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || translatedBody.request?.contents?.length || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  const streamController = createStreamController({
    onDisconnect: (reason) => {
      trackPendingRequest(model, provider, connectionId, false);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId, false),
    log, provider, model
  });

  const proxyOptions = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody, executorRetryCount = 0;
  try {
    const result = await executor.execute({ model, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions });
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    executorRetryCount = result.retryCount || 0;

    if (result.refreshedCookie && credentials?.connectionId) {
      const connId = credentials.connectionId;
      if (!cookieRefreshInProgress.has(connId)) {
        cookieRefreshInProgress.add(connId);
        try {
          const { updateProviderConnection } = await import("@/lib/localDb");
          await updateProviderConnection(connId, { apiKey: result.refreshedCookie });
          log?.debug?.("COOKIE-REFRESH", `${provider} | auto-refreshed session cookie for ${connId.slice(0, 8)}`);
        } catch { /* non-fatal — next request will try again */ }
        finally { cookieRefreshInProgress.delete(connId); }
      }
    }

    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);

    // Semantic Cache — store successful non-streaming response for future lookups.
    if (semanticCacheEnabled && !stream && providerResponse?.ok && isCacheable(body, false, provider, model)) {
      try {
        const cloned = providerResponse.clone ? providerResponse.clone() : providerResponse;
        const cacheIdentity = apiKey || connectionId || "local";
        cacheStore(provider, model, body, cloned, undefined, cacheIdentity);
      } catch { /* fail-open: cache write failure should never break a request */ }
    }
  } catch (error) {
    trackPendingRequest(model, provider, connectionId, false, true);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: translatedBody || null,
      response: { error: error.message || String(error), status: error.name === "AbortError" ? 499 : 502, thinking: null },
      status: "error"
    })).catch(() => { });

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (!executor.noAuth && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    try {
      const newCredentials = await refreshWithRetry(() => executor.refreshCredentials(credentials, log), 3, log);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try { await onCredentialsRefreshed(newCredentials); } catch (e) { log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`); }
        }
        try {
          const retryResult = await executor.execute({ model, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions });
          if (retryResult.response.ok) { providerResponse = retryResult.response; providerUrl = retryResult.url; }
        } catch { log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`); }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e) {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e.message}`);
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      response: { error: message, status: statusCode, thinking: null },
      status: "error"
    })).catch(() => { });

    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    reqLogger.logError(new Error(message), finalBody || translatedBody);
    return createErrorResult(statusCode, errMsg, resetsAtMs);
  }

  const sharedCtx = {
    provider, model, body, stream, translatedBody, finalBody, requestStartTime,
    connectionId, apiKey, clientRawRequest, onRequestSuccess, savedTokens,
    savedTokensByMechanism,
    cavemanActive: !!cavemanEnabled, ponytailActive: !!ponytailEnabled,
    retryCount: executorRetryCount,
  };
  const appendLog = (extra) => appendRequestLog({ model, provider, connectionId, ...extra }).catch(() => { });
  const trackDone = () => trackPendingRequest(model, provider, connectionId, false);

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return result; }
  }

  // True non-streaming response
  if (!stream) {
    const result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, reqLogger, toolNameMap, trackDone, appendLog });
    streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({ ...sharedCtx });
  return handleStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, streamController, onStreamComplete, streamDetailId });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
