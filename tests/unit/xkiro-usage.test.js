// xKiro Quota Tracker handler (/v1/usage) — pinned against the documented
// response shapes: fixed-point USD STRINGS (6 decimals), plan|null (null =
// pay-as-you-go with empty windows), wallet|null (null until first top-up),
// and free_tokens as an INDEPENDENT budget from paid spend.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

const { getXkiroUsage } = await import("../../open-sse/services/usage/xkiro.js");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

function jsonResponse(status, data) {
  return { ok: status < 400, status, json: async () => data };
}

function usageResponse(overrides = {}) {
  return {
    object: "usage",
    plan: "ultra",
    windows: [
      { kind: "short", window_sec: 18000, spent_usd: "0.000356", cap_usd: "200.000000", remaining_usd: "199.999644", resets_in_sec: 5005 },
      { kind: "long", window_sec: 604800, spent_usd: "12.500000", cap_usd: "1320.000000", remaining_usd: "1307.500000", resets_in_sec: 199405 },
    ],
    free_tokens: { used_today: 412030, limit_per_day: 300000000, remaining: 299587970 },
    wallet: { balance_usd: "683.950000", held_usd: "0.150000" },
    ...overrides,
  };
}

beforeEach(() => {
  proxyAwareFetch.mockReset();
});

describe("xKiro usage handler — plan account", () => {
  it("sends the chat key as Bearer to the free usage endpoint", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(200, usageResponse()));
    await getXkiroUsage({ apiKey: "sk-xt-test" });
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.xkiro.com/v1/usage");
    expect(init.headers.Authorization).toBe("Bearer sk-xt-test");
    expect(init.method).toBe("GET");
  });

  it("renders spend windows with exact decimal parsing and ISO resetAt", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(200, usageResponse()));
    const out = await getXkiroUsage({ apiKey: "sk-xt-test" });

    expect(out.plan).toBe("ultra");
    const short = out.quotas["Spend window (5h)"];
    expect(short).toMatchObject({
      used: 0.000356,          // survives the 6-decimal string parse
      total: 200,
      remaining: 199.999644,
      resetAt: expect.any(String),
    });
    expect(short.remainingPercentage).toBeCloseTo(99.999822, 4);
    expect(new Date(short.resetAt).getTime()).toBeGreaterThan(Date.now());

    expect(out.quotas["Spend window (7d)"]).toMatchObject({
      used: 12.5, total: 1320, remaining: 1307.5,
    });
    expect(new Date(out.quotas["Spend window (7d)"].resetAt).getTime())
      .toBeGreaterThan(new Date(out.quotas["Spend window (5h)"].resetAt).getTime());
  });

  it("renders the free-token allowance as an independent row resetting at UTC midnight", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(200, usageResponse()));
    const out = await getXkiroUsage({ apiKey: "sk-xt-test" });
    const row = out.quotas["Free tokens (today)"];
    expect(row).toMatchObject({
      used: 412030,
      total: 300000000,
      remaining: 299587970,
    });
    // Next 00:00 UTC
    const reset = new Date(row.resetAt);
    expect(reset.getUTCHours()).toBe(0);
    expect(reset.getUTCMinutes()).toBe(0);
    expect(reset.getUTCSeconds()).toBe(0);
  });

  it("renders the wallet as an unlimited-style row (remainingPercentage null)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(200, usageResponse()));
    const out = await getXkiroUsage({ apiKey: "sk-xt-test" });
    expect(out.quotas.Wallet).toMatchObject({
      used: 0,
      total: 683.95,
      remaining: 683.95,
      remainingPercentage: null,
      resetAt: null,
    });
  });
});

describe("xKiro usage handler — PAYG and missing sections", () => {
  it("pay-as-you-go: plan null, no window rows, wallet is the limit", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(200, usageResponse({
      plan: null,
      windows: [],
      wallet: { balance_usd: "4.812300", held_usd: "0.150000" },
      free_tokens: { used_today: 124035, limit_per_day: 5000000, remaining: 4875965 },
    })));
    const out = await getXkiroUsage({ apiKey: "sk-xt-test" });
    expect(out.plan).toBe("pay-as-you-go");
    expect(Object.keys(out.quotas)).toEqual(["Free tokens (today)", "Wallet"]);
  });

  it("omits the wallet row when no wallet exists yet (null until first top-up)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(200, usageResponse({ wallet: null, plan: null, windows: [] })));
    const out = await getXkiroUsage({ apiKey: "sk-xt-test" });
    expect(out.quotas.Wallet).toBeUndefined();
    expect(out.plan).toBe("pay-as-you-go");
  });

  it("omits the free-token row when no daily cap applies (limit null)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(200, usageResponse({ free_tokens: { used_today: 5, limit_per_day: null, remaining: null } })));
    const out = await getXkiroUsage({ apiKey: "sk-xt-test" });
    expect(out.quotas["Free tokens (today)"]).toBeUndefined();
  });

  it("derives remaining from used when the API omits it", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(200, usageResponse({
      windows: [],
      wallet: null,
      free_tokens: { used_today: 100, limit_per_day: 1000, remaining: null },
    })));
    const out = await getXkiroUsage({ apiKey: "sk-xt-test" });
    expect(out.quotas["Free tokens (today)"].remaining).toBe(900);
  });
});

describe("xKiro usage handler — failure paths", () => {
  it("401 surfaces a key-invalid message without throwing", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(401, { error: { message: "authentication_error" } }));
    const out = await getXkiroUsage({ apiKey: "sk-xt-bad" });
    expect(out.quotas).toEqual({});
    expect(out.message).toContain("401");
  });

  it("network failure degrades to a message", async () => {
    proxyAwareFetch.mockRejectedValue(new Error("ECONNRESET"));
    const out = await getXkiroUsage({ apiKey: "sk-xt-test" });
    expect(out.quotas).toEqual({});
    expect(out.message).toContain("Failed to reach xKiro usage API");
  });

  it("non-usage payloads are rejected by the object discriminator", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(200, { object: "list", data: [] }));
    const out = await getXkiroUsage({ apiKey: "sk-xt-test" });
    expect(out.message).toContain("no usage data");
  });

  it("returns null without a key", async () => {
    expect(await getXkiroUsage({})).toBeNull();
  });
});
