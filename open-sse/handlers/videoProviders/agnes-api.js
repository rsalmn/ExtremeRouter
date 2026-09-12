// Agnes AI (API) — text/image-to-video via async submit + poll.
//
// Two generations share the same host but different request shapes:
//
// v2.0 (agnes-video-v2.0):
//   POST /v1/videos  { model, prompt, image?, mode?, height?, width?,
//                      num_frames?, frame_rate?, num_inference_steps?,
//                      seed?, negative_prompt?, extra_body? }
//   Poll GET /agnesapi?video_id=<id>
//
// 2.5 / 2.5-flash (agnes-video-2.5, agnes-video-2.5-flash):
//   POST /v1/videos  { model, prompt, mode (required: text|keyframe|reference),
//                      seconds? (string "4"-"12"), size? ("720P"|"1080P"|"1K"|"2K";
//                      Flash: "720P" only), aspect_ratio?, seed?, n?:1,
//                      first_frame?, last_frame? (keyframe),
//                      images?, audios?, videos? (reference) }
//   Poll GET /agnesapi?video_id=<id>&model_name=<model>
//   (model_name required for keyframe/reference; recommended for every mode)
//   Result URL is metadata.url when status === "completed".
//
// Docs: https://www.agnes-ai.com/en/docs/agnes-video-25
//       https://www.agnes-ai.com/en/docs/agnes-video-25-flash
//
// width/height/num_frames/fps are REJECTED on 2.5 (HTTP 400 upstream).
// Playground aliases (duration, resolution, aspect_ratio) are mapped onto the
// documented fields; raw documented fields always win.
import { sleep, nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "../imageProviders/_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const CFG = PROVIDER_MEDIA["agnes-api"]?.videoConfig;
const CREATE_URL = CFG?.baseUrl || "https://apihub.agnes-ai.com/v1/videos";
const POLL_URL = CFG?.pollUrl || "https://apihub.agnes-ai.com/agnesapi";
// Video jobs often outlive the shared 2-minute image poll window.
const VIDEO_POLL_TIMEOUT_MS = Math.max(POLL_TIMEOUT_MS, 10 * 60 * 1000);
const DEFAULT_WIDTH = 1152;
const DEFAULT_HEIGHT = 768;
const DEFAULT_FRAME_RATE = 24;
const MAX_FRAMES = 441;
const MAX_SEED = 2147483647;

// v2.0 standard tiers (pixels snapped upstream).
const RESOLUTION_HEIGHT = { "480p": 480, "720p": 720, "1080p": 1080 };
const ASPECT_RATIOS = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
};

// 2.5 size tiers + aspect ratios (docs).
const SIZE_25 = new Set(["720P", "1080P", "1K", "2K"]);
const ASPECT_25 = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const MODES_25 = new Set(["text", "keyframe", "reference"]);
const FLASH_MODEL = "agnes-video-2.5-flash";
const V25_MODELS = new Set(["agnes-video-2.5", "agnes-video-2.5-flash"]);

function fail(message) {
  const err = new Error(message);
  err.isValidationError = true;
  return err;
}

function isVideo25(model) {
  return V25_MODELS.has(String(model || "").trim());
}

function isFlash(model) {
  return String(model || "").trim() === FLASH_MODEL;
}

// ── v2.0 helpers ───────────────────────────────────────────────────────────

function parseAspectRatio(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !ASPECT_RATIOS[value]) {
    throw fail(`unsupported aspect_ratio '${value}' (16:9, 9:16, 1:1, 4:3, 3:4)`);
  }
  return ASPECT_RATIOS[value];
}

function resolveHeight(body) {
  if (body.height !== undefined && body.height !== null && body.height !== "") {
    const h = Number(body.height);
    if (!Number.isInteger(h) || h < 64 || h > 2160) throw fail("height must be an integer 64-2160");
    return h;
  }
  const res = body.resolution;
  if (res === undefined || res === null || res === "") return null;
  if (typeof res !== "string" || !RESOLUTION_HEIGHT[res]) {
    throw fail(`unsupported resolution '${res}' (480p, 720p, 1080p)`);
  }
  return RESOLUTION_HEIGHT[res];
}

function resolveWidth(body, height) {
  if (body.width !== undefined && body.width !== null && body.width !== "") {
    const w = Number(body.width);
    if (!Number.isInteger(w) || w < 64 || w > 2160) throw fail("width must be an integer 64-2160");
    return w;
  }
  const ratio = parseAspectRatio(body.aspect_ratio ?? body.ratio);
  if (ratio === null) return null;
  const base = height || DEFAULT_HEIGHT;
  return Math.max(64, Math.round(base * ratio));
}

function resolveFrames(body) {
  // Agnes requires num_frames = 8*n + 1 (1, 9, 17, …). Snap any computed or
  // supplied value to the nearest legal frame count — duration*fps otherwise
  // produces values like 240 that upstream rejects with HTTP 400.
  const snap8n1 = (raw) => {
    const k = Math.max(0, Math.round((raw - 1) / 8));
    const snapped = 8 * k + 1;
    if (snapped < 1 || snapped > MAX_FRAMES) {
      throw fail(`num_frames ${raw} snaps to ${snapped}, outside 1-${MAX_FRAMES}`);
    }
    return snapped;
  };

  if (body.num_frames !== undefined && body.num_frames !== null && body.num_frames !== "") {
    const n = Number(body.num_frames);
    if (!Number.isInteger(n) || n < 1 || n > MAX_FRAMES) {
      throw fail(`num_frames must be an integer 1-${MAX_FRAMES}`);
    }
    return snap8n1(n);
  }
  if (body.duration !== undefined && body.duration !== null && body.duration !== "") {
    const seconds = Number(body.duration);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) {
      throw fail("duration must be a positive number of seconds (max 60)");
    }
    const fps = body.frame_rate !== undefined && body.frame_rate !== null && body.frame_rate !== ""
      ? Number(body.frame_rate)
      : DEFAULT_FRAME_RATE;
    const frames = Math.round(seconds * fps);
    if (frames < 1) {
      throw fail(`duration ${seconds}s at ${fps}fps is too short`);
    }
    if (frames > MAX_FRAMES + 8) {
      throw fail(`duration ${seconds}s at ${fps}fps exceeds the ${MAX_FRAMES}-frame limit`);
    }
    return snap8n1(frames);
  }
  return null;
}

function resolveSeed(body) {
  if (body.seed === undefined || body.seed === null || body.seed === "") return null;
  const seed = Number(body.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw fail(`seed must be an integer 0..${MAX_SEED}`);
  }
  return seed;
}

// ── 2.5 helpers ────────────────────────────────────────────────────────────

// Agnes 2.5 accepts seconds as a string "4"-"12" (docs). The playground
// Duration field allows much longer values, so clamp into range instead of
// hard-failing a request the user could reasonably expect to work.
const SECONDS_25_MIN = 4;
const SECONDS_25_MAX = 12;

function resolveSeconds25(body) {
  const raw = body.seconds ?? body.duration;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw fail(`seconds must be a number (got '${raw}')`);
  }
  const clamped = Math.min(SECONDS_25_MAX, Math.max(SECONDS_25_MIN, Math.round(n)));
  return String(clamped);
}

function resolveSize25(body, model) {
  const raw = body.size ?? body.resolution;
  if (raw === undefined || raw === null || raw === "") return null;
  // Accept "720p" playground form; docs use "720P".
  const size = String(raw).trim().toUpperCase();
  if (!SIZE_25.has(size)) {
    throw fail(`unsupported size '${raw}' (720P, 1080P, 1K, 2K)`);
  }
  if (isFlash(model) && size !== "720P") {
    throw fail("size must be 720P (agnes-video-2.5-flash)");
  }
  return size;
}

function resolveAspect25(body) {
  const raw = body.aspect_ratio ?? body.ratio;
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !ASPECT_25.has(raw)) {
    throw fail(`unsupported aspect_ratio '${raw}' (21:9, 16:9, 4:3, 1:1, 3:4, 9:16)`);
  }
  return raw;
}

function strList(value, label) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw fail(`${label} must be an array of URL strings`);
  const items = value.filter((v) => typeof v === "string" && v.trim());
  return items.length ? items : null;
}

// ── shared result extraction ───────────────────────────────────────────────

// Unwrap common envelope shapes: { data: {...} }, { result: {...} }, [ {...} ].
function unwrapPollBody(raw) {
  let body = raw;
  if (Array.isArray(body) && body.length) body = body[0];
  if (body && typeof body === "object") {
    for (const key of ["data", "result", "task", "video", "payload"]) {
      const inner = body[key];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        // Prefer the inner object when it carries status/url, else keep parent.
        if (inner.status !== undefined || inner.url !== undefined || inner.metadata !== undefined) {
          body = { ...body, ...inner };
          break;
        }
      }
    }
  }
  return body;
}

function firstUrl(result) {
  const body = unwrapPollBody(result);
  const candidates = [
    body?.metadata?.url,
    body?.metadata?.video_url,
    body?.url,
    body?.file_url,
    body?.fileUrl,
    body?.download_url,
    body?.downloadUrl,
    body?.video_url,
    body?.videoUrl,
    body?.video?.url,
    body?.output?.url,
    body?.output?.video_url,
    body?.result?.url,
    body?.data?.url,
    body?.data?.video_url,
    Array.isArray(body?.data) ? body.data[0]?.url : null,
    Array.isArray(body?.videos) ? body.videos[0]?.url : null,
    Array.isArray(body?.outputs) ? body.outputs[0]?.url : null,
  ];
  for (const u of candidates) {
    if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
  }
  // Last resort: any nested http(s) string under url-ish keys.
  const stack = [body];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && /^(url|file|video|download|output)/i.test(k) && /^https?:\/\//i.test(v)) {
        return v;
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

const DONE_STATUSES = new Set([
  "completed", "complete", "succeeded", "success", "done", "finished", "ready",
]);
const FAILED_STATUSES = new Set([
  "failed", "fail", "error", "cancelled", "canceled", "rejected", "timeout", "expired",
]);
const PENDING_STATUSES = new Set([
  "queued", "queue", "pending", "processing", "running", "in_progress",
  "in-progress", "generating", "working", "active", "submitted", "created", "waiting",
  // Agnes internal_status values seen live: "inference", "processing".
  "inference", "preparing", "loading", "starting",
]);

function classifyStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (DONE_STATUSES.has(s)) return "done";
  if (FAILED_STATUSES.has(s)) return "failed";
  if (PENDING_STATUSES.has(s)) return "pending";
  if (s === "") return "unknown";
  // progress-only signals
  return "unknown";
}

// Live-verified: Agnes rate-limits the status endpoint to roughly 6 queries in
// a short window ("too many video status queries"). Polling every 1.5s trips it,
// and the resulting 429s starve the loop until the job is already done upstream.
// 5s keeps us comfortably under the limit for multi-minute renders.
const AGNES_POLL_INTERVAL_MS = 5000;
// Exported for tests: the poll cadence must advance against this, not the
// shared 1.5s image interval.
export const AGNES_POLL_INTERVAL = AGNES_POLL_INTERVAL_MS;
// Minimum spacing when the server explicitly rate-limits us.
const AGNES_MIN_RL_BACKOFF_MS = 10000;

function failureMessage(result) {
  const body = unwrapPollBody(result);
  return (
    body?.error?.message ||
    body?.error ||
    body?.message ||
    body?.failure ||
    body?.detail ||
    "Agnes video generation failed"
  );
}

// Agnes returns BOTH `status` (top-level task status) and `internal_status`
// (the engine's own phase). Live captures showed `internal_status: "completed"`
// alongside `status: "completed"` only at the end — but a partial envelope can
// carry the internal value first, so treat either as authoritative.
function resolveStatusFields(body) {
  const status = body?.status ?? body?.state ?? body?.task_status ?? "";
  const internal = body?.internal_status ?? "";
  const progress = Number(body?.progress ?? body?.internal_progress);
  // Prefer a terminal internal status when the outer status is missing/unknown.
  const primary = String(status || "").trim();
  const kind = classifyStatus(primary) !== "unknown"
    ? classifyStatus(primary)
    : classifyStatus(internal);
  return { status: primary || String(internal || ""), kind, progress, internal: String(internal || "") };
}

function buildBodyV20(model, body) {
  const payload = {
    model: model || "agnes-video-v2.0",
    prompt: body.prompt.trim(),
  };
  const image = body.image ?? body.image_url;
  if (image && typeof image === "string") payload.image = image;
  else if (image && typeof image === "object") payload.image = image;
  if (Array.isArray(body.images) && body.images.length) {
    payload.extra_body = { ...(payload.extra_body || {}), image: body.images };
  }
  if (body.mode) payload.mode = String(body.mode);
  if (body.negative_prompt) payload.negative_prompt = String(body.negative_prompt);

  const height = resolveHeight(body);
  const width = resolveWidth(body, height);
  if (height !== null) payload.height = height;
  if (width !== null) payload.width = width;

  const frames = resolveFrames(body);
  if (frames !== null) payload.num_frames = frames;

  if (body.frame_rate !== undefined && body.frame_rate !== null && body.frame_rate !== "") {
    const fps = Number(body.frame_rate);
    if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw fail("frame_rate must be 1-60");
    payload.frame_rate = fps;
  }
  if (body.num_inference_steps !== undefined && body.num_inference_steps !== null && body.num_inference_steps !== "") {
    const steps = Number(body.num_inference_steps);
    if (!Number.isInteger(steps) || steps < 1 || steps > 200) {
      throw fail("num_inference_steps must be an integer 1-200");
    }
    payload.num_inference_steps = steps;
  }
  const seed = resolveSeed(body);
  if (seed !== null) payload.seed = seed;
  if (body.extra_body && typeof body.extra_body === "object") {
    payload.extra_body = { ...(payload.extra_body || {}), ...body.extra_body };
  }
  return payload;
}

function buildBodyV25(model, body) {
  // 2.5 rejects width/height/num_frames/fps/quality (docs: HTTP 400).
  for (const banned of ["width", "height", "num_frames", "frame_rate", "fps", "num_inference_steps", "quality"]) {
    if (body[banned] !== undefined && body[banned] !== null && body[banned] !== "") {
      throw fail(`'${banned}' is not supported by ${model} — use seconds/size/aspect_ratio`);
    }
  }

  const modeRaw = body.mode ?? (body.images?.length || body.audios?.length || body.videos?.length
    ? "reference"
    : (body.first_frame || body.last_frame ? "keyframe" : "text"));
  const mode = String(modeRaw).trim().toLowerCase();
  if (!MODES_25.has(mode)) {
    throw fail(`unsupported mode '${modeRaw}' (text, keyframe, reference)`);
  }

  const payload = {
    model,
    prompt: body.prompt.trim(),
    mode,
  };

  const seconds = resolveSeconds25(body);
  if (seconds !== null) payload.seconds = seconds;

  const size = resolveSize25(body, model);
  if (size !== null) payload.size = size;
  else if (isFlash(model)) payload.size = "720P"; // Flash requires it

  const aspect = resolveAspect25(body);
  if (aspect !== null) payload.aspect_ratio = aspect;

  const seed = resolveSeed(body);
  if (seed !== null) payload.seed = seed;
  if (body.n !== undefined && body.n !== null && body.n !== "" && Number(body.n) !== 1) {
    throw fail("n must be 1");
  }

  if (mode === "keyframe") {
    const first = typeof body.first_frame === "string" && body.first_frame.trim() ? body.first_frame.trim() : null;
    const last = typeof body.last_frame === "string" && body.last_frame.trim() ? body.last_frame.trim() : null;
    // Convenience: a single image URL becomes first_frame.
    const imageFallback = !first && !last && typeof (body.image ?? body.image_url) === "string"
      ? String(body.image ?? body.image_url).trim()
      : null;
    const firstFrame = first || imageFallback;
    if (!firstFrame && !last) throw fail("keyframe mode requires first_frame and/or last_frame");
    if (firstFrame) payload.first_frame = firstFrame;
    if (last) payload.last_frame = last;
  } else if (mode === "reference") {
    const images = strList(body.images, "images");
    const audios = strList(body.audios, "audios");
    const videos = Array.isArray(body.videos)
      ? body.videos.filter((v) => v && typeof v === "object" && v.url)
      : null;
    if (isFlash(model)) {
      if (images && images.length > 5) throw fail("images length must not exceed 5");
      if (audios && audios.length > 3) throw fail("audios length must not exceed 3");
      if (videos && videos.length) throw fail("videos is not supported");
    }
    if (!images && !audios && !(videos && videos.length)) {
      throw fail("reference mode requires images, audios, or videos");
    }
    if (images) payload.images = images;
    if (audios) payload.audios = audios;
    if (videos && videos.length) payload.videos = videos;
  }

  return payload;
}

export default {
  async: true,
  buildUrl: () => CREATE_URL,
  buildHeaders: (credentials) => {
    const key = credentials?.apiKey || credentials?.accessToken;
    if (!key) throw fail("Agnes video requires an API key");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
  },
  buildBody: (model, body) => {
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      throw fail("Missing required field: prompt");
    }
    const id = String(model || "").trim();
    if (isVideo25(id)) return buildBodyV25(id, body);
    return buildBodyV20(id || "agnes-video-v2.0", body);
  },
  async parseResponse(response, { headers, model, log }) {
    const submitted = await response.json();
    const videoId = submitted?.video_id || submitted?.task_id || submitted?.id;
    const taskId = submitted?.task_id || submitted?.id || videoId;
    if (typeof videoId !== "string" || !videoId) {
      throw new Error("Agnes: no video_id/task_id returned");
    }
    const createStatus = String(submitted?.status || "").toLowerCase();
    if (createStatus === "failed" || createStatus === "error") {
      throw new Error(`Agnes: ${failureMessage(submitted)}`);
    }

    // Docs (v2.0 + 2.5): preferred poll is /agnesapi?video_id=; add model_name
    // when known (required for 2.5 keyframe/reference, recommended always).
    // Legacy fallback: GET /v1/videos/<TASK_ID>.
    const resolvedModel = submitted?.model || model || "";
    const qs = new URLSearchParams({ video_id: videoId });
    if (resolvedModel) qs.set("model_name", resolvedModel);
    const primaryPollUrl = `${POLL_URL}?${qs.toString()}`;
    const legacyPollUrl = taskId
      ? `${CREATE_URL.replace(/\/$/, "")}/${encodeURIComponent(taskId)}`
      : null;

    log?.debug?.("VIDEO", `agnes-api poll video_id=${videoId} task_id=${taskId} model=${resolvedModel || "n/a"}`);

    const RETRYABLE_POLL = new Set([429, 500, 502, 503]);
    // Agnes rejects non-2xx errors on the status endpoint as `{"error":{...}}`
    // even on HTTP 200 in some edge cases — handled below via body.error.
    const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
    let backoffMs = AGNES_MIN_RL_BACKOFF_MS;
    let lastStatus = "";
    let attempt = 0;
    let rateLimitHits = 0;
    // After several pending polls on the recommended endpoint, also try the
    // legacy task endpoint (some accounts only resolve there).
    let useLegacy = false;
    while (Date.now() < deadline) {
      // 5s cadence: the status endpoint rate-limits (live-verified ~6 queries
      // per short window) and 1.5s polling starves the loop with 429s.
      await sleep(AGNES_POLL_INTERVAL_MS);
      attempt += 1;
      // Prefer the legacy endpoint once we've been rate-limited repeatedly,
      // OR when the primary has stayed pending for many attempts (some tasks
      // only resolve on the task endpoint).
      if (legacyPollUrl && !useLegacy && (rateLimitHits >= 3 || attempt >= 8)) {
        useLegacy = true;
      }
      const pollUrl = useLegacy && legacyPollUrl ? legacyPollUrl : primaryPollUrl;
      const pollResponse = await fetch(pollUrl, { headers });
      if (pollResponse.status === 404 && useLegacy && primaryPollUrl) {
        useLegacy = false;
        continue;
      }
      if (pollResponse.status === 404) {
        throw new Error("Agnes: video was not found or expired");
      }
      if (RETRYABLE_POLL.has(pollResponse.status)) {
        const errText = await pollResponse.text().catch(() => "");
        try { await pollResponse.body?.cancel?.(); } catch { /* noop */ }
        if (pollResponse.status === 429) rateLimitHits += 1;
        const retryAfterSec = Number(pollResponse.headers?.get?.("retry-after"));
        const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 30000)
          : backoffMs;
        log?.debug?.("VIDEO", `agnes-api poll #${attempt} HTTP ${pollResponse.status} — backing off ${Math.round(waitMs / 1000)}s ${errText.slice(0, 120)}`);
        await sleep(waitMs);
        backoffMs = Math.min(backoffMs * 2, 30000);
        continue;
      }
      if (!pollResponse.ok) {
        const errText = await pollResponse.text().catch(() => "");
        throw new Error(`Agnes video status ${pollResponse.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
      }
      let result;
      try {
        result = await pollResponse.json();
      } catch {
        continue;
      }
      const body = unwrapPollBody(result);
      // A 200 carrying an error envelope (rate limit surfaced as JSON) is not
      // a job outcome — back off rather than mis-classifying it.
      if (body?.error && !body?.status) {
        const msg = String(body.error.message || body.error || "");
        if (/too many|rate|429/i.test(msg)) {
          rateLimitHits += 1;
          log?.debug?.("VIDEO", `agnes-api poll #${attempt} rate-limited (200 envelope) — backing off ${Math.round(backoffMs / 1000)}s`);
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30000);
          continue;
        }
        throw new Error(`Agnes: ${msg}`);
      }

      const { status, kind, progress, internal } = resolveStatusFields(body);
      lastStatus = status;
      const url = firstUrl(result);

      // A result URL is authoritative — Agnes already billed Success on their side.
      if (url) {
        log?.debug?.("VIDEO", `agnes-api poll #${attempt} DONE status=${status || internal} url acquired`);
        return { ...body, _url: url, _videoId: videoId };
      }
      if (kind === "done" || (Number.isFinite(progress) && progress >= 100 && kind !== "failed")) {
        throw new Error(`Agnes: video completed with no output url (status=${status || "completed"})`);
      }
      if (kind === "failed") {
        throw new Error(`Agnes: ${failureMessage(result)}`);
      }
      if (attempt === 1 || attempt % 6 === 0) {
        log?.debug?.("VIDEO", `agnes-api poll #${attempt} status=${status || "?"} internal=${internal || "?"} progress=${Number.isFinite(progress) ? progress : "?"} rl=${rateLimitHits}`);
      }
      // Reset backoff after a healthy poll.
      backoffMs = AGNES_MIN_RL_BACKOFF_MS;
    }
    throw new Error(`Agnes video polling timeout (last status: ${lastStatus || "none"}, attempts: ${attempt}, rate-limited: ${rateLimitHits})`);
  },
  normalize: (responseBody) => ({
    created: Number(responseBody?.created_at) ? responseBody.created_at : nowSec(),
    data: typeof responseBody?._url === "string" && responseBody._url
      ? [{ url: responseBody._url }]
      : [],
  }),
};
