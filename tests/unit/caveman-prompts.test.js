// Caveman prompts regression tests.
// Verifies that all 6 levels contain the 4 upstream-aligned hygiene rules,
// that the ULTRA contradiction (invented abbreviations + arrow shorthand) is gone,
// and that the prompt structure is well-formed.
import { describe, it, expect } from "vitest";
import { CAVEMAN_PROMPTS, CAVEMAN_LEVELS } from "../../open-sse/rtk/cavemanPrompts.js";

const ALL_LEVELS = Object.values(CAVEMAN_LEVELS);

describe("Caveman prompts — structure", () => {
  it("exports all 6 levels", () => {
    expect(ALL_LEVELS).toHaveLength(6);
    expect(ALL_LEVELS).toContain("lite");
    expect(ALL_LEVELS).toContain("full");
    expect(ALL_LEVELS).toContain("ultra");
    expect(ALL_LEVELS).toContain("wenyan-lite");
    expect(ALL_LEVELS).toContain("wenyan");
    expect(ALL_LEVELS).toContain("wenyan-ultra");
  });

  it("every level prompt is a non-empty string", () => {
    for (const level of ALL_LEVELS) {
      expect(typeof CAVEMAN_PROMPTS[level]).toBe("string");
      expect(CAVEMAN_PROMPTS[level].length).toBeGreaterThan(50);
    }
  });
});

describe("Caveman prompts — shared hygiene rules present in all levels", () => {
  // The 4 upstream-aligned rules must appear in every level's prompt text.
  it("all levels forbid invented abbreviations", () => {
    for (const level of ALL_LEVELS) {
      const p = CAVEMAN_PROMPTS[level].toLowerCase();
      expect(p).toContain("no invented abbreviations");
    }
  });

  it("all levels preserve user language", () => {
    for (const level of ALL_LEVELS) {
      const p = CAVEMAN_PROMPTS[level].toLowerCase();
      expect(p).toContain("match user's language");
    }
  });

  it("all levels forbid self-reference", () => {
    for (const level of ALL_LEVELS) {
      const p = CAVEMAN_PROMPTS[level].toLowerCase();
      expect(p).toContain("no self-reference");
    }
  });

  it("all levels forbid decorative emoji and tool narration", () => {
    for (const level of ALL_LEVELS) {
      const p = CAVEMAN_PROMPTS[level].toLowerCase();
      expect(p).toContain("no emoji");
      expect(p).toContain("no tool-call narration");
    }
  });
});

describe("Caveman prompts — ULTRA contradiction removed", () => {
  const ultra = CAVEMAN_PROMPTS[CAVEMAN_LEVELS.ULTRA];

  it("ULTRA no longer encourages invented abbreviations (req/res/fn/impl)", () => {
    // The old ULTRA prompt explicitly listed these as abbreviations to use.
    // They must not appear as encouraged patterns.
    expect(ultra).not.toMatch(/req\/res\/fn\/impl/i);
    expect(ultra).not.toMatch(/\babbreviate\b.*\bDB\/auth\/config/i);
  });

  it("ULTRA no longer encourages arrow shorthand for causality (X → Y)", () => {
    // The old pattern used "[thing] → [result]" — the arrow must be gone.
    expect(ultra).not.toContain("→");
    expect(ultra).not.toMatch(/use arrows/i);
  });

  it("ULTRA still achieves compression without contradicting hygiene rules", () => {
    expect(ultra.toLowerCase()).toContain("ultra-terse");
    expect(ultra.toLowerCase()).toContain("maximum compression");
    // The new ULTRA explicitly says established terms in full
    expect(ultra.toLowerCase()).toContain("established terms in full");
  });
});

describe("Caveman prompts — boundaries and persistence preserved", () => {
  it("all levels keep code/paths/commands exact", () => {
    for (const level of ALL_LEVELS) {
      expect(CAVEMAN_PROMPTS[level]).toContain("keep exact");
    }
  });

  it("all levels include persistence directive", () => {
    for (const level of ALL_LEVELS) {
      expect(CAVEMAN_PROMPTS[level]).toContain("ACTIVE EVERY RESPONSE");
    }
  });

  it("all levels include auto-clarity safety valve", () => {
    for (const level of ALL_LEVELS) {
      expect(CAVEMAN_PROMPTS[level]).toContain("Auto-Clarity");
    }
  });
});
