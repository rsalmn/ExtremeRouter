// xKiro API-key provider — catalog, capabilities, and pricing generated from
// the LIVE /v1/models snapshot (2026-09-06, 112 chat models). These tests pin
// the generation contract:
//   - every model id is vendor-prefixed (bare names 404 upstream)
//   - models WITH reasoning_efforts → reasoning:true + capability-driven levels
//   - models WITHOUT → reasoning:false (xKiro ignores reasoning params entirely)
//   - pricing resolves per-model from the live rates (reasoning mirrors output)
import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const CATALOG = PROVIDER_MODELS.xkiro || [];

describe("xkiro catalog", () => {
  it("registers the live 2026-09-06 snapshot (112 chat models)", () => {
    expect(CATALOG.length).toBe(112);
  });

  it("vendor-prefixes every model id (bare names 404 upstream)", () => {
    for (const m of CATALOG) {
      expect(m.id.includes("/"), `${m.id} must be vendor/model`).toBe(true);
    }
  });

  it("includes the documented flagship ids and the combo-workload ids", () => {
    const ids = CATALOG.map((m) => m.id);
    for (const id of ["openai/gpt-5.6-sol", "anthropic/claude-opus-5", "z-ai/glm-5.3", "deepseek/deepseek-v4-flash", "qwen/qwen3.8-max:free", "google/gemini-3.6-flash"]) {
      expect(ids, `${id} missing`).toContain(id);
    }
  });
});

describe("xkiro capabilities (measured reasoning shapes)", () => {
  it("gpt-5.6-sol: full graded scale low→max with vision", () => {
    const caps = getCapabilitiesForModel("xkiro", "openai/gpt-5.6-sol");
    expect(caps).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(getThinkingLevels("xkiro", "openai/gpt-5.6-sol")).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("glm-5.3: non-adjacent low/high/max steps (gaps are upstream-verified)", () => {
    expect(getCapabilitiesForModel("xkiro", "z-ai/glm-5.3").thinkingLevels).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("xkiro", "z-ai/glm-5.3")).toEqual(["low", "high", "max"]);
  });

  it("glm-5.2: widest scale with an explicit off position", () => {
    const caps = getCapabilitiesForModel("xkiro", "z-ai/glm-5.2");
    expect(caps.thinkingCanDisable).toBe(true);
    expect(caps.thinkingLevels).toContain("none");
  });

  it("gemini-3.6-flash: minimal is the off position (no none level)", () => {
    const caps = getCapabilitiesForModel("xkiro", "google/gemini-3.6-flash");
    expect(caps.thinkingLevels).toEqual(["minimal", "low", "medium", "high"]);
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("two-position switch models remap to our enum (off/on → none/low)", () => {
    // xKiro exposes nemotron/GLM-4.5 as a literal off|on switch. none = off;
    // any positive level turns the switch on, so [none, low] is faithful:
    // medium/high clamp to low (on at default strength), never a fake dial.
    const caps = getCapabilitiesForModel("xkiro", "nvidia/nemotron-3-ultra");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingCanDisable).toBe(true);
    expect(caps.thinkingLevels).toEqual(["none", "low"]);
  });

  it("adaptive/disabled models remap to none/medium (model decides when on)", () => {
    const caps = getCapabilitiesForModel("xkiro", "minimax/minimax-m3:free");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingCanDisable).toBe(true);
    expect(caps.thinkingLevels).toEqual(["none", "medium"]);
  });

  it("models without reasoning_efforts ignore reasoning params → reasoning:false", () => {
    // qwen3.8-max:free carries no reasoning_efforts object in the live catalog;
    // the picker must be hidden instead of advertising controls that do nothing.
    expect(getCapabilitiesForModel("xkiro", "qwen/qwen3.8-max:free").reasoning).toBe(false);
    expect(getThinkingLevels("xkiro", "qwen/qwen3.8-max:free")).toBeNull();
  });

  it("every catalog model resolves an explicit capability entry (no default-floor drift)", () => {
    for (const m of CATALOG) {
      const caps = getCapabilitiesForModel("xkiro", m.id);
      expect(caps.sourceType, `${m.id} fell through to ${caps.sourceType}`).toBe("provider-model");
    }
  });
});

describe("xkiro pricing (live per-1M rates)", () => {
  it("resolves documented rates for flagships", () => {
    expect(getPricingForModel("xkiro", "openai/gpt-5.6-sol")).toMatchObject({ input: 4.5, output: 27 });
    expect(getPricingForModel("xkiro", "anthropic/claude-opus-5").output).toBeGreaterThan(0);
  });

  it("free-tier models price at zero, never fall back to canonical rates", () => {
    // deepseek/deepseek-v4-flash is free-tier on xKiro; the canonical flat
    // table prices it 0.14/0.28 — the provider block must win.
    expect(getPricingForModel("xkiro", "deepseek/deepseek-v4-flash")).toMatchObject({ input: 0, output: 0 });
  });

  it("covers every catalog model (consistency-gate invariant)", () => {
    for (const m of CATALOG) {
      expect(getPricingForModel("xkiro", m.id), `${m.id} has no pricing`).not.toBeNull();
    }
  });
});

describe("xkiro executor + reasoning wire path", () => {
  it("routes through DefaultExecutor to the chat endpoint with Bearer auth", async () => {
    const executor = getExecutor("xkiro");
    expect(executor).toBeInstanceOf(DefaultExecutor);
    expect(executor.buildUrl("openai/gpt-5.6-sol")).toBe("https://api.xkiro.com/v1/chat/completions");
    const headers = executor.buildHeaders({ apiKey: "sk-xt-test" }, true);
    expect(headers.Authorization).toBe("Bearer sk-xt-test");
  });

  it("emits reasoning_effort (never reasoning objects) on the openai wire", () => {
    const body = applyThinking(
      "openai",
      "openai/gpt-5.6-sol",
      { reasoning_effort: "ultra" },
      "xkiro",
    );
    // ultra is above the advertised scale → clamped to the ceiling, enum-valid.
    expect(body.reasoning_effort).toBe("max");
    expect(body.reasoning).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("clamps a below-lowest none-intent to the cheapest step on graded sets", () => {
    // kimi-k3 has no none/minimal: thinkingCanDisable:false clamps none → low.
    const body = applyThinking("openai", "moonshotai/kimi-k3", { reasoning_effort: "none" }, "xkiro");
    expect(body.reasoning_effort).toBe("low");
  });
});
