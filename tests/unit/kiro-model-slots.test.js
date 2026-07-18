import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

// Guards Kiro model ids that still need mappable defaultModels slots. Without
// a slot, getMappedModel (src/mitm/server.js) returns null and the request is
// passed through to AWS instead of being routed to the user's chosen provider.
describe("Kiro MITM model slots", () => {
  const kiro = MITM_TOOLS.kiro;

  it("exposes the kiro mitm tool", () => {
    expect(kiro).toBeTruthy();
    expect(kiro.configType).toBe("mitm");
    expect(Array.isArray(kiro.defaultModels)).toBe(true);
  });

  it("offers a mappable slot for Claude Sonnet 5", () => {
    const sonnet5 = kiro.defaultModels.find((m) => m.id === "claude-sonnet-5");
    expect(sonnet5).toBeTruthy();
    expect(sonnet5.alias).toBe("claude-sonnet-5");
  });

  it("offers a mappable slot for the background sub-task model id 'simple-task'", () => {
    const simpleTask = kiro.defaultModels.find((m) => m.id === "simple-task");
    expect(simpleTask).toBeTruthy();
    expect(simpleTask.alias).toBe("simple-task");
  });
});

describe("Kiro static provider models", () => {
  it("includes Claude Sonnet 5 and its synthetic Kiro variants", () => {
    const ids = (PROVIDER_MODELS.kr || []).map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      "claude-sonnet-5",
      "claude-sonnet-5-thinking",
      "claude-sonnet-5-agentic",
      "claude-sonnet-5-thinking-agentic",
    ]));
  });

  it("includes GPT-5.6 Sol/Terra/Luna base models", () => {
    const ids = (PROVIDER_MODELS.kr || []).map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]));
  });

  it("includes GPT-5.6 synthetic variants (thinking, agentic, thinking-agentic)", () => {
    const ids = (PROVIDER_MODELS.kr || []).map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      "gpt-5.6-sol-thinking",
      "gpt-5.6-sol-agentic",
      "gpt-5.6-sol-thinking-agentic",
      "gpt-5.6-terra-thinking",
      "gpt-5.6-terra-agentic",
      "gpt-5.6-terra-thinking-agentic",
      "gpt-5.6-luna-thinking",
      "gpt-5.6-luna-agentic",
      "gpt-5.6-luna-thinking-agentic",
    ]));
  });

  it("GPT-5.6 models have 272k context window", () => {
    const models = PROVIDER_MODELS.kr || [];
    const sol = models.find((m) => m.id === "gpt-5.6-sol");
    const terra = models.find((m) => m.id === "gpt-5.6-terra");
    const luna = models.find((m) => m.id === "gpt-5.6-luna");
    expect(sol?.contextLength).toBe(272000);
    expect(terra?.contextLength).toBe(272000);
    expect(luna?.contextLength).toBe(272000);
  });
});

describe("Kiro GPT-5.6 MITM slots", () => {
  const kiro = MITM_TOOLS.kiro;

  it("offers mappable slots for all GPT-5.6 models", () => {
    const sol = kiro.defaultModels.find((m) => m.id === "gpt-5.6-sol");
    const terra = kiro.defaultModels.find((m) => m.id === "gpt-5.6-terra");
    const luna = kiro.defaultModels.find((m) => m.id === "gpt-5.6-luna");
    expect(sol).toBeTruthy();
    expect(sol.alias).toBe("gpt-5.6-sol");
    expect(terra).toBeTruthy();
    expect(terra.alias).toBe("gpt-5.6-terra");
    expect(luna).toBeTruthy();
    expect(luna.alias).toBe("gpt-5.6-luna");
  });
});
