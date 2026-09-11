import { createErrorResult, createErrorResultFromError, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { getExecutor } from "../executors/index.js";
import { getVideoAdapter } from "./videoProviders/index.js";
import { getModelType } from "../config/providerModels.js";
import { safeFetchMediaResult } from "../utils/mediaResultDownload.js";
import { registerMediaResult, mediaResultPath } from "../services/mediaResultStore.js";

function serializeRequestBody(requestBody) {
  if (typeof FormData !== "undefined" && requestBody instanceof FormData) return requestBody;
  if (typeof requestBody === "string") return requestBody;
  return JSON.stringify(requestBody);
}

/**
 * Core video generation handler — orchestrator only.
 * Provider-specific URL/headers/body/parse/normalize live in `./videoProviders/{id}.js`.
 *
 * Generation is ASYNC (submit → poll) but executed in-process (blocking) so the
 * response is only produced once the task completes, times out, or fails. This
 * matches the existing image media architecture — there is no persisted job
 * table or background worker.
 *
 * @param {object} options
 * @param {object} options.body - Request body { model, prompt, duration, size, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} [options.log] - Logger
 * @param {boolean} [options.binaryOutput] - Proxy the completed video bytes instead of returning URLs
 * @param {function} [options.onCredentialsRefreshed]
 * @param {function} [options.onRequestSuccess]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleVideoGenerationCore({
  body,
  modelInfo,
  credentials,
  log,
  binaryOutput = false,
  mediaResultOrigin = "",
  onCredentialsRefreshed,
  onRequestSuccess,
}) {
  const { provider, model } = modelInfo;

  if (!body || typeof body !== "object") {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Invalid request body");
  }

  // Model-level capability gate: only models declared `kind: "video"` are
  // eligible. An image-only model (kind "image") or an untyped LLM model must
  // never reach a video adapter — `provider.video = true` is NOT the signal.
  const modelKind = getModelType(provider, model);
  if (modelKind !== "video") {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Model '${model}' does not support video generation`
    );
  }

  const adapter = getVideoAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support video generation`
    );
  }

  // Prompt is required unless the adapter declares I2V (e.g. Veo).
  if (!adapter.promptOptional) {
    if (!body.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
    }
  } else if (!body.prompt && !body.image && !body.image_url) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt or image");
  }

  const buildRequest = async () => {
    // buildUrl may be async (Vertex mints an OAuth token + project-scoped URL).
    // Rebuilt per attempt so the 401 → refresh → retry path picks up new credentials.
    const u = await adapter.buildUrl(model, credentials, body);
    const rb = await adapter.buildBody(model, body);
    const h = await adapter.buildHeaders(credentials, rb, model, body);
    return { url: u, headers: h, requestBody: rb };
  };

  let url;
  let headers;
  let requestBody;
  try {
    const built = await buildRequest();
    url = built.url;
    headers = built.headers;
    requestBody = built.requestBody;
  } catch (error) {
    // Adapter validation (unsupported ratio/duration, etc.) → 400 invalid request.
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, error.message || "Invalid video request");
  }
  log?.debug?.("VIDEO", `${provider.toUpperCase()} | ${model} | prompt="${body.prompt.slice(0, 50)}..."`);

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: serializeRequestBody(requestBody),
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("VIDEO", `Fetch error: ${errMsg}`);
    return createErrorResultFromError(error, HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // 401/403 — try token refresh, then retry once.
  const executor = getExecutor(provider);
  if (
    !executor?.noAuth &&
    !adapter.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for video generation`);
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retry = await buildRequest();
        providerResponse = await fetch(retry.url, {
          method: "POST",
          headers: retry.headers,
          body: serializeRequestBody(retry.requestBody),
        });
      } catch {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("VIDEO", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  // Submit+poll is provider-specific (parseResponse reads the task id, polls to
  // completion, and may throw on FAILED/timeout/malformed/missing-output).
  let parsed;
  try {
    parsed = await adapter.parseResponse(providerResponse, { headers, log, model, body });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("VIDEO", `Generation error: ${errMsg}`);
    return createErrorResultFromError(error, HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const normalized = adapter.normalize(parsed);
  let finalBody = normalized?.created && Array.isArray(normalized?.data) ? normalized : parsed;

  // Server-side auth header for authenticated-download provider artifacts.
  // Used to fetch bytes for binary output and (via the media route) playback,
  // without ever exposing the provider key to the client.
  const artifactAuthHeaders = () => {
    if (!adapter.requiresAuthenticatedDownload || !credentials) return undefined;
    const key = credentials.apiKey || credentials.accessToken;
    return key ? { Authorization: `Bearer ${key}` } : undefined;
  };

  // Binary output: proxy the completed video bytes through the SSRF-hardened
  // downloader (never the unguarded urlToBase64 path).
  if (binaryOutput) {
    const firstUrl = Array.isArray(finalBody?.data) ? finalBody.data[0]?.url : null;
    if (firstUrl) {
      const media = await safeFetchMediaResult(firstUrl, { headers: artifactAuthHeaders() });
      if (media) {
        return {
          success: true,
          response: new Response(media.buffer, {
            headers: {
              "Content-Type": media.mimeType,
              "Access-Control-Allow-Origin": "*",
            },
          }),
        };
      }
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to download generated video");
    }
  }

  // Authenticated-download providers: never expose the raw provider URL. Register
  // each artifact under an opaque ExtremeRouter media-result URL instead.
  if (adapter.requiresAuthenticatedDownload && Array.isArray(finalBody?.data)) {
    finalBody = {
      ...finalBody,
      data: finalBody.data.map((item) => {
        const u = item?.url;
        if (typeof u === "string" && /^https?:\/\//.test(u)) {
          const rec = registerMediaResult({
            provider,
            mediaType: "video",
            source: { kind: "remote-url", url: u },
            connectionId: credentials?.connectionId,
          });
          const path = mediaResultPath(rec.id);
          return { ...item, url: mediaResultOrigin ? `${mediaResultOrigin}${path}` : path };
        }
        return item;
      }),
    };
  }

  // Default: ExtremeRouter media-result URLs for authenticated providers, or the
  // provider's (public) URL for providers whose artifacts are safe to expose.
  return {
    success: true,
    response: new Response(JSON.stringify(finalBody), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}