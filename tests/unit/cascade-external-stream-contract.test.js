// Regression suite: Cascade external response protocol must follow the CLIENT
// stream flag, not the internal stage mode.
//
// Cascade intentionally runs every stage with stream:false (it must consume the
// complete response to extract text and parse CONFIDENCE before deciding whether
// to escalate). The ORIGINAL client request may still be stream:true.
//
// Bug: handleCascadeChat returned the internal stage Response (application/json)
// directly, so a stream:true client received a JSON body where it expected
// text/event-stream → zero SSE chunks → "The model returned no content",
// even though the provider attempt and canonicalAttempt were both `success`.
//
// Fix: an external protocol adapter on the two Cascade return paths (final stage
// + confident stage) wraps the finalized OpenAI chat.completion JSON as an
// OpenAI chat.completion.chunk SSE stream when body.stream === true.
//
// Scope: external boundary only. Internal stage execution (stream:false),
// CONFIDENCE parsing, escalation, canonicalAttempt semantics and fallback
// policy are untouched.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../open-sse/services/providerCapabilities.js", () => ({
  validateComboRoles: () => [],
}));

const { handleCascadeChat } = await import("../../open-sse/services/combo.js");

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const attempt = (overrides = {}) => ({
  source: "provider",
  transportOk: true,
  streamStarted: null,
  hasText: true,
  completionState: "success",
  completionType: "http_2xx_json",
  terminalState: null,
  finishReason: "stop",
  eofSeen: null,
  errorSeen: false,
  abortSeen: false,
  usableOutput: true,
  logicalSuccess: true,
  outcome: "success",
  ...overrides,
});

const confident = (t) => ({
  id: "chatcmpl-stage",
  object: "chat.completion",
  created: 1700000000,
  model: "stage-model",
  choices: [{ index: 0, message: { role: "assistant", content: `${t}\nCONFIDENCE: 92` }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

const uncertain = (t) => ({
  id: "chatcmpl-stage1",
  object: "chat.completion",
  created: 1700000000,
  model: "stage-model",
  choices: [{ index: 0, message: { role: "assistant", content: `${t}\nCONFIDENCE: 10` }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

// Parse a chat.completion.chunk SSE stream into its emitted chunks.
async function readSSE(response) {
  const text = await response.text();
  const chunks = [];
  let doneCount = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "data: [DONE]") {
      doneCount++;
      continue;
    }
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    chunks.push(JSON.parse(payload));
  }
  return { text, chunks, doneCount };
}

function runCascade({ body, models, fake }) {
  return handleCascadeChat({
    body,
    models,
    handleSingleModel: fake,
    log,
    comboName: "c",
    tuning: {},
    signal: undefined,
    runBudget: null,
  });
}

describe("Cascade: external stream contract", () => {
  it("1. stream:false client → final response stays application/json and content is preserved", async () => {
    const fake = vi.fn(async (b, m) => ({
      success: true,
      status: 200,
      response: jsonRes(confident("final answer")),
      canonicalAttempt: attempt(),
    }));
    const out = await runCascade({ body: { model: "c", stream: false }, models: ["cheap", "strong"], fake });

    expect(out.headers.get("content-type")).toContain("application/json");
    const json = await out.json();
    expect(json.choices[0].message.content).toContain("final answer");
  });

  it("2. stream:true client → internal stage still runs with stream:false", async () => {
    const seenBodies = [];
    const fake = vi.fn(async (b, m) => {
      seenBodies.push(b);
      return { success: true, status: 200, response: jsonRes(confident("ok")), canonicalAttempt: attempt() };
    });
    await runCascade({ body: { model: "c", stream: true }, models: ["cheap", "strong"], fake });

    // Internal execution semantics are unchanged: stages must remain consumable.
    expect(seenBodies.length).toBeGreaterThan(0);
    for (const b of seenBodies) expect(b.stream).toBe(false);
  });

  it("3. stream:true client → external response is text/event-stream with the answer present", async () => {
    const fake = vi.fn(async (b, m) => ({
      success: true,
      status: 200,
      response: jsonRes(confident("streamed answer")),
      canonicalAttempt: attempt(),
    }));
    const out = await runCascade({ body: { model: "c", stream: true }, models: ["cheap", "strong"], fake });

    expect(out.headers.get("content-type")).toContain("text/event-stream");
    const { text, chunks } = await readSSE(out);
    expect(text).toContain("streamed answer");
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("4. stream:true → stream terminates with exactly one [DONE]", async () => {
    const fake = vi.fn(async (b, m) => ({
      success: true,
      status: 200,
      response: jsonRes(confident("done test")),
      canonicalAttempt: attempt(),
    }));
    const out = await runCascade({ body: { model: "c", stream: true }, models: ["cheap", "strong"], fake });

    const { doneCount, chunks } = await readSSE(out);
    expect(doneCount).toBe(1);
    // Terminal chunk carries a finish_reason; the stream ends after [DONE].
    const finished = chunks.some((c) => c?.choices?.[0]?.finish_reason);
    expect(finished).toBe(true);
  });

  it("5. confidence >= threshold → no escalation and streaming contract still holds", async () => {
    const calls = [];
    const fake = vi.fn(async (b, m) => {
      calls.push(m);
      return { success: true, status: 200, response: jsonRes(confident("confident answer")), canonicalAttempt: attempt() };
    });
    const out = await runCascade({ body: { model: "c", stream: true }, models: ["cheap", "strong"], fake });

    expect(calls).toEqual(["cheap"]); // stage 1 accepted, no escalation
    expect(out.headers.get("content-type")).toContain("text/event-stream");
    const { text } = await readSSE(out);
    expect(text).toContain("confident answer");
  });

  it("6. escalation path (stage 1 low confidence → stage 2 selected) still streams", async () => {
    const calls = [];
    const fake = vi.fn(async (b, m) => {
      calls.push(m);
      if (m === "cheap") {
        return { success: true, status: 200, response: jsonRes(uncertain("weak")), canonicalAttempt: attempt() };
      }
      return { success: true, status: 200, response: jsonRes(confident("escalated answer")), canonicalAttempt: attempt() };
    });
    const out = await runCascade({ body: { model: "c", stream: true }, models: ["cheap", "strong"], fake });

    expect(calls).toEqual(["cheap", "strong"]);
    expect(out.headers.get("content-type")).toContain("text/event-stream");
    const { text, doneCount } = await readSSE(out);
    expect(text).toContain("escalated answer");
    expect(doneCount).toBe(1);
  });

  it("7. tool_calls and reasoning are not discarded when adapting JSON → SSE", async () => {
    const withStructure = {
      id: "chatcmpl-tools",
      object: "chat.completion",
      created: 1700000000,
      model: "tool-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "planning the call",
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "Bash", arguments: "{\"command\":\"ls\"}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    };
    const fake = vi.fn(async (b, m) => ({
      success: true,
      status: 200,
      response: jsonRes(withStructure),
      canonicalAttempt: attempt({ finishReason: "tool_calls" }),
    }));
    const out = await runCascade({ body: { model: "c", stream: true }, models: ["cheap", "strong"], fake });

    const { chunks, text, doneCount } = await readSSE(out);
    const toolChunk = chunks.find((c) => c?.choices?.[0]?.delta?.tool_calls?.length > 0);
    expect(toolChunk).toBeTruthy();
    expect(toolChunk.choices[0].delta.tool_calls[0].function.name).toBe("Bash");
    expect(text).toContain("planning the call");
    const finishChunk = chunks.find((c) => c?.choices?.[0]?.finish_reason);
    expect(finishChunk.choices[0].finish_reason).toBe("tool_calls");
    expect(doneCount).toBe(1);
  });

  it("8. usage is preserved when adapting JSON → SSE", async () => {
    const fake = vi.fn(async (b, m) => ({
      success: true,
      status: 200,
      response: jsonRes(confident("usage test")),
      canonicalAttempt: attempt(),
    }));
    const out = await runCascade({ body: { model: "c", stream: true }, models: ["cheap", "strong"], fake });

    const { chunks } = await readSSE(out);
    const usageChunk = chunks.find((c) => c?.usage);
    expect(usageChunk).toBeTruthy();
    expect(usageChunk.usage.total_tokens).toBe(15);
  });
});
