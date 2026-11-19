// Regression: the Ollama adapter must not turn an upstream error into a 200.
//
// POST /v1/api/chat wrapped every handleChat response with transformToOllama(),
// which always returned a fresh 200 NDJSON Response. A 400/403/503 therefore
// reached Ollama clients as `200 application/x-ndjson` with a final
// `{"done":true}` line, hiding the real failure.
//
// Coverage:
//  - POST route (handleChat/initTranslators mocked): non-OK response is returned
//    with its status, body and existing headers, plus the endpoint's CORS header
//    (the transform used to add it), and is never re-encoded as NDJSON.
//  - transformToOllama directly: non-OK input keeps its status/error body and
//    emits no `done` line; the 200 SSE happy path still becomes NDJSON.
// Pure unit test: no DB, no network, no credentials.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: vi.fn() }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn(async () => {}) }));

import { POST } from "@/app/api/v1/api/chat/route.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";

const ERROR_BODY = JSON.stringify({
  error: { message: "invalid request", type: "invalid_request_error" },
});
const MODEL = "deepseek-v4.1-flash";

function errorResponse(status = 400, headers = { "Content-Type": "application/json" }) {
  return new Response(ERROR_BODY, { status, headers });
}

function ollamaRequest() {
  return new Request("http://127.0.0.1:20128/v1/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "hi" }] }),
  });
}

beforeEach(() => {
  handleChat.mockReset();
});

describe("POST /v1/api/chat error passthrough", () => {
  it("returns an upstream 400 unchanged instead of a done:true 200", async () => {
    handleChat.mockResolvedValue(errorResponse(400));

    const response = await POST(ollamaRequest());
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(response.ok).toBe(false);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(text).toBe(ERROR_BODY);
    expect(text).not.toContain('"done":true');
  });

  it("preserves other non-OK statuses (e.g. 403)", async () => {
    handleChat.mockResolvedValue(errorResponse(403));

    const response = await POST(ollamaRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe(ERROR_BODY);
  });

  it("preserves a 503 from the upstream", async () => {
    handleChat.mockResolvedValue(errorResponse(503));

    const response = await POST(ollamaRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe(ERROR_BODY);
  });

  it("keeps Retry-After/rate-limit headers while adding CORS on a 429", async () => {
    handleChat.mockResolvedValue(
      errorResponse(429, {
        "Content-Type": "application/json",
        "Retry-After": "30",
        "X-RateLimit-Remaining": "0",
      })
    );

    const response = await POST(ollamaRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe(ERROR_BODY);
  });
});

describe("transformToOllama non-OK passthrough", () => {
  it("keeps a 400 status and error body, without an NDJSON done line", async () => {
    const response = transformToOllama(errorResponse(400), MODEL);
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(text).toBe(ERROR_BODY);
    expect(text).not.toContain('"done"');
  });

  it("does not throw or claim success when the error body is empty", async () => {
    const response = transformToOllama(new Response(null, { status: 500 }), MODEL);

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe("");
  });

  it("still transforms a successful SSE stream to Ollama NDJSON", async () => {
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" }, finish_reason: null }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n` +
      "data: [DONE]\n\n";
    const response = transformToOllama(
      new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      MODEL
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(text).toContain(JSON.stringify({ model: MODEL, message: { role: "assistant", content: "hello" }, done: false }));
    expect(text.trim().split("\n").at(-1)).toContain('"done":true');
  });
});
