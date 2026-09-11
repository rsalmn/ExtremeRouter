/**
 * Bynara OAuth gating — API-key-only free provider must never open OAuth.
 *
 * Regression for: provider page treated category:"free" as OAuth, fired
 * GET /api/oauth/bynara/authorize, and the OAuth route threw
 * "Unknown provider: bynara" (Bynara is not in the OAuth PROVIDERS map).
 */
import { describe, it, expect } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { FREE_PROVIDERS, OAUTH_PROVIDERS } from "@/shared/constants/providers";

describe("bynara is API-key only (no OAuth modal)", () => {
  it("registry declares hasOAuth:false and authModes apikey", () => {
    const bynara = REGISTRY.find((p) => p.id === "bynara");
    expect(bynara).toBeDefined();
    expect(bynara.hasOAuth).toBe(false);
    expect(bynara.authModes).toEqual(["apikey"]);
    expect(bynara.authType).toBe("apikey");
  });

  it("FREE_PROVIDERS entry preserves hasOAuth:false (buildProviderEntry)", () => {
    expect(FREE_PROVIDERS.bynara?.hasOAuth).toBe(false);
    expect(FREE_PROVIDERS.bynara?.authModes).toEqual(["apikey"]);
  });

  it("is not in the OAuth PROVIDERS map (would 500 the OAuth route)", () => {
    expect(OAUTH_PROVIDERS.bynara).toBeUndefined();
  });

  it("the provider-page isOAuth gate yields false for bynara", () => {
    // Mirrors src/app/(dashboard)/dashboard/providers/[id]/page.js:155
    const providerInfo = FREE_PROVIDERS.bynara;
    const authModes = providerInfo?.authModes || [];
    const isOAuth =
      (!!OAUTH_PROVIDERS.bynara || !!FREE_PROVIDERS.bynara || authModes.includes("oauth")) &&
      providerInfo?.hasOAuth !== false;
    expect(isOAuth).toBe(false);
  });
});

describe("NaraRouter removed", () => {
  it("nara is no longer in the registry", () => {
    expect(REGISTRY.find((p) => p.id === "nara")).toBeUndefined();
  });
});
