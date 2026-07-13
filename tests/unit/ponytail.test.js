import { describe, it, expect, vi } from "vitest";

// Mock the systemInject dependency to observe what string gets passed.
vi.mock("../../open-sse/rtk/systemInject.js", () => ({
  injectSystemPrompt: vi.fn(),
}));

import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";
import { PONYTAIL_PROMPTS, PONYTAIL_LEVELS } from "../../open-sse/rtk/ponytailPrompt.js";

describe("Ponytail prompts — structure", () => {
  it("exports all 3 levels", () => {
    expect(Object.keys(PONYTAIL_LEVELS)).toHaveLength(3);
    expect(PONYTAIL_LEVELS.LITE).toBe("lite");
    expect(PONYTAIL_LEVELS.FULL).toBe("full");
    expect(PONYTAIL_LEVELS.ULTRA).toBe("ultra");
  });

  it("every level prompt is a non-empty string", () => {
    for (const level of Object.values(PONYTAIL_LEVELS)) {
      expect(typeof PONYTAIL_PROMPTS[level]).toBe("string");
      expect(PONYTAIL_PROMPTS[level].length).toBeGreaterThan(50);
    }
  });
});

describe("Ponytail prompts — shared content present in all levels", () => {
  it("all levels contain lazy senior dev persona", () => {
    for (const level of Object.values(PONYTAIL_LEVELS)) {
      expect(PONYTAIL_PROMPTS[level]).toContain("lazy senior developer");
    }
  });

  it("all levels contain the YAGNI ladder", () => {
    for (const level of Object.values(PONYTAIL_LEVELS)) {
      expect(PONYTAIL_PROMPTS[level]).toContain("YAGNI");
      expect(PONYTAIL_PROMPTS[level]).toContain("Stdlib");
    }
  });

  it("all levels forbid unrequested abstractions", () => {
    for (const level of Object.values(PONYTAIL_LEVELS)) {
      expect(PONYTAIL_PROMPTS[level]).toContain("No unrequested abstractions");
    }
  });

  it("all levels preserve security and validation", () => {
    for (const level of Object.values(PONYTAIL_LEVELS)) {
      expect(PONYTAIL_PROMPTS[level]).toContain("input validation");
      expect(PONYTAIL_PROMPTS[level]).toContain("security");
      expect(PONYTAIL_PROMPTS[level]).toContain("accessibility");
    }
  });

  it("all levels include output format pattern", () => {
    for (const level of Object.values(PONYTAIL_LEVELS)) {
      expect(PONYTAIL_PROMPTS[level]).toContain("[code]");
      expect(PONYTAIL_PROMPTS[level]).toContain("skipped");
    }
  });

  it("all levels include persistence directive", () => {
    for (const level of Object.values(PONYTAIL_LEVELS)) {
      expect(PONYTAIL_PROMPTS[level]).toContain("ACTIVE EVERY RESPONSE");
    }
  });
});

describe("Ponytail prompts — level differentiation", () => {
  it("LITE mentions naming the lazier alternative", () => {
    expect(PONYTAIL_PROMPTS.lite).toContain("name the lazier alternative");
  });

  it("FULL enforces the ladder", () => {
    expect(PONYTAIL_PROMPTS.full).toContain("ladder enforced");
  });

  it("ULTRA is YAGNI extremist with deletion first", () => {
    expect(PONYTAIL_PROMPTS.ultra).toContain("YAGNI extremist");
    expect(PONYTAIL_PROMPTS.ultra).toContain("Deletion before addition");
  });
});

describe("injectPonytail — wiring", () => {
  it("calls injectSystemPrompt with the correct prompt for each level", () => {
    const body = { messages: [] };
    for (const level of Object.values(PONYTAIL_LEVELS)) {
      injectSystemPrompt.mockClear();
      injectPonytail(body, "openai", level);
      expect(injectSystemPrompt).toHaveBeenCalledTimes(1);
      expect(injectSystemPrompt).toHaveBeenCalledWith(body, "openai", PONYTAIL_PROMPTS[level]);
    }
  });
});
