/**
 * Agnes AI (API) text-to-video adapter tests.
 *
 * Contract (apihub.agnes-ai.com):
 *   POST /v1/videos â†’ { video_id, status }
 *   GET  /agnesapi?video_id=<id> â†’ status/url
 *
 * Covers endpoint/auth, body mapping (raw fields + playground aliases
 * resolution/aspect_ratio/duration), validation, poll, and normalize.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POLL_INTERVAL_MS } from "../../open-sse/handlers/imageProviders/_base.js";
import agnes, { AGNES_POLL_INTERVAL } from "../../open-sse/handlers/videoProviders/agnes-api.js";
import { getVideoAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { handleVideoGenerationCore } from "../../open-sse/handlers/videoGenerationCore.js";

// Agnes polls at 5s (rate-limit safe); advancing by the shared 1.5s image
// interval would stall these tests short of a poll.
const TICK = AGNES_POLL_INTERVAL;
const advancePolls = (n) => vi.advanceTimersByTimeAsync(TICK * n);

const originalFetch = global.fetch;
const MODEL = "agnes-video-v2.0";
const HEADERS = { Authorization: "Bearer agnes-key" };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("agnes-api video adapter", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("is registered and uses the documented create endpoint", () => {
    expect(getVideoAdapter("agnes-api")).toBe(agnes);
    expect(agnes.buildUrl()).toBe("https://apihub.agnes-ai.com/v1/videos");
    expect(agnes.buildHeaders({ apiKey: "k" })).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer k",
    });
  });

  it("requires a prompt and defaults the model when omitted", () => {
    expect(() => agnes.buildBody(MODEL, {})).toThrow(/prompt/);
    // Empty model falls back to agnes-video-v2.0 so a bare prompt still works.
    expect(agnes.buildBody("", { prompt: "x" }).model).toBe("agnes-video-v2.0");
  });

  it("builds the documented payload with defaults omitted", () => {
    expect(agnes.buildBody(MODEL, { prompt: "a cat" })).toEqual({
      model: MODEL,
      prompt: "a cat",
    });
  });

  it("passes documented optional fields through", () => {
    const body = agnes.buildBody(MODEL, {
      prompt: "x",
      image: "https://cdn/i.png",
      mode: "ti2vid",
      height: 768,
      width: 1152,
      num_frames: 121,
      frame_rate: 24,
      num_inference_steps: 30,
      seed: 7,
      negative_prompt: "blur",
    });
    expect(body).toEqual({
      model: MODEL,
      prompt: "x",
      image: "https://cdn/i.png",
      mode: "ti2vid",
      height: 768,
      width: 1152,
      num_frames: 121,
      frame_rate: 24,
      num_inference_steps: 30,
      seed: 7,
      negative_prompt: "blur",
    });
  });

  it("maps playground resolution/aspect_ratio/duration onto width/height/num_frames", () => {
    const body = agnes.buildBody(MODEL, {
      prompt: "x",
      resolution: "720p",
      aspect_ratio: "16:9",
      duration: 5,
      frame_rate: 24,
    });
    expect(body.height).toBe(720);
    expect(body.width).toBe(Math.round(720 * (16 / 9)));
    // 5s * 24fps = 120 â†’ snapped to nearest 8n+1 = 121.
    expect(body.num_frames).toBe(121);
    expect(body.frame_rate).toBe(24);
  });

  it("snaps num_frames to the 8n+1 rule (regression: 240 was rejected upstream)", () => {
    // 10s * 24fps = 240; upstream requires 8*n+1 (241 is nearest legal).
    const derived = agnes.buildBody(MODEL, { prompt: "x", duration: 10, frame_rate: 24 });
    expect(derived.num_frames).toBe(241);
    expect(derived.num_frames % 8).toBe(1);

    // Explicit non-legal values are snapped too (never sent as 240).
    const explicit = agnes.buildBody(MODEL, { prompt: "x", num_frames: 240 });
    expect(explicit.num_frames).toBe(241);
    // Already-legal values are unchanged.
    expect(agnes.buildBody(MODEL, { prompt: "x", num_frames: 41 }).num_frames).toBe(41);
    expect(agnes.buildBody(MODEL, { prompt: "x", num_frames: 1 }).num_frames).toBe(1);
  });

  it("raw documented fields win over playground aliases", () => {
    const body = agnes.buildBody(MODEL, {
      prompt: "x",
      resolution: "1080p",
      height: 480,
      width: 640,
      duration: 10,
      num_frames: 41,
    });
    expect(body.height).toBe(480);
    expect(body.width).toBe(640);
    expect(body.num_frames).toBe(41);
  });

  it("rejects invalid optional values before any upstream call", () => {
    expect(() => agnes.buildBody(MODEL, { prompt: "x", frame_rate: 120 })).toThrow(/frame_rate/);
    expect(() => agnes.buildBody(MODEL, { prompt: "x", num_frames: 999 })).toThrow(/num_frames/);
    expect(() => agnes.buildBody(MODEL, { prompt: "x", seed: -1 })).toThrow(/seed/);
    expect(() => agnes.buildBody(MODEL, { prompt: "x", resolution: "4k" })).toThrow(/resolution/);
    expect(() => agnes.buildBody(MODEL, { prompt: "x", aspect_ratio: "21:9" })).toThrow(/aspect_ratio/);
  });

  it("polls GET /agnesapi?video_id= until completed and normalizes the url", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ status: "queued", progress: 0 }))
      .mockResolvedValueOnce(jsonResponse({
        status: "completed",
        url: "https://cdn.agnes-ai.com/v.mp4",
        video_id: "video_abc",
      }));
    const create = jsonResponse({
      id: "task_1",
      task_id: "task_1",
      video_id: "video_abc",
      status: "queued",
      model: MODEL,
    });
    const promise = agnes.parseResponse(create, { headers: HEADERS });
    await advancePolls(3);
    const parsed = await promise;

    const firstPoll = global.fetch.mock.calls[0];
    expect(String(firstPoll[0])).toBe(
      "https://apihub.agnes-ai.com/agnesapi?video_id=video_abc&model_name=agnes-video-v2.0"
    );
    expect(firstPoll[1].headers).toMatchObject(HEADERS);
    expect(agnes.normalize(parsed)).toEqual({
      created: expect.any(Number),
      data: [{ url: "https://cdn.agnes-ai.com/v.mp4" }],
    });
  });

  it("throws when create returns no video id, or poll reports failure", async () => {
    await expect(agnes.parseResponse(jsonResponse({}), { headers: HEADERS }))
      .rejects.toThrow(/video_id/);

    global.fetch.mockResolvedValueOnce(jsonResponse({
      status: "failed",
      error: { message: "quota exceeded" },
    }));
    const failed = agnes.parseResponse(
      jsonResponse({ video_id: "v1", status: "queued" }),
      { headers: HEADERS }
    ).catch((e) => e);
    await advancePolls(3);
    expect((await failed).message).toContain("quota exceeded");
  });

  it("retries poll 429/503 with backoff instead of aborting (regression)", async () => {
    global.fetch
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({
        status: "completed",
        url: "https://cdn.agnes-ai.com/ok.mp4",
      }));
    const promise = agnes.parseResponse(
      jsonResponse({ video_id: "v_rate", status: "queued", model: MODEL }),
      { headers: HEADERS }
    );
    // First poll + Retry-After 2s + second poll + backoff + third poll.
    await advancePolls(20);
    const parsed = await promise;
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(agnes.normalize(parsed).data).toEqual([{ url: "https://cdn.agnes-ai.com/ok.mp4" }]);
  });

  it("treats a poll body with a result URL as complete even when status is unknown/wrapped", async () => {
    // Shape observed in the wild: envelope + nested metadata, status not in our list.
    global.fetch
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          task_status: "Success",
          file_url: "https://cdn.agnes-ai.com/wrapped.mp4",
        },
      }));
    const promise = agnes.parseResponse(
      jsonResponse({ video_id: "v_wrap", status: "queued", model: MODEL }),
      { headers: HEADERS }
    );
    await advancePolls(4);
    const parsed = await promise;
    expect(agnes.normalize(parsed).data).toEqual([{ url: "https://cdn.agnes-ai.com/wrapped.mp4" }]);
  });

  it("falls back to legacy GET /v1/videos/{task_id} and reads metadata.url", async () => {
    // Recommended endpoint keeps saying queued; legacy returns completed + metadata.url.
    const queued = () => jsonResponse({ status: "queued", progress: 10 });
    global.fetch.mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/agnesapi")) return Promise.resolve(queued());
      if (u.includes("/v1/videos/task_legacy")) {
        return Promise.resolve(jsonResponse({
          status: "completed",
          progress: 100,
          metadata: { url: "https://platform-outputs.agnes-ai.space/videos/x.mp4" },
        }));
      }
      return Promise.resolve(jsonResponse({ status: "queued" }));
    });
    const promise = agnes.parseResponse(
      jsonResponse({
        id: "task_legacy",
        task_id: "task_legacy",
        video_id: "video_legacy",
        status: "queued",
        model: MODEL,
      }),
      { headers: HEADERS }
    );
    // 5s polls: legacy unlocks only after 3 rate-limit hits, so this needs a
    // wider fake-timer window than the default 5s test timeout.
    await advancePolls(40);
    const parsed = await promise;
    expect(agnes.normalize(parsed).data).toEqual([
      { url: "https://platform-outputs.agnes-ai.space/videos/x.mp4" },
    ]);
  }, 30000);
});

describe("agnes-video-2.5 / 2.5-flash contract", () => {
  const M25 = "agnes-video-2.5";
  const M25F = "agnes-video-2.5-flash";

  beforeEach(() => {
    global.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("builds the 2.5 text-mode payload (mode/seconds/size/aspect_ratio)", () => {
    const body = agnes.buildBody(M25, {
      prompt: "a city",
      mode: "text",
      seconds: "5",
      size: "720P",
      aspect_ratio: "16:9",
      seed: 11,
    });
    expect(body).toEqual({
      model: M25,
      prompt: "a city",
      mode: "text",
      seconds: "5",
      size: "720P",
      aspect_ratio: "16:9",
      seed: 11,
    });
  });

  it("maps playground duration/resolution onto seconds/size", () => {
    const body = agnes.buildBody(M25, {
      prompt: "x",
      duration: 8,
      resolution: "1080p",
      aspect_ratio: "9:16",
    });
    expect(body.seconds).toBe("8");
    expect(body.size).toBe("1080P");
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.mode).toBe("text"); // inferred default
  });

  it("clamps out-of-range duration into the 4-12s window (regression: 15 was rejected)", () => {
    // The playground Duration field allows up to 600s; Agnes 2.5 caps at 12.
    for (const model of [M25, M25F]) {
      expect(agnes.buildBody(model, { prompt: "x", duration: 15 }).seconds).toBe("12");
      expect(agnes.buildBody(model, { prompt: "x", seconds: "15" }).seconds).toBe("12");
      expect(agnes.buildBody(model, { prompt: "x", duration: 600 }).seconds).toBe("12");
      // Below the floor clamps up.
      expect(agnes.buildBody(model, { prompt: "x", duration: 1 }).seconds).toBe("4");
      // In-range values pass through unchanged (string form preserved).
      expect(agnes.buildBody(model, { prompt: "x", seconds: "8" }).seconds).toBe("8");
      expect(agnes.buildBody(model, { prompt: "x", duration: 10 }).seconds).toBe("10");
    }
  });

  it("rejects a non-numeric duration instead of silently clamping", () => {
    expect(() => agnes.buildBody(M25, { prompt: "x", duration: "abc" })).toThrow(/seconds must be a number/);
    expect(() => agnes.buildBody(M25, { prompt: "x", duration: 0 })).toThrow(/seconds must be a number/);
  });

  it("rejects v2.0-only fields on 2.5 (width/height/num_frames/â€¦)", () => {
    for (const banned of ["width", "height", "num_frames", "frame_rate", "num_inference_steps"]) {
      expect(() => agnes.buildBody(M25, { prompt: "x", [banned]: 1 })).toThrow(/not supported/);
    }
  });

  it("requires mode media: keyframe needs frames, reference needs images/audios/videos", () => {
    expect(() => agnes.buildBody(M25, { prompt: "x", mode: "keyframe" })).toThrow(/first_frame|last_frame/);
    expect(() => agnes.buildBody(M25, { prompt: "x", mode: "reference" })).toThrow(/images|audios|videos/);
    expect(agnes.buildBody(M25, {
      prompt: "x",
      mode: "keyframe",
      first_frame: "https://c/f.png",
    })).toMatchObject({ mode: "keyframe", first_frame: "https://c/f.png" });
    expect(agnes.buildBody(M25, {
      prompt: "x",
      mode: "reference",
      images: ["https://c/i.png"],
    })).toMatchObject({ mode: "reference", images: ["https://c/i.png"] });
  });

  it("Flash: size locked to 720P, â‰¤5 images, â‰¤3 audios, no videos", () => {
    expect(agnes.buildBody(M25F, { prompt: "x", mode: "text" }).size).toBe("720P");
    expect(() => agnes.buildBody(M25F, { prompt: "x", size: "1080P" })).toThrow(/720P/);
    expect(() => agnes.buildBody(M25F, {
      prompt: "x",
      mode: "reference",
      images: Array.from({ length: 6 }, (_, i) => `https://c/${i}.png`),
    })).toThrow(/exceed 5/);
    expect(() => agnes.buildBody(M25F, {
      prompt: "x",
      mode: "reference",
      audios: Array.from({ length: 4 }, (_, i) => `https://c/${i}.mp3`),
    })).toThrow(/exceed 3/);
    expect(() => agnes.buildBody(M25F, {
      prompt: "x",
      mode: "reference",
      videos: [{ url: "https://c/v.mp4" }],
    })).toThrow(/not supported/);
  });

  it("polls with model_name and reads metadata.url", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ status: "in_progress", progress: 40 }))
      .mockResolvedValueOnce(jsonResponse({
        status: "completed",
        metadata: { url: "https://cdn.agnes-ai.com/out.mp4" },
      }));
    const create = jsonResponse({
      video_id: "video_25",
      status: "queued",
      model: M25,
    });
    const promise = agnes.parseResponse(create, { headers: HEADERS, model: M25 });
    await advancePolls(3);
    const parsed = await promise;

    const firstPoll = String(global.fetch.mock.calls[0][0]);
    expect(firstPoll).toContain("video_id=video_25");
    expect(firstPoll).toContain(`model_name=${encodeURIComponent(M25)}`);
    expect(agnes.normalize(parsed).data).toEqual([{ url: "https://cdn.agnes-ai.com/out.mp4" }]);
  });
});

describe("videoGenerationCore wiring for agnes-api", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("returns 400 before any upstream call when prompt is missing", async () => {
    const result = await handleVideoGenerationCore({
      body: { model: "agnes-api/agnes-video-v2.0" },
      modelInfo: { provider: "agnes-api", model: MODEL },
      credentials: { apiKey: "k" },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/prompt/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-video Agnes model from the T2V pipeline", async () => {
    const result = await handleVideoGenerationCore({
      body: { prompt: "x" },
      modelInfo: { provider: "agnes-api", model: "agnes-2.5-flash" },
      credentials: { apiKey: "k" },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("does not support video generation");
  });
});
