// VeoAIFree Web — reverse-adapter for veoaifree.com's free multi-tool WordPress site.
//
// Ported from OmniRoute's veoaifree-web executor to ExtremeRouter's executor pattern.
// veoaifree.com is NOT a chat API — it's a WordPress media-generation site. This executor routes
// an OpenAI-style chat request to the matching media tool by inspecting the model id / prompt:
//
//   - text-to-video / image-to-video (veo / seedance) → admin-ajax.php full-video-generate + poll
//   - image generation (image / banana / imagen)      → admin-ajax.php banan-image-generator
//   - TTS (tts / speech / audio)                      → /video/googletts.php
//   - prompt enhancement (enhance / prompt)           → admin-ajax.php main-prompt-generation
//
// Auth: none. The executor scrapes a WordPress CSRF nonce from the homepage HTML and POSTs it
// with each admin-ajax.php request. Rate limited to ~6 requests/hour per IP.
//
// The "prompt" is taken from the last user message. An optional system message can carry hints:
//   aspect_ratio: <ratio>   (e.g. LANDSCAPE / PORTRAIT — defaults to VIDEO_ASPECT_RATIO_LANDSCAPE)
//   voice: <voice>          (TTS voice, e.g. en-US-AvaNeural)
//   lang: <lang>            (TTS language, e.g. en-US)
//
// Responses are tool-specific JSON envelopes (video/image/audio/prompt), not chat.completions.

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Provider config from the registry loader (buildTransport() in providers/index.js flattens
// `transport` to the top level, so baseUrl lives at CFG.baseUrl — see grok-web executor). We fall
// back to the known constant so this module loads even before its registry entry is wired into
// index.js (the registry index is auto-generated separately).
const CFG = PROVIDERS["veoaifree-web"] || {};
const BASE_URL = CFG.baseUrl || "https://veoaifree.com";
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const TTS_URL = `${BASE_URL}/video/googletts.php`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const POLL_INTERVAL_MS = 20_000;
const MAX_POLLS = 30; // 10 minutes max
const FETCH_TIMEOUT_MS = 30_000;

// ─── Abort/timeout helpers (inlined from OmniRoute) ──────────────────────────

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
  }
}

// Combine the caller's signal with a connection timeout. Returns { signal, cleanup } — cleanup()
// MUST be called to release the timer/listener.
function withTimeout(signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason || new Error("Request aborted"));
  const timeout = setTimeout(
    () => controller.abort(new Error("VeoAIFree request timed out")),
    FETCH_TIMEOUT_MS
  );
  if (signal?.aborted) {
    abort();
  } else {
    signal?.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
  };
}

async function fetchWithTimeout(url, init = {}, signal, proxyOptions) {
  throwIfAborted(signal);
  const timeout = withTimeout(signal);
  try {
    return await proxyAwareFetch(url, { ...init, signal: timeout.signal }, proxyOptions);
  } finally {
    timeout.cleanup();
  }
}

function waitForPoll(signal) {
  throwIfAborted(signal);
  let abort;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, POLL_INTERVAL_MS);
    abort = () => {
      clearTimeout(timeout);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Request aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  }).finally(() => {
    if (abort) signal?.removeEventListener("abort", abort);
  });
}

// ─── Response helpers ────────────────────────────────────────────────────────

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function errResp(message, status = 502) {
  return jsonResp({ error: { message } }, status);
}

// ─── WordPress nonce + AJAX ──────────────────────────────────────────────────

// Scrape the CSRF nonce embedded in the homepage HTML (veoaifree.com inlines it as a JSON-ish
// `"nonce":"<hex>"` blob in its scripts). Used for every admin-ajax.php call.
async function fetchNonce(signal, proxyOptions) {
  const res = await fetchWithTimeout(
    BASE_URL,
    { headers: { "User-Agent": USER_AGENT } },
    signal,
    proxyOptions
  );
  const html = await res.text();
  const match = html.match(/nonce":"([a-f0-9]+)"/);
  if (!match) throw new Error("Failed to extract CSRF nonce from veoaifree.com");
  return match[1];
}

async function postAjax(nonce, params, signal, proxyOptions) {
  const body = new URLSearchParams({ action: "veo_video_generator", nonce, ...params });
  const res = await fetchWithTimeout(
    AJAX_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
      },
      body: body.toString(),
    },
    signal,
    proxyOptions
  );
  return res.text();
}

// ─── Intent detection ────────────────────────────────────────────────────────

export function detectIntent(model, prompt) {
  const m = (model || "").toLowerCase();
  if (m.includes("tts") || m.includes("speech") || m.includes("audio")) return "tts";
  if (m.includes("image") || m.includes("banana") || m.includes("imagen")) return "image";
  if (m.includes("enhance") || m.includes("prompt")) return "enhance";
  if (m.includes("video") || m.includes("veo") || m.includes("seedance")) return "video";
  // Auto-detect from prompt
  const p = (prompt || "").toLowerCase();
  if (p.startsWith("generate image") || p.startsWith("create image") || p.startsWith("draw ")) return "image";
  if (p.startsWith("enhance") || p.startsWith("improve prompt")) return "enhance";
  return "video"; // default
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

// Video: kick off generation, then poll final-video-results until a video URL appears.
async function handleVideo(nonce, prompt, aspectRatio, signal, proxyOptions) {
  const genResult = await postAjax(
    nonce,
    { prompt, totalVariations: "1", aspectRatio, actionType: "full-video-generate" },
    signal,
    proxyOptions
  );
  const sceneData = genResult.trim();
  if (!sceneData || sceneData === "0" || sceneData.toLowerCase().includes("error")) {
    return errResp("Video generation failed");
  }

  for (let i = 0; i < MAX_POLLS; i++) {
    await waitForPoll(signal);
    throwIfAborted(signal);
    try {
      const pollResult = await postAjax(
        nonce,
        { sceneData, actionType: "final-video-results" },
        signal,
        proxyOptions
      );
      const trimmed = pollResult.trim();
      if (trimmed && trimmed !== "0" && !trimmed.toLowerCase().includes("error")) {
        const urls = trimmed
          .split(/[,\n]/)
          .map((u) => u.trim())
          .filter((u) => u.startsWith("http"));
        if (urls.length > 0) {
          return jsonResp({
            object: "video.generation",
            data: urls.map((url) => ({ url, type: "video" })),
            status: "completed",
          });
        }
      }
    } catch {
      if (signal?.aborted) throw signal.reason;
      /* keep polling */
    }
  }
  return errResp("Video generation timed out after 10 minutes", 504);
}

// Image: single POST; response is comma-separated base64 PNGs or URLs.
async function handleImage(nonce, prompt, aspectRatio, signal, proxyOptions) {
  const result = await postAjax(
    nonce,
    { promptIMG: prompt, totalVariationsIMG: "1", aspectRatioIMG: aspectRatio, actionType: "banan-image-generator" },
    signal,
    proxyOptions
  );
  const trimmed = result.trim();
  if (!trimmed || trimmed === "0" || trimmed.toLowerCase().includes("error")) {
    return errResp("Image generation failed");
  }
  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  const images = parts.map((p) =>
    p.startsWith("http") ? { url: p, type: "image" } : { b64_json: p, type: "image" }
  );
  return jsonResp({ object: "image.generation", data: images, status: "completed" });
}

// TTS: POST JSON; response is raw audio bytes or JSON { audio_data | url }.
async function handleTTS(prompt, voice, lang, signal, proxyOptions) {
  const selectedVoice = voice || "en-US-AvaNeural";
  const selectedLang = lang || "en-US";

  const res = await fetchWithTimeout(
    TTS_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Origin: BASE_URL,
        Referer: `${BASE_URL}/free-ai-text-to-speech/`,
      },
      body: JSON.stringify({
        text: prompt.slice(0, 10000),
        voice: selectedVoice,
        lang: selectedLang,
        pitch: "0",
        speed: "1.0",
      }),
    },
    signal,
    proxyOptions
  );

  if (!res.ok) return errResp(`TTS failed (${res.status})`);

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("audio") || contentType.includes("octet-stream") || contentType.includes("wav")) {
    return new Response(res.body, {
      headers: {
        "Content-Type": contentType.includes("wav") ? "audio/wav" : "audio/mpeg",
        "Content-Disposition": 'attachment; filename="speech.wav"',
      },
    });
  }

  // JSON response with base64 audio_data
  const data = await res.text();
  try {
    const json = JSON.parse(data);
    if (json.audio_data) return jsonResp({ object: "audio.speech", audio: json.audio_data, status: "completed" });
    if (json.url) return jsonResp({ object: "audio.speech", url: json.url, status: "completed" });
  } catch {
    /* not JSON */
  }
  return errResp("TTS unexpected response format");
}

// Prompt enhancement: single POST returns the enhanced prompt text.
async function handleEnhance(nonce, prompt, signal, proxyOptions) {
  const result = await postAjax(
    nonce,
    { prompt, actionType: "main-prompt-generation" },
    signal,
    proxyOptions
  );
  const trimmed = result.trim();
  if (!trimmed || trimmed === "0") return errResp("Prompt enhancement failed");
  return jsonResp({ object: "prompt.enhancement", enhanced: trimmed, status: "completed" });
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class VeoAIFreeWebExecutor extends BaseExecutor {
  constructor() {
    super("veoaifree-web", CFG);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const resolvedModel = model || body?.model || "veo-3.1";

    // Extract prompt + system hints from the OpenAI-style messages.
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const userMsg = messages.filter((m) => m.role === "user").pop();
    const systemMsg = messages.filter((m) => m.role === "system").pop();

    let prompt = "";
    if (typeof userMsg?.content === "string") prompt = userMsg.content;
    else if (Array.isArray(userMsg?.content)) {
      prompt = userMsg.content
        .filter((c) => c && c.type === "text")
        .map((c) => String(c.text ?? ""))
        .join("");
    }
    const systemText = typeof systemMsg?.content === "string" ? systemMsg.content : "";

    if (!prompt.trim()) {
      return {
        response: errResp("No prompt provided", 400),
        url: AJAX_URL, headers: {}, transformedBody: null,
      };
    }

    const intent = detectIntent(resolvedModel, prompt);
    log?.info?.("VEOAIFREE-WEB", `intent=${intent} model=${resolvedModel} promptLen=${prompt.length}`);

    // TTS doesn't need a nonce.
    if (intent === "tts") {
      const voiceMatch = systemText.match(/voice:\s*(\S+)/);
      const langMatch = systemText.match(/lang:\s*(\S+)/);
      try {
        const resp = await handleTTS(prompt, voiceMatch?.[1], langMatch?.[1], signal, proxyOptions);
        return { response: resp, url: TTS_URL, headers: {}, transformedBody: { intent, model: resolvedModel } };
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        return { response: errResp(err?.message || String(err)), url: TTS_URL, headers: {}, transformedBody: { intent, model: resolvedModel } };
      }
    }

    // Get a nonce for the AJAX endpoints.
    let nonce;
    try {
      nonce = await fetchNonce(signal, proxyOptions);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      return { response: errResp(err?.message || "Failed to get nonce"), url: BASE_URL, headers: {}, transformedBody: null };
    }

    // aspect_ratio hint from the system message, defaulting to landscape video.
    const arMatch = systemText.match(/aspect[_-]?ratio:\s*(\S+)/i);
    const aspectRatio = arMatch?.[1] || "VIDEO_ASPECT_RATIO_LANDSCAPE";

    let resp;
    try {
      switch (intent) {
        case "image":
          resp = await handleImage(nonce, prompt, aspectRatio.replace("VIDEO_", "IMAGE_"), signal, proxyOptions);
          break;
        case "enhance":
          resp = await handleEnhance(nonce, prompt, signal, proxyOptions);
          break;
        default:
          resp = await handleVideo(nonce, prompt, aspectRatio, signal, proxyOptions);
      }
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      return {
        response: errResp(err?.message || String(err)),
        url: AJAX_URL, headers: {}, transformedBody: { intent, model: resolvedModel },
      };
    }

    return { response: resp, url: AJAX_URL, headers: {}, transformedBody: { intent, model: resolvedModel } };
  }
}

export default VeoAIFreeWebExecutor;
