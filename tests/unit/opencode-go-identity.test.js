// opencode-go request identity — the Go lane must forward a real client
// conversation id, keep the protected native credential, and never leak
// arbitrary client headers or a fabricated session.
//
// All upstream calls are captured through a mocked proxyAwareFetch: no network,
// no credentials (dummy native key only).
import { describe, it, expect, vi, beforeEach } from "vitest";

const upstreamCalls = [];

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async (url, options = {}) => {
    upstreamCalls.push({ url, headers: { ...options.headers }, body: options.body });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
}));

import { OpenCodeGoExecutor } from "open-sse/executors/opencode-go.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveOpenCodeIdentity } from "open-sse/utils/openCodeIdentity.js";

const NATIVE_KEY = "dummy-native-go-key-not-real";
const CHAT_MODEL = "deepseek-v4.1-flash";
const MESSAGES_MODEL = "minimax-m3";

function identityFrom(headers, body = {}) {
  return resolveOpenCodeIdentity({ headers, body, requireClientSession: true });
}

function baseBody(model = CHAT_MODEL) {
  return { model, messages: [{ role: "user", content: "hi" }], stream: true };
}

beforeEach(() => {
  upstreamCalls.length = 0;
});

describe("opencode-go strict session resolution", () => {
  it("canonicalizes a valid client session once and keeps it stable across turns", () => {
    const turn1 = identityFrom({ "x-opencode-session": "ses_conv-abc" });
    const turn2 = identityFrom({ "x-opencode-session": "ses_conv-abc" });
    expect(turn1.sessionId).toBe("ses_convabc");
    expect(turn2.sessionId).toBe(turn1.sessionId);
  });

  it("distinct conversations resolve to distinct sessions", () => {
    const a = identityFrom({ "x-opencode-session": "ses_conv-a" });
    const b = identityFrom({ "x-opencode-session": "ses_conv-b" });
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("accepts a canonical tail of exactly the 64-character cap", () => {
    const tail = "a".repeat(64);
    expect(identityFrom({ "x-opencode-session": `ses_${tail}` }).sessionId).toBe(`ses_${tail}`);
  });

  it("rejects oversized canonical tails instead of truncating them into one session", () => {
    const capped = "a".repeat(64);
    const endsWithB = identityFrom({ "x-opencode-session": `ses_${capped}b` });
    const endsWithC = identityFrom({ "x-opencode-session": `ses_${capped}c` });
    expect(endsWithB.sessionId).toBeNull();
    expect(endsWithC.sessionId).toBeNull();
  });

  it("forwards the same session upstream across two turns; request ids stay per-turn", async () => {
    const executor = new OpenCodeGoExecutor();
    const headers = { "x-opencode-session": "ses_conv-two-turns" };
    for (let turn = 0; turn < 2; turn++) {
      await executor.execute({
        model: CHAT_MODEL,
        body: baseBody(),
        stream: true,
        credentials: { apiKey: NATIVE_KEY },
        opencodeIdentity: identityFrom(headers),
      });
    }
    expect(upstreamCalls).toHaveLength(2);
    expect(upstreamCalls[0].headers["x-opencode-session"]).toBe("ses_convtwoturns");
    expect(upstreamCalls[1].headers["x-opencode-session"]).toBe(upstreamCalls[0].headers["x-opencode-session"]);
    expect(upstreamCalls[1].headers["x-opencode-request"]).not.toBe(upstreamCalls[0].headers["x-opencode-request"]);
  });

  it("distinct conversations stay distinct upstream", async () => {
    const executor = new OpenCodeGoExecutor();
    await Promise.all([
      executor.execute({ model: CHAT_MODEL, body: baseBody(), stream: true, credentials: { apiKey: NATIVE_KEY }, opencodeIdentity: identityFrom({ "x-opencode-session": "ses_conv-a" }) }),
      executor.execute({ model: CHAT_MODEL, body: baseBody(), stream: true, credentials: { apiKey: NATIVE_KEY }, opencodeIdentity: identityFrom({ "x-opencode-session": "ses_conv-b" }) }),
    ]);
    const sessions = upstreamCalls.map((c) => c.headers["x-opencode-session"]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).not.toBe(sessions[1]);
  });

  it.each([
    ["missing header", {}],
    ["empty string", { "x-opencode-session": "" }],
    ["whitespace only", { "x-opencode-session": "   \t  " }],
    ["oversized", { "x-opencode-session": `ses_${"a".repeat(600)}` }],
    ["CR/LF", { "x-opencode-session": "ses_ab\r\ncd" }],
    ["control char", { "x-opencode-session": "ses_ab\u0000cd" }],
    ["no usable characters", { "x-opencode-session": "!!!/" }],
  ])("rejects %s (never fabricates a session)", (_label, headers) => {
    const identity = identityFrom(headers);
    expect(identity.sessionId).toBeNull();
    // And the executor refuses to build headers for it — no upstream dispatch.
    const executor = new OpenCodeGoExecutor();
    expect(() => executor.buildHeaders({ apiKey: NATIVE_KEY }, true, CHAT_MODEL, identity)).toThrow(
      /x-opencode-session/
    );
  });

  it("never derives a Go session from body conversation metadata", () => {
    const id = identityFrom({}, { conversation_id: "conv-123", prompt_cache_key: "pck" });
    expect(id.sessionId).toBeNull();
  });

  it("preserves a client request id, else generates one per logical request", () => {
    expect(identityFrom({ "x-opencode-session": "ses_x", "x-opencode-request": "msg_keep" }).requestId).toBe("msg_keep");
    const a = identityFrom({ "x-opencode-session": "ses_x" });
    const b = identityFrom({ "x-opencode-session": "ses_x" });
    expect(a.requestId).toMatch(/^msg_[0-9a-f]{32}$/);
    expect(b.requestId).not.toBe(a.requestId);
  });
});

describe("opencode-go executor headers", () => {
  it("throws before dispatch when the session is absent", async () => {
    const executor = new OpenCodeGoExecutor();
    expect(() => executor.buildHeaders({ apiKey: NATIVE_KEY }, true, CHAT_MODEL, null)).toThrow(
      /x-opencode-session/
    );
    await expect(
      executor.execute({
        model: CHAT_MODEL,
        body: baseBody(),
        stream: true,
        credentials: { apiKey: NATIVE_KEY },
        opencodeIdentity: { sessionId: null, requestId: "msg_missing" },
      })
    ).rejects.toMatchObject({ code: "OPENCODE_SESSION_REQUIRED", status: 400 });
    expect(upstreamCalls).toHaveLength(0);
  });

  it("uses the dummy native key and never forwards incoming credentials/unrelated headers", async () => {
    const executor = new OpenCodeGoExecutor();
    const identity = identityFrom({
      "x-opencode-session": "ses_native",
      "x-opencode-request": "msg_native",
      "user-agent": "test-client/1.0",
      authorization: "Bearer client-gateway-key",
      cookie: "session=secret",
      "x-custom": "nope",
    });
    await executor.execute({
      model: CHAT_MODEL,
      body: baseBody(),
      stream: true,
      credentials: { apiKey: NATIVE_KEY, rawHeaders: { authorization: "Bearer client-gateway-key" } },
      opencodeIdentity: identity,
    });

    expect(upstreamCalls).toHaveLength(1);
    const h = upstreamCalls[0].headers;
    expect(h.Authorization).toBe(`Bearer ${NATIVE_KEY}`);
    expect(h.Authorization).not.toContain("client-gateway-key");
    expect(h.cookie).toBeUndefined();
    expect(h.Cookie).toBeUndefined();
    expect(h["x-custom"]).toBeUndefined();
    expect(h["x-opencode-session"]).toBe("ses_native");
    expect(h["x-opencode-request"]).toBe("msg_native");
    expect(h["User-Agent"]).toBe("test-client/1.0");
    expect(h.Accept).toBe("text/event-stream");
  });

  it("keeps x-api-key auth for the messages lane (and no Authorization)", async () => {
    const executor = new OpenCodeGoExecutor();
    const identity = identityFrom({ "x-opencode-session": "ses_msg" });
    await executor.execute({
      model: MESSAGES_MODEL,
      body: baseBody(MESSAGES_MODEL),
      stream: true,
      credentials: { apiKey: NATIVE_KEY },
      opencodeIdentity: identity,
    });
    const h = upstreamCalls[0].headers;
    expect(h["x-api-key"]).toBe(NATIVE_KEY);
    expect(h.Authorization).toBeUndefined();
    expect(h["anthropic-version"]).toBeDefined();
  });

  it("falls back to a truthful wrapper UA (never impersonates opencode) when the client sent none", async () => {
    const executor = new OpenCodeGoExecutor();
    const identity = identityFrom({ "x-opencode-session": "ses_ua" });
    const headers = executor.buildHeaders({ apiKey: NATIVE_KEY }, true, CHAT_MODEL, identity);
    expect(headers["User-Agent"]).toBe("ExtremeRouter");
    expect(headers["User-Agent"]).not.toMatch(/opencode/i);
  });

  it("rejects a control-character UA and uses the truthful wrapper UA instead", () => {
    const executor = new OpenCodeGoExecutor();
    const identity = identityFrom({ "x-opencode-session": "ses_ua", "user-agent": "bad\r\nua" });
    expect(identity.userAgent).toBeNull();
    const headers = executor.buildHeaders({ apiKey: NATIVE_KEY }, true, CHAT_MODEL, identity);
    expect(headers["User-Agent"]).toBe("ExtremeRouter");
    expect(headers["User-Agent"]).not.toMatch(/[\r\n]/);
  });

  it("preserves stream semantics (Accept) for stream and non-stream", () => {
    const executor = new OpenCodeGoExecutor();
    const identity = identityFrom({ "x-opencode-session": "ses_accept" });
    expect(executor.buildHeaders({}, true, CHAT_MODEL, identity).Accept).toBe("text/event-stream");
    expect(executor.buildHeaders({}, false, CHAT_MODEL, identity).Accept).toBeUndefined();
  });

  it("interleaved concurrent identities never cross-talk on the singleton executor", async () => {
    const executor = getExecutor("opencode-go");
    const a = identityFrom({ "x-opencode-session": "ses_A", "x-opencode-request": "msg_A", "user-agent": "ua-A" });
    const b = identityFrom({ "x-opencode-session": "ses_B", "x-opencode-request": "msg_B", "user-agent": "ua-B" });

    await Promise.all([
      executor.execute({ model: CHAT_MODEL, body: baseBody(), stream: true, credentials: { apiKey: "dummy-A" }, opencodeIdentity: a }),
      executor.execute({ model: CHAT_MODEL, body: baseBody(), stream: true, credentials: { apiKey: "dummy-B" }, opencodeIdentity: b }),
    ]);

    const byRequest = Object.fromEntries(upstreamCalls.map((c) => [c.headers["x-opencode-request"], c.headers]));
    expect(byRequest.msg_A["x-opencode-session"]).toBe("ses_A");
    expect(byRequest.msg_A["User-Agent"]).toBe("ua-A");
    expect(byRequest.msg_A.Authorization).toBe("Bearer dummy-A");
    expect(byRequest.msg_B["x-opencode-session"]).toBe("ses_B");
    expect(byRequest.msg_B["User-Agent"]).toBe("ua-B");
    expect(byRequest.msg_B.Authorization).toBe("Bearer dummy-B");
  });
});
