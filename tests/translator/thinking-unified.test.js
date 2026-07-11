// Unit tests for unified thinking normalization (thinkingUnified.js).
// Covers extract, suffix parse, and per-provider apply per MATRIX (.docs/thinking/plan.md).
import { describe, it, expect } from "vitest";
import {
  parseSuffix,
  extractThinking,
  applyThinking,
} from "../../open-sse/translator/concerns/thinkingUnified.js";
import { extractReasoningText } from "../../open-sse/translator/concerns/reasoning.js";

const apply = (targetFormat, model, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyThinking(targetFormat, model, b, provider);
  return b;
};

describe("parseSuffix", () => {
  it("parses level suffix", () => {
    expect(parseSuffix("gpt-5(high)")).toEqual({ cleanModel: "gpt-5", override: { mode: "level", level: "high" } });
  });
  it("parses numeric budget suffix", () => {
    expect(parseSuffix("model(8192)")).toEqual({ cleanModel: "model", override: { mode: "budget", budget: 8192 } });
  });
  it("parses auto / none", () => {
    expect(parseSuffix("m(auto)").override).toEqual({ mode: "auto" });
    expect(parseSuffix("m(none)").override).toEqual({ mode: "none" });
  });
  it("no suffix → passthrough", () => {
    expect(parseSuffix("claude-opus-4.7")).toEqual({ cleanModel: "claude-opus-4.7", override: null });
  });
});

describe("extractThinking", () => {
  it("claude enabled+budget", () => {
    expect(extractThinking({ thinking: { type: "enabled", budget_tokens: 4096 } })).toEqual({ mode: "budget", budget: 4096 });
  });
  it("claude disabled", () => {
    expect(extractThinking({ thinking: { type: "disabled" } })).toEqual({ mode: "none" });
  });
  it("openai reasoning_effort", () => {
    expect(extractThinking({ reasoning_effort: "high" })).toEqual({ mode: "level", level: "high" });
  });
  it("responses reasoning.effort none", () => {
    expect(extractThinking({ reasoning: { effort: "none" } })).toEqual({ mode: "none" });
  });
  it("gemini thinkingBudget 0 → none", () => {
    expect(extractThinking({ thinkingConfig: { thinkingBudget: 0 } })).toEqual({ mode: "none" });
  });
  it("qwen enable_thinking false", () => {
    expect(extractThinking({ enable_thinking: false })).toEqual({ mode: "none" });
  });
  it("no intent → null", () => {
    expect(extractThinking({ messages: [] })).toBeNull();
  });
});

describe("applyThinking per provider format", () => {
  it("claude 4.6+ → adaptive output_config (no budget_tokens)", () => {
    const out = apply("claude", "claude-opus-4.7", { reasoning_effort: "high" }, "claude");
    expect(out.output_config).toEqual({ effort: "high" });
    expect(out.thinking).toBeUndefined();
  });
  it("claude haiku → enabled+budget", () => {
    const out = apply("claude", "claude-haiku-4.5", { reasoning_effort: "high" }, "claude");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 24576 });
  });
  it("gemini-3 → thinkingLevel", () => {
    const out = apply("gemini", "gemini-3-pro", { reasoning_effort: "medium" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBe("medium");
  });
  it("gemini-3 clamps unsupported max/xhigh thinking levels to high", () => {
    const outMax = apply("gemini", "gemini-3-pro", { reasoning_effort: "max" }, "gemini");
    const outXhigh = apply("gemini", "gemini-3-pro", { reasoning_effort: "xhigh" }, "gemini");
    expect(outMax.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
    expect(outXhigh.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });
  it("gemini-3 maps auto thinking level to high instead of sending unsupported auto", () => {
    const out = apply("gemini", "gemini-3-pro", { reasoning_effort: "auto" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });
  it("gemini-2.5 → thinkingBudget", () => {
    const out = apply("gemini", "gemini-2.5-flash", { reasoning_effort: "high" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(24576);
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBeUndefined();
  });
  it("GLM off → enable_thinking:false (not thinking.disabled)", () => {
    const out = apply("openai", "glm-4.6", { reasoning_effort: "none" }, "glm");
    expect(out.enable_thinking).toBe(false);
    expect(out.thinking).toBeUndefined();
  });
  it("Qwen on → enable_thinking + thinking_budget", () => {
    const out = apply("openai", "qwen3-max", { reasoning_effort: "medium" }, "qwen");
    expect(out.enable_thinking).toBe(true);
    expect(out.thinking_budget).toBe(8192);
  });
  it("QwQ cannot disable → clamp minimal", () => {
    const out = apply("openai", "qwq-32b", { reasoning_effort: "none" }, "qwen");
    expect(out.enable_thinking).toBe(true);
  });
  it("DeepSeek → enabled + reasoning_effort high (low→high)", () => {
    const out = apply("openai", "deepseek-v4-pro", { reasoning_effort: "low" }, "deepseek");
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("high");
  });
  it("Kimi on → reasoning_effort", () => {
    const out = apply("openai", "kimi-k2.6", { reasoning_effort: "high" }, "kimi");
    expect(out.reasoning_effort).toBe("high");
  });
  it("Kimi minimal → low (enum normalization)", () => {
    const out = apply("openai", "kimi-k2.6", { reasoning_effort: "minimal" }, "kimi");
    expect(out.reasoning_effort).toBe("low");
  });
  it("Kimi xhigh → high (enum normalization)", () => {
    const out = apply("openai", "kimi-k2.6", { reasoning_effort: "xhigh" }, "kimi");
    expect(out.reasoning_effort).toBe("high");
  });
  it("Kimi max → high (enum normalization)", () => {
    const out = apply("openai", "kimi-k2.6", { reasoning_effort: "max" }, "kimi");
    expect(out.reasoning_effort).toBe("high");
  });
  it("Kimi auto → omits reasoning_effort (let backend default)", () => {
    const out = apply("openai", "kimi-k2.6", { reasoning_effort: "auto" }, "kimi");
    expect(out.reasoning_effort).toBeUndefined();
  });
  it("Kimi low → low (pass-through, no over-normalization)", () => {
    const out = apply("openai", "kimi-k2.6", { reasoning_effort: "low" }, "kimi");
    expect(out.reasoning_effort).toBe("low");
  });
  it("Kimi medium → medium (pass-through)", () => {
    const out = apply("openai", "kimi-k2.6", { reasoning_effort: "medium" }, "kimi");
    expect(out.reasoning_effort).toBe("medium");
  });
  it("Kimi suffix (minimal) → reasoning_effort low", () => {
    const out = apply("openai", "kimi-k2.6(minimal)", {}, "kimi");
    expect(out.reasoning_effort).toBe("low");
  });
  it("Kimi suffix (xhigh) → reasoning_effort high", () => {
    const out = apply("openai", "kimi-k2.6(xhigh)", {}, "kimi");
    expect(out.reasoning_effort).toBe("high");
  });
  it("MiniMax M3 → adaptive", () => {
    const out = apply("claude", "MiniMax-M3", { reasoning_effort: "high" }, "minimax");
    expect(out.thinking).toEqual({ type: "adaptive" });
  });
  it("non-reasoning model → strips thinking", () => {
    const out = apply("openai", "gpt-4o", { reasoning_effort: "high" }, "openai");
    expect(out.reasoning_effort).toBeUndefined();
  });
  it("aggregator (siliconflow) GLM model → forced openai reasoning_effort", () => {
    const out = apply("openai", "zai-org/GLM-5", { reasoning_effort: "high" }, "siliconflow");
    expect(out.reasoning_effort).toBe("high");
    expect(out.enable_thinking).toBeUndefined();
  });
  it("suffix overrides body", () => {
    const out = apply("openai", "gpt-5(low)", { reasoning_effort: "high" }, "openai");
    expect(out.reasoning_effort).toBe("low");
  });
  it("openai keeps xhigh for reasoning models", () => {
    const out = apply("openai", "gpt-5.3-codex", { reasoning_effort: "xhigh" }, "codex");
    expect(out.reasoning_effort).toBe("xhigh");
  });
});

describe("extractReasoningText (response shapes)", () => {
  it("reasoning_content (GLM/Qwen/DeepSeek)", () => {
    expect(extractReasoningText({ reasoning_content: "abc" })).toBe("abc");
  });
  it("reasoning fallback", () => {
    expect(extractReasoningText({ reasoning: "xyz" })).toBe("xyz");
  });
  it("reasoning_details[] (MiniMax split)", () => {
    expect(extractReasoningText({ reasoning_details: [{ text: "a" }, { content: "b" }, "c"] })).toBe("abc");
  });
  it("no reasoning → empty", () => {
    expect(extractReasoningText({ content: "hello" })).toBe("");
  });
});

// Regression: suffix (level) must never leak into the upstream body.model field.
// This mirrors the chatCore.js integration chain:
//   parseSuffix(model) → cleanModel → getModelUpstreamId(alias, cleanModel) → upstreamModel
//   translatedBody.model = upstreamModel  (must NOT contain "(level)")
//
// If this test fails, a refactor removed the parseSuffix strip in chatCore.js
// and providers will reject requests with "model not found" because the
// parenthesized suffix is not a valid model id upstream.
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

describe("suffix never leaks to upstream model field (chatCore integration)", () => {
  // [alias, modelWithSuffix, expectedUpstreamModel]
  const cases = [
    ["ds", "deepseek-chat(high)", "deepseek-chat"],
    ["ds", "deepseek-chat(none)", "deepseek-chat"],
    ["ds", "deepseek-chat(auto)", "deepseek-chat"],
    ["ds", "deepseek-chat(8192)", "deepseek-chat"],
    ["ds", "deepseek-chat", "deepseek-chat"],
    ["cx", "gpt-5.3-codex(max)", "gpt-5.3-codex"],
    ["cx", "gpt-5.3-codex", "gpt-5.3-codex"],
    ["deepseek", "deepseek-reasoner(low)", "deepseek-reasoner"],
    ["deepseek", "deepseek-reasoner", "deepseek-reasoner"],
  ];

  for (const [alias, modelWithSuffix, expectedUpstream] of cases) {
    it(`strips suffix: ${alias}/${modelWithSuffix} → ${expectedUpstream}`, () => {
      // Step 1: parseSuffix (chatCore.js:59)
      const { cleanModel, override } = parseSuffix(modelWithSuffix);
      // Step 2: getModelUpstreamId with cleanModel (chatCore.js:60)
      const upstreamModel = getModelUpstreamId(alias, cleanModel);

      // The upstream model must be the clean name, never containing parentheses.
      expect(upstreamModel).toBe(expectedUpstream);
      expect(upstreamModel).not.toMatch(/[()]/);

      // The override must still be parsed correctly (for applyThinking to use).
      if (modelWithSuffix.includes("(")) {
        expect(override).not.toBeNull();
      }
    });
  }

  it("override is applied to body via applyThinking even after cleanModel is used upstream", () => {
    // Simulate: upstream body.model = "deepseek-reasoner" (clean),
    // but applyThinking receives the original model with suffix.
    const body = { messages: [{ role: "user", content: "hi" }] };
    const modelWithSuffix = "deepseek-reasoner(high)";

    // Step 1: strip suffix for upstream
    const { cleanModel } = parseSuffix(modelWithSuffix);
    const upstream = getModelUpstreamId("deepseek", cleanModel);
    expect(upstream).toBe("deepseek-reasoner");
    expect(upstream).not.toContain("(");

    // Step 2: applyThinking still gets the suffix-bearing model and applies override
    body.model = upstream;
    applyThinking("deepseek", modelWithSuffix, body, "deepseek");

    // Override should be reflected in the body, but model stays clean.
    expect(body.reasoning_effort).toBe("high");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.model).toBe("deepseek-reasoner");
  });
});
