import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { MODEL_PRICING, getPricingForModel } from "../../open-sse/providers/pricing.js";
import { GlmExecutor, parseGlmEffortTier } from "../../open-sse/executors/glm.js";
import { getExecutor } from "../../open-sse/executors/index.js";

// GLM-5.3 support (released 2026-08-14, https://z.ai/blog/glm-5.3) — port of
// OmniRoute PR #10358 adapted to this repo's registry/executor architecture.
//
// Upstream ships ONE model id (`glm-5.3`); effort is a request parameter
// (`reasoning_effort`: low|high|max, default max) on the coding
// chat/completions endpoint, and `thinking.type: "disabled"` is rejected.
// `glm-5.3-high` / `glm-5.3-low` are aliases resolved by the GlmExecutor only;
// the registry rewrites their wire model to the base id via upstreamModelId.
//
// Spec caveat: Z.ai has not yet published the default context window — 1M is
// mirrored from GLM-5.2 (same base model) per operator decision.

const GLM_5_3_IDS = ["glm-5.3", "glm-5.3-high", "glm-5.3-low"];

function registryEntry(providerId) {
  const entry = REGISTRY.find((r) => r.id === providerId);
  expect(entry, `provider "${providerId}" should be registered`).toBeDefined();
  return entry;
}

function modelIds(providerId) {
  return registryEntry(providerId).models.map((m) => m.id);
}

describe("GLM-5.3 catalog (port of OmniRoute #10358)", () => {
  for (const providerId of ["glm", "glm-cn"]) {
    it(`${providerId} advertises the GLM-5.3 base model and effort tiers`, () => {
      const ids = modelIds(providerId);
      for (const id of GLM_5_3_IDS) {
        expect(ids).toContain(id);
      }
    });

    it(`${providerId} rewrites the effort-tier aliases to the base upstream id`, () => {
      expect(getModelUpstreamId(providerId, "glm-5.3")).toBe("glm-5.3");
      expect(getModelUpstreamId(providerId, "glm-5.3-high")).toBe("glm-5.3");
      expect(getModelUpstreamId(providerId, "glm-5.3-low")).toBe("glm-5.3");
    });
  }

  it("glm-5.2 effort aliases remain unsupported (regression guard — no accidental tier ids)", () => {
    expect(modelIds("glm")).not.toContain("glm-5.2-high");
    expect(parseGlmEffortTier("glm-5.2-high")).toBeNull();
  });

  it("capabilities give GLM-5.3 family 1M context and low/high/max effort levels", () => {
    for (const id of GLM_5_3_IDS) {
      const caps = getCapabilitiesForModel("glm", id);
      expect(caps.contextWindow).toBe(1000000);
      expect(caps.maxOutput).toBe(128000);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingFormat).toBe("zai");
      expect(caps.thinkingLevels).toEqual(["low", "high", "max"]);
    }
  });

  it("GLM-5.3 pricing is mirrored from GLM-5.2 (parity rates)", () => {
    for (const id of GLM_5_3_IDS) {
      const pricing = getPricingForModel("glm", id);
      expect(pricing, `pricing for ${id} should resolve`).toBeDefined();
      expect(pricing.input).toBe(MODEL_PRICING["glm-5.3"].input);
      expect(pricing.output).toBe(MODEL_PRICING["glm-5.3"].output);
    }
  });
});

describe("GlmExecutor effort-tier resolution (port of OmniRoute #10358)", () => {
  const credentials = { apiKey: "glm-key", runtimeTransport: { format: "openai", baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } } };

  it("glm-5.3-high → reasoning_effort=high with thinking enabled on the OpenAI coding transport", () => {
    const executor = new GlmExecutor("glm");
    const transformed = executor.transformRequest(
      "glm-5.3-high",
      { messages: [{ role: "user", content: "hi" }] },
      false,
      credentials
    );
    expect(transformed.model).toBe("glm-5.3");
    expect(transformed.reasoning_effort).toBe("high");
    expect(transformed.thinking.type).toBe("enabled");
  });

  it("glm-5.3-low → reasoning_effort=low with thinking enabled", () => {
    const executor = new GlmExecutor("glm");
    const transformed = executor.transformRequest(
      "glm-5.3-low",
      { messages: [{ role: "user", content: "hi" }] },
      false,
      credentials
    );
    expect(transformed.model).toBe("glm-5.3");
    expect(transformed.reasoning_effort).toBe("low");
    expect(transformed.thinking.type).toBe("enabled");
  });

  it("glm-5.3-low overrides an existing thinking.disabled (5.3 rejects disabled)", () => {
    const executor = new GlmExecutor("glm");
    const transformed = executor.transformRequest(
      "glm-5.3-low",
      { thinking: { type: "disabled" }, messages: [{ role: "user", content: "hi" }] },
      false,
      credentials
    );
    expect(transformed.thinking.type).toBe("enabled");
  });

  it("base glm-5.3 passes through without injected reasoning_effort (upstream default = max)", () => {
    const executor = new GlmExecutor("glm");
    const transformed = executor.transformRequest(
      "glm-5.3",
      { model: "glm-5.3", messages: [{ role: "user", content: "hi" }] },
      false,
      credentials
    );
    expect(transformed.model).toBe("glm-5.3");
    expect(transformed.reasoning_effort).toBeUndefined();
  });

  it("on the Anthropic-compatible transport the tier uses the effort selector instead", () => {
    const executor = new GlmExecutor("glm");
    const claudeCredentials = { apiKey: "glm-key", runtimeTransport: { format: "claude", baseUrl: "https://api.z.ai/api/anthropic/v1/messages" } };
    const transformed = executor.transformRequest(
      "glm-5.3-high",
      { messages: [{ role: "user", content: "hi" }] },
      false,
      claudeCredentials
    );
    expect(transformed.model).toBe("glm-5.3");
    expect(transformed.effort).toBe("high");
    expect(transformed.reasoning_effort).toBeUndefined();
    expect(transformed.thinking.type).toBe("enabled");
  });

  it("glm and glm-cn route through the GlmExecutor (not the generic DefaultExecutor)", () => {
    expect(getExecutor("glm")).toBeInstanceOf(GlmExecutor);
    expect(getExecutor("glm-cn")).toBeInstanceOf(GlmExecutor);
  });
});

describe("CodeBuddy CN catalog swap (port of OmniRoute #10356)", () => {
  it("codebuddy-cn drops dead glm-4.7 and adds hy3", () => {
    const ids = modelIds("codebuddy-cn");
    expect(ids).not.toContain("glm-4.7");
    expect(ids).toContain("hy3");
  });

  it("hy3 advertises Hunyuan specs (192k context / 64k output, reasoning + vision)", () => {
    const hy3 = registryEntry("codebuddy-cn").models.find((m) => m.id === "hy3");
    expect(hy3).toBeDefined();
  });

  it("capabilities cover codebuddy-cn hy3 with the gateway's reasoning+vision shape", () => {
    const caps = getCapabilitiesForModel("codebuddy-cn", "hy3");
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(192000);
    expect(caps.maxOutput).toBe(64000);
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("codebuddy-cn swaps deepseek-v4-flash → deepseek-v4.1-flash (product-config contract)", () => {
    const ids = modelIds("codebuddy-cn");
    expect(ids).not.toContain("deepseek-v4-flash");
    expect(ids).toContain("deepseek-v4.1-flash");
  });

  it("codebuddy-cn deepseek-v4.1-flash caps: 1M context, 128k output, low/high/xhigh", () => {
    const caps = getCapabilitiesForModel("codebuddy-cn", "deepseek-v4.1-flash");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.thinkingLevels).toEqual(["low", "high", "xhigh"]);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(128000);
  });
});
