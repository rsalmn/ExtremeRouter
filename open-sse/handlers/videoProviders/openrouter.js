// OpenRouter video jobs — https://openrouter.ai/docs/api/api-reference/videos
//
// Same async submit+poll shape as xAI, two differences only:
//   1. creation POSTs to the /videos collection root (no `/generations` suffix)
//   2. account headers (HTTP-Referer / X-Title) come from the registry entry
// Response bodies pass through verbatim; poll uses { id } not { request_id }.
//
// Text-to-video only — OpenRouter has no edits/extensions endpoint today.
import { sleep, nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "../imageProviders/_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const CFG = PROVIDER_MEDIA.openrouter?.videoConfig;
const BASE_URL = CFG?.baseUrl || "https://openrouter.ai/api/v1/videos";

function validationError(message) {
  const error = new Error(message);
  error.isValidationError = true;
  return error;
}

function headers(config, token) {
  return {
    Accept: "application/json",
    ...(config?.headers || CFG?.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function firstUrl(result) {
  if (typeof result?.url === "string" && result.url) return result.url;
  if (typeof result?.video?.url === "string" && result.video.url) return result.video.url;
  if (typeof result?.unsigned_url === "string" && result.unsigned_url) return result.unsigned_url;
  const list = result?.unsigned_urls;
  if (Array.isArray(list) && typeof list[0] === "string" && list[0]) return list[0];
  return null;
}

function failureMessage(result) {
  return result?.error?.message || result?.error?.code || result?.error || "OpenRouter video generation failed";
}

export default {
  async: true,
  // Collection root — OpenRouter creation is POST /videos, not /videos/generations.
  buildUrl: () => BASE_URL.replace(/\/$/, ""),
  buildHeaders: (credentials) => {
    const token = credentials?.apiKey || credentials?.accessToken;
    if (!token) throw validationError("OpenRouter video requires an API key");
    return {
      ...headers(CFG, token),
      "Content-Type": "application/json",
    };
  },
  buildBody: (model, body) => {
    if (!model || typeof model !== "string") {
      throw validationError("Missing required field: model");
    }
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      throw validationError("Missing required field: prompt");
    }
    // Verbatim passthrough of documented fields — unknown extras are dropped
    // so a client cannot smuggle auth/header fields into the JSON body.
    const payload = {
      model,
      prompt: body.prompt,
    };
    if (body.duration !== undefined && body.duration !== null) payload.duration = body.duration;
    if (body.aspect_ratio) payload.aspect_ratio = body.aspect_ratio;
    if (body.resolution) payload.resolution = body.resolution;
    if (body.seed !== undefined && body.seed !== null) payload.seed = body.seed;
    if (body.negative_prompt) payload.negative_prompt = body.negative_prompt;
    return payload;
  },
  async parseResponse(response, { headers: reqHeaders }) {
    const submitted = await response.json();
    const jobId = submitted?.id || submitted?.request_id;
    if (typeof jobId !== "string" || !jobId) {
      throw new Error("OpenRouter: no job id returned");
    }

    const pollUrl = `${BASE_URL.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const pollResponse = await fetch(pollUrl, { headers: reqHeaders });
      if (pollResponse.status === 404) {
        throw new Error("OpenRouter: video job was not found or expired");
      }
      if (!pollResponse.ok) {
        throw new Error(`OpenRouter video status ${pollResponse.status}`);
      }
      if (pollResponse.status === 202) continue;

      const result = await pollResponse.json();
      const status = String(result?.status || "").toLowerCase();
      if (status === "completed" || status === "succeeded" || status === "done") {
        const url = firstUrl(result);
        if (!url) throw new Error("OpenRouter: video completed with no output url");
        return { ...result, _url: url, _id: jobId };
      }
      if (status === "failed" || status === "expired" || status === "cancelled" || status === "error") {
        throw new Error(`OpenRouter: ${status}: ${failureMessage(result)}`);
      }
      // queued / pending / processing stay bounded by POLL_TIMEOUT_MS.
    }
    throw new Error("OpenRouter video polling timeout");
  },
  normalize: (responseBody) => ({
    created: nowSec(),
    data: typeof responseBody?._url === "string" && responseBody._url
      ? [{ url: responseBody._url }]
      : [],
  }),
};
