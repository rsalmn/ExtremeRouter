// Regression suite: combo-member refs must resolve to canonical provider +
// capabilities server-side regardless of shape (bare id, alias prefix,
// nested-id dynamic models). Root cause of missing capability badges /
// provider icons on /dashboard/combos?tab=combos: the UI keyed its lookup by
// the EXACT stored member string against /api/models fullModel keys
// ("alias/model" of the STATIC registry only), so bare names, lane-aliased
// refs and dynamic-provider models (bynara/tokenharbor) all missed.
import { describe, it, expect } from "vitest";
import { resolveModelRef, resolveModelRefCaps } from "open-sse/providers/refsResolve.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

describe("resolveModelRef — the 9 reported combo member strings", () => {
  it("bare ids resolve via the capability table to their dynamic provider (bynara)", () => {
    // Not in the static registry at all (bynara is dynamic) — found via
    // PROVIDER_CAPABILITIES.bynara keys.
    expect(resolveModelRef("glm-5.3-flash-free")).toEqual({ provider: "bynara", model: "glm-5.3-flash-free" });
    expect(resolveModelRef("qwen3.8-flash-free")).toEqual({ provider: "bynara", model: "qwen3.8-flash-free" });
  });

  it("bare id present in the static registry resolves to its provider (oc lane)", () => {
    expect(resolveModelRef("muse-spark-1.3-contributor-free").provider).toBeTruthy();
    expect(["opencode", "opencode-go"].includes(resolveModelRef("muse-spark-1.3-contributor-free").provider)).toBe(true);
  });

  it("alias-prefixed refs canonicalize the provider (cbai, cl, th, xkiro)", () => {
    expect(resolveModelRef("cbai/hy3")).toEqual({ provider: "codebuddy-intl", model: "hy3" });
    expect(resolveModelRef("cl/z-ai/glm-5.3-flash")).toEqual({ provider: "cline", model: "z-ai/glm-5.3-flash" });
    expect(resolveModelRef("th/deepseek-v4-flash:free")).toEqual({ provider: "tokenharbor", model: "deepseek-v4-flash:free" });
    expect(resolveModelRef("th/mimo-v2.5:free")).toEqual({ provider: "tokenharbor", model: "mimo-v2.5:free" });
  });

  it("nested model ids keep the remainder after the first slash intact", () => {
    expect(resolveModelRef("xkiro/deepseek/deepseek-v4-pro")).toEqual({
      provider: "xkiro",
      model: "deepseek/deepseek-v4-pro",
    });
    expect(resolveModelRef("xkiro/deepseek/deepseek-v4-flash")).toEqual({
      provider: "xkiro",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("canonical prefixes pass through unchanged", () => {
    expect(resolveModelRef("bynara/glm-5.3-flash-free")).toEqual({ provider: "bynara", model: "glm-5.3-flash-free" });
    expect(resolveModelRef("openai/gpt-5.2")).toEqual({ provider: "openai", model: "gpt-5.2" });
  });
});

describe("resolveModelRefCaps — capabilities equal the runtime resolution", () => {
  it("returns provider-aware caps identical to getCapabilitiesForModel", () => {
    for (const ref of [
      "glm-5.3-flash-free",
      "cbai/hy3",
      "th/deepseek-v4-flash:free",
      "xkiro/deepseek/deepseek-v4-pro",
      "oc/muse-spark-1.3-contributor-free",
    ]) {
      const r = resolveModelRefCaps(ref);
      expect(r, ref).toBeTruthy();
      expect(r.caps, ref).toEqual(getCapabilitiesForModel(r.provider, r.model));
    }
  });

  it("the bynara 1M-context drift case resolves with the CORRECTED window (guard)", () => {
    // If this regresses to the old 128000 mirror, the combos UI would again
    // advertise a context window that starves tokenBudget → max_tokens:0.
    const r = resolveModelRefCaps("glm-5.3-flash-free");
    expect(r.provider).toBe("bynara");
    expect(r.caps.contextWindow).toBe(1000000);
  });

  it("unknown refs still resolve (generic tiers) instead of returning nothing", () => {
    const r = resolveModelRefCaps("totally-unknown-vendor-model-xyz");
    expect(r).toBeTruthy();
    expect(r.provider).toBe(null);
    expect(r.model).toBe("totally-unknown-vendor-model-xyz");
    expect(r.caps).toBeTruthy();
  });

  it("junk input is rejected without throwing", () => {
    expect(resolveModelRef("")).toBe(null);
    expect(resolveModelRef("   ")).toBe(null);
    expect(resolveModelRef(null)).toBe(null);
    expect(resolveModelRef(123)).toBe(null);
    // Leading slash = no usable prefix; kept as the (invalid) bare name and
    // resolved generically instead of hard-rejecting.
    expect(resolveModelRef("/leading-slash")).toEqual({ provider: null, model: "/leading-slash" });
  });
});
