import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getPricingForModel } from "open-sse/providers/pricing.js";
import { resolveTransport, resolveAlternateTransport } from "open-sse/services/provider.js";

describe("bynara capabilities (from /v1/models metadata)", () => {
  const cases = [
    ["agnes-2.0-flash",        { vision: true,  reasoning: true,  contextWindow: 512000 }],
    ["agnes-2.5-flash",        { vision: true,  reasoning: true,  contextWindow: 512000 }],
    ["glm-5.3-flash-free",     { vision: true,  reasoning: true,  contextWindow: 1000000 }],
    ["glm-5.3-free",           { vision: false, reasoning: true,  contextWindow: 128000 }],
    ["grok-4.5-free",          { vision: true,  reasoning: false, contextWindow: 212000 }],
    ["laguna-s-2.1",           { vision: false, reasoning: true,  contextWindow: 262000 }],
    ["ling-3.0-flash-fin-free", { vision: false, reasoning: false, contextWindow: 262000 }],
    ["minimax-m3-free",        { vision: true,  reasoning: true,  contextWindow: 1000000 }],
    ["mistral-large",          { vision: false, reasoning: false, contextWindow: 252000 }],
    ["mistral-medium-3-5",     { vision: true,  reasoning: false, contextWindow: 256000 }],
    ["nemotron-3.5-lightning-free", { vision: false, reasoning: false, contextWindow: 262000 }],
    ["qwen-3.8-max-free",      { vision: false, reasoning: false, contextWindow: 262144 }],
    ["qwen3.8-27b",            { vision: false, reasoning: true,  contextWindow: 1000000 }],
    ["qwen3.8-flash-free",     { vision: true,  reasoning: true,  contextWindow: 1000000 }],
    ["stepfun-3.7-flash",      { vision: true,  reasoning: true,  contextWindow: 262000 }],
    ["tencent-hy3-free",       { vision: false, reasoning: false, contextWindow: 262000 }],
    ["deepseek-v4-flash",      { vision: false, reasoning: true,  contextWindow: 1000000 }],
  ];

  it.each(cases)("%s matches the gateway metadata", (model, expected) => {
    const c = getCapabilitiesForModel("bynara", model);
    expect(c.vision).toBe(expected.vision);
    expect(c.reasoning).toBe(expected.reasoning);
    expect(c.contextWindow).toBe(expected.contextWindow);
  });

  // Regression: the static mirror once pinned glm-5.3-flash-free at 128000
  // while the live catalog reports 1000000. The 128K value starved
  // resolveOutputBudget for large Swarm-panel prompts (availableContext <= 0 →
  // max_tokens:0 → provider rejection → empty streaming response incident).
  it("glm-5.3-flash-free keeps the live 1M context window (drift guard)", () => {
    expect(getCapabilitiesForModel("bynara", "glm-5.3-flash-free").contextWindow).toBe(1000000);
  });

  // Regression: glm-5.3-free had NO override at all, so it fell through to
  // DEFAULT_CAPABILITIES (reasoning:false) despite live reasoning support.
  it("glm-5.3-free is reasoning-capable per the live catalog", () => {
    expect(getCapabilitiesForModel("bynara", "glm-5.3-free").reasoning).toBe(true);
  });

  // Regression: dead override keys (ling-3.0-flash-free / nemotron-3-ultra)
  // never matched a live model id and fell through to the generic *ling-* /
  // *nemotron* patterns (128K, reasoning:true). The real ids must resolve to
  // the live-verified mirror instead.
  it("live ids ling-3.0-flash-fin-free and nemotron-3.5-lightning-free resolve to the mirror", () => {
    const ling = getCapabilitiesForModel("bynara", "ling-3.0-flash-fin-free");
    expect(ling.contextWindow).toBe(262000);
    expect(ling.reasoning).toBe(false);
    const nemotron = getCapabilitiesForModel("bynara", "nemotron-3.5-lightning-free");
    expect(nemotron.contextWindow).toBe(262000);
    expect(nemotron.reasoning).toBe(false);
  });

  it("resolves identically via the by alias", () => {
    expect(getCapabilitiesForModel("by", "agnes-2.0-flash")).toEqual(
      getCapabilitiesForModel("bynara", "agnes-2.0-flash")
    );
  });

  it("keeps the safe default floor for unlisted passthrough models", () => {
    const c = getCapabilitiesForModel("bynara", "some-brand-new-model");
    expect(c.contextWindow).toBe(200000); // DEFAULT_CAPABILITIES
    expect(c.vision).toBe(false);
  });
});

describe("bynara pricing (USD per 1M tokens, from router.bynara.id/pricing)", () => {
  const cases = [
    ["agnes-2.0-flash",     { input: 0.03, output: 0.11 }],
    ["agnes-2.5-flash",     { input: 0.06, output: 0.28 }],
    ["grok-4.5-free",       { input: 0.40, output: 0.64 }],
    ["laguna-s-2.1",        { input: 0.00, output: 0.00 }],
    ["ling-3.0-flash-fin-free", { input: 0.01, output: 0.02 }],
    ["mistral-large",       { input: 0.15, output: 0.45 }],
    ["mistral-medium-3-5",  { input: 0.30, output: 1.51 }],
    ["nemotron-3.5-lightning-free", { input: 0.00, output: 0.00 }],
    ["stepfun-3.7-flash",   { input: 0.04, output: 0.23 }],
    ["tencent-hy3-free",    { input: 0.03, output: 0.11 }],
  ];

  it.each(cases)("%s is priced at bynara's pay-as-you-go rate", (model, expected) => {
    const p = getPricingForModel("bynara", model);
    expect(p).not.toBeNull();
    expect(p.input).toBeCloseTo(expected.input, 4);
    expect(p.output).toBeCloseTo(expected.output, 4);
  });

  it("resolves identically via the by alias", () => {
    expect(getPricingForModel("by", "mistral-large")).toEqual(
      getPricingForModel("bynara", "mistral-large")
    );
  });
});

describe("bynara cross-transport fallback (Anthropic /v1/messages)", () => {
  it("picks the OpenAI endpoint for OpenAI clients and the Claude endpoint for Anthropic clients", () => {
    expect(resolveTransport("bynara", "openai")?.format).toBe("openai");
    expect(resolveTransport("bynara", "openai")?.baseUrl).toContain("/chat/completions");
    expect(resolveTransport("bynara", "claude")?.format).toBe("claude");
    expect(resolveTransport("bynara", "claude")?.baseUrl).toBe("https://router.bynara.id/v1/messages");
  });

  it("falls back to /v1/messages with Bearer auth (docs: key as Bearer token, NOT x-api-key)", () => {
    const alt = resolveAlternateTransport("bynara", "openai");
    expect(alt).not.toBeNull();
    expect(alt.format).toBe("claude");
    expect(alt.baseUrl).toBe("https://router.bynara.id/v1/messages");
    // The docs explicitly say to authenticate /v1/messages with the key as a
    // Bearer token — x-api-key would 401 on this gateway.
    expect(alt.auth).toEqual({ combined: true, header: "Authorization", scheme: "bearer" });
    expect(alt.auth.header).not.toBe("x-api-key");
  });

  it("returns null for single-endpoint providers (no fallback possible)", () => {
    expect(resolveAlternateTransport("openai", "openai")).toBeNull();
  });
});
