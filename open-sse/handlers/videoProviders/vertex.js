// Vertex AI (Veo) text/image-to-video.
//
// Vertex does NOT speak the OpenAI-ish videos shape, so this adapter translates
// both directions:
//   create → POST {base}/v1/projects/{p}/locations/{l}/publishers/google/models/{model}:predictLongRunning
//            body { instances[], parameters{} } → { name: "projects/…/operations/…" }
//   poll   → POST {base}/v1/{modelPath}:fetchPredictOperation
//            body { operationName } → { done, response, error? }
// Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation
//
// Auth: Service Account JSON via refreshVertexToken. Raw API keys are rejected
// up front — Veo requires OAuth cloud-platform scope. The core rebuilds the
// request plan on 401 → refresh → retry, so a re-mint is picked up automatically.
import { sleep, nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "../imageProviders/_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { parseVertexSaJson, refreshVertexToken } from "../../services/tokenRefresh.js";

const CFG = PROVIDER_MEDIA.vertex?.videoConfig;
const BASE_URL = (CFG?.baseUrl || "https://aiplatform.googleapis.com").replace(/\/$/, "");
const DEFAULT_LOCATION = "us-central1";

// Plain model id only — a path segment carrying "/" or ".." would rewrite the URL.
const MODEL_ID_RE = /^[A-Za-z0-9._-]+$/;
// Operation name shape: projects/{p}/locations/{l}/publishers/{pub}/models/{m}/operations/{op}.
// Anchored and single-segment-per-field so a decoded path can never carry `..` or a
// host-changing prefix into the request URL. (Even though ExtremeRouter polls the
// operation name returned by Vertex — not a client-supplied job id — a crafted or
// compromised upstream payload must still be unable to splice a path traversal.)
const OPERATION_NAME_RE = /^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\/[^/]+\/operations\/[^/]+$/;
// project/location come from credentials and are interpolated into the create URL.
const PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

function validationError(message) {
  const error = new Error(message);
  error.isValidationError = true;
  return error;
}

function modelPathOf(operationName) {
  return operationName.slice(0, operationName.indexOf("/operations/"));
}

function resolveProjectLocation(credentials) {
  const saJson = parseVertexSaJson(credentials?.apiKey);
  const projectId =
    saJson?.project_id ||
    credentials?.projectId ||
    credentials?.providerSpecificData?.projectId;
  const location = credentials?.providerSpecificData?.location || DEFAULT_LOCATION;
  if (!projectId) {
    throw validationError(
      "Vertex video requires a project_id — use Service Account JSON or set providerSpecificData.projectId"
    );
  }
  // Reject path separators / traversal in credential-derived URL segments.
  if (!PATH_SEGMENT_RE.test(String(projectId)) || !PATH_SEGMENT_RE.test(String(location))) {
    throw validationError("Vertex video: invalid project_id or location");
  }
  return { saJson, projectId, location };
}

function bareModelId(body, model) {
  let id = body?.model || model;
  if (!id || typeof id !== "string") {
    throw validationError("Vertex video requires a model (e.g. vertex/veo-3.1-generate-preview)");
  }
  // Allow exactly one provider prefix ("vertex/veo-…"). Extra slashes or embedded
  // ".." segments would rewrite the create URL path.
  if (id.includes("/")) {
    const parts = id.split("/");
    if (parts.length !== 2 || parts.some((p) => !p || p === "." || p === ".." || p.includes(".."))) {
      throw validationError("Invalid Vertex video model id");
    }
    id = parts[1];
  }
  // Plain model id only — no path separators, and never "." / "..".
  if (id === "." || id === ".." || !MODEL_ID_RE.test(id)) {
    throw validationError("Invalid Vertex video model id");
  }
  return id;
}

/** OpenAI-ish video body → Vertex predictLongRunning body. */
function toVertexBody(body) {
  const instance = {};
  if (body.prompt) instance.prompt = body.prompt;
  const image = body.image ?? body.image_url;
  if (image && typeof image === "object") {
    instance.image = image;
  } else if (typeof image === "string" && image) {
    const match = image.match(/^data:([^;]+);base64,(.*)$/s);
    instance.image = match
      ? { bytesBase64Encoded: match[2], mimeType: match[1] }
      : { gcsUri: image };
  }
  if (body.video && typeof body.video === "object") instance.video = body.video;

  const parameters = {};
  if (body.n != null) parameters.sampleCount = Number(body.n);
  if (body.duration != null) parameters.durationSeconds = Number(body.duration);
  if (body.aspect_ratio) parameters.aspectRatio = body.aspect_ratio;
  if (body.resolution) parameters.resolution = body.resolution;
  if (body.seed != null) parameters.seed = body.seed;
  if (body.negative_prompt) parameters.negativePrompt = body.negative_prompt;
  if (body.storage_uri) parameters.storageUri = body.storage_uri;
  if (body.generate_audio != null) parameters.generateAudio = !!body.generate_audio;

  return { instances: [instance], ...(Object.keys(parameters).length ? { parameters } : {}) };
}

function extractSamples(json) {
  return (
    json?.response?.videos ||
    json?.response?.generateVideoResponse?.generatedSamples ||
    json?.videos ||
    []
  );
}

function sampleToData(s) {
  const url = s?.gcsUri || s?.video?.uri || s?.uri || null;
  const b64 = s?.bytesBase64Encoded || s?.video?.bytesBase64Encoded || null;
  const mime = s?.mimeType || s?.video?.mimeType || "video/mp4";
  if (url) return { url };
  if (b64) return { b64_json: b64, mime_type: mime };
  return null;
}

export default {
  async: true,
  // Veo I2V is legitimate — prompt is optional when an image is supplied.
  promptOptional: true,
  // Core awaits this: mint the token and build the project-scoped URL.
  async buildUrl(model, credentials, body) {
    const { saJson, projectId, location } = resolveProjectLocation(credentials);
    const bare = bareModelId(body, model);
    if (saJson) {
      const minted = await refreshVertexToken(saJson, null);
      if (!minted?.accessToken) {
        throw validationError("Vertex video: failed to mint access token from service account JSON");
      }
      credentials.accessToken = minted.accessToken;
    }
    if (!credentials?.accessToken) {
      throw validationError(
        "Vertex video requires Service Account JSON or an OAuth access token (raw API keys are not supported)"
      );
    }
    credentials.__vertexVideoModelPath = `projects/${projectId}/locations/${location}/publishers/google/models/${bare}`;
    return `${BASE_URL}/v1/${credentials.__vertexVideoModelPath}:predictLongRunning`;
  },
  buildHeaders: (credentials) => {
    const token = credentials?.accessToken;
    if (!token) {
      throw validationError(
        "Vertex video requires Service Account JSON or an OAuth access token (raw API keys are not supported)"
      );
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  },
  buildBody: (model, body) => {
    if (!body.prompt && !body.image && !body.image_url) {
      throw validationError("Vertex video requires a prompt or an image");
    }
    return toVertexBody(body);
  },
  async parseResponse(response, { headers: reqHeaders }) {
    const submitted = await response.json();
    const operationName = submitted?.name;
    if (typeof operationName !== "string" || !operationName) {
      if (submitted?.error) {
        throw new Error(`Vertex: ${submitted.error.message || submitted.error.code || "create failed"}`);
      }
      throw new Error("Vertex: no operation name returned");
    }
    // Reject any operation name that could rewrite the poll URL path
    // (e.g. "projects/p/locations/l/publishers/google/models/m/operations/../../x").
    if (!OPERATION_NAME_RE.test(operationName)) {
      throw new Error("Vertex: invalid operation name");
    }

    const authHeader = reqHeaders?.Authorization || reqHeaders?.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) throw new Error("Vertex: missing access token for operation polling");

    const modelPath = modelPathOf(operationName);
    const pollUrl = `${BASE_URL}/v1/${modelPath}:fetchPredictOperation`;
    const pollHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const pollBody = JSON.stringify({ operationName });

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const pollResponse = await fetch(pollUrl, {
        method: "POST",
        headers: pollHeaders,
        body: pollBody,
      });
      if (pollResponse.status === 404) {
        throw new Error("Vertex: video operation was not found or expired");
      }
      if (!pollResponse.ok) {
        const errText = await pollResponse.text().catch(() => "");
        throw new Error(`Vertex video status ${pollResponse.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
      }
      const result = await pollResponse.json();
      if (result?.error) {
        throw new Error(`Vertex: ${result.error.message || result.error.code || "operation failed"}`);
      }
      if (result?.done) {
        const samples = extractSamples(result);
        const data = samples.map(sampleToData).filter(Boolean);
        if (!data.length) {
          throw new Error("Vertex: video completed with no output");
        }
        return { ...result, _data: data };
      }
    }
    throw new Error("Vertex video polling timeout");
  },
  normalize: (responseBody) => ({
    created: nowSec(),
    data: Array.isArray(responseBody?._data) ? responseBody._data : [],
  }),
};
