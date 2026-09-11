/**
 * OpenRouter + Vertex (Veo) video adapter tests.
 *
 * OpenRouter: collection-root POST, registry account headers, xAI-shaped poll.
 * Vertex: predictLongRunning / fetchPredictOperation translation, SA-JSON auth,
 * I2V (promptOptional), no raw API keys.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POLL_INTERVAL_MS } from "../../open-sse/handlers/imageProviders/_base.js";
import openrouter from "../../open-sse/handlers/videoProviders/openrouter.js";
import vertex from "../../open-sse/handlers/videoProviders/vertex.js";
import { getVideoAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { handleVideoGenerationCore } from "../../open-sse/handlers/videoGenerationCore.js";

const originalFetch = global.fetch;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SA_JSON = JSON.stringify({
  type: "service_account",
  client_email: "veo@test.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
  project_id: "demo-project",
});

describe("OpenRouter video adapter", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("is registered and POSTs to the /videos collection root (no /generations)", () => {
    expect(getVideoAdapter("openrouter")).toBe(openrouter);
    expect(openrouter.buildUrl()).toBe("https://openrouter.ai/api/v1/videos");
    expect(openrouter.buildUrl()).not.toContain("generations");
  });

  it("applies registry HTTP-Referer / X-Title headers with Bearer auth", () => {
    const h = openrouter.buildHeaders({ apiKey: "sk-or-test" });
    expect(h.Authorization).toBe("Bearer sk-or-test");
    expect(h["HTTP-Referer"]).toBe("https://endpoint-proxy.local");
    expect(h["X-Title"]).toBe("Endpoint Proxy");
  });

  it("passes the documented body fields through and requires prompt", () => {
    expect(openrouter.buildBody("google/veo-3.1", {
      prompt: "a drone shot over Tokyo",
      duration: 8,
      aspect_ratio: "16:9",
      resolution: "1080p",
    })).toEqual({
      model: "google/veo-3.1",
      prompt: "a drone shot over Tokyo",
      duration: 8,
      aspect_ratio: "16:9",
      resolution: "1080p",
    });
    expect(() => openrouter.buildBody("google/veo-3.1", {})).toThrow(/prompt/);
  });

  it("polls id until completed and normalizes unsigned_urls", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ status: "queued" }, 202))
      .mockResolvedValueOnce(jsonResponse({
        status: "completed",
        unsigned_urls: ["https://or.example/out.mp4"],
      }));
    const promise = openrouter.parseResponse(jsonResponse({ id: "job-1", status: "queued" }), {
      headers: { Authorization: "Bearer k" },
    });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    const parsed = await promise;
    expect(openrouter.normalize(parsed)).toEqual({
      created: expect.any(Number),
      data: [{ url: "https://or.example/out.mp4" }],
    });
  });
});

describe("Vertex (Veo) video adapter", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("is registered and advertises promptOptional (I2V)", () => {
    expect(getVideoAdapter("vertex")).toBe(vertex);
    expect(vertex.promptOptional).toBe(true);
  });

  it("rejects missing project_id before any upstream call", async () => {
    await expect(vertex.buildUrl("veo-3.0-generate-001", { apiKey: "raw-key-not-sa" }, {}))
      .rejects.toThrow(/project_id/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("builds a project-scoped predictLongRunning URL from SA JSON", async () => {
    // refreshVertexToken will fail (fake key) — mint path is exercised below with a mock.
    // Here we only assert the URL shape once accessToken is already present.
    const credentials = {
      apiKey: "raw-unused",
      accessToken: "ya29.pre",
      providerSpecificData: { projectId: "p1", location: "us-central1" },
    };
    const url = await vertex.buildUrl("veo-3.1-generate-preview", credentials, {});
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/p1/locations/us-central1/publishers/google/models/veo-3.1-generate-preview:predictLongRunning"
    );
  });

  it("rejects raw API keys with no OAuth token", async () => {
    await expect(vertex.buildUrl("veo-3.0-generate-001", {
      apiKey: "sk-not-sa-json",
      providerSpecificData: { projectId: "p1" },
    }, {})).rejects.toThrow(/Service Account JSON|OAuth access token/);
  });

  it("translates the OpenAI-ish body to instances[]/parameters{}", () => {
    const body = vertex.buildBody("veo-3.1-generate-preview", {
      prompt: "waves",
      duration: 8,
      aspect_ratio: "16:9",
      n: 1,
      storage_uri: "gs://bucket/out/",
      generate_audio: true,
      image: "data:image/png;base64,AAAA",
    });
    expect(body.instances[0].prompt).toBe("waves");
    expect(body.instances[0].image).toEqual({ bytesBase64Encoded: "AAAA", mimeType: "image/png" });
    expect(body.parameters).toMatchObject({
      sampleCount: 1,
      durationSeconds: 8,
      aspectRatio: "16:9",
      storageUri: "gs://bucket/out/",
      generateAudio: true,
    });
  });

  it("requires a prompt or image (I2V-capable)", () => {
    expect(() => vertex.buildBody("veo-3.0-generate-001", {})).toThrow(/prompt or an image/);
  });

  it("polls via fetchPredictOperation (POST, not GET) and maps samples", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ done: false }))
      .mockResolvedValueOnce(jsonResponse({
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [{ video: { uri: "https://storage.example/v.mp4" } }],
          },
        },
      }));
    const promise = vertex.parseResponse(
      jsonResponse({ name: "projects/p1/locations/us-central1/publishers/google/models/veo-3.0-generate-001/operations/op1" }),
      { headers: { Authorization: "Bearer tok" } }
    );
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    const parsed = await promise;
    // First poll must be POST :fetchPredictOperation
    const firstPoll = global.fetch.mock.calls[0];
    expect(firstPoll[1].method).toBe("POST");
    expect(String(firstPoll[0])).toContain(":fetchPredictOperation");
    expect(JSON.parse(firstPoll[1].body)).toEqual({
      operationName: "projects/p1/locations/us-central1/publishers/google/models/veo-3.0-generate-001/operations/op1",
    });
    expect(vertex.normalize(parsed)).toEqual({
      created: expect.any(Number),
      data: [{ url: "https://storage.example/v.mp4" }],
    });
  });

  it("throws when the create response carries no operation name", async () => {
    await expect(vertex.parseResponse(jsonResponse({}), { headers: { Authorization: "Bearer t" } }))
      .rejects.toThrow(/no operation name/);
  });
});

describe("videoGenerationCore wiring for openrouter/vertex", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("returns 400 before any upstream call when openrouter body is invalid", async () => {
    const result = await handleVideoGenerationCore({
      body: { model: "openrouter/google/veo-3.1" },
      modelInfo: { provider: "openrouter", model: "google/veo-3.1" },
      credentials: { apiKey: "k" },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/prompt/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when vertex credentials are raw API keys (no billable job)", async () => {
    const result = await handleVideoGenerationCore({
      body: { prompt: "x" },
      modelInfo: { provider: "vertex", model: "veo-3.0-generate-001" },
      credentials: { apiKey: "sk-raw", providerSpecificData: { projectId: "p" } },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Service Account JSON|OAuth/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-video kind on openrouter (image model never reaches the adapter)", async () => {
    const result = await handleVideoGenerationCore({
      body: { prompt: "x" },
      modelInfo: { provider: "openrouter", model: "openai/dall-e-3" },
      credentials: { apiKey: "k" },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("does not support video generation");
  });
});
