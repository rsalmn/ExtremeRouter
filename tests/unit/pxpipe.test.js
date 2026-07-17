import { describe, it, expect, vi } from "vitest";
import {
  compressWithPxpipe,
  formatPxpipeLog,
  formatPxpipeSizeLog,
  isPxpipePhantomSavings,
  isPxpipeLoaded,
  unloadPxpipeModule,
} from "../../open-sse/rtk/pxpipe.js";

describe("pxpipe — compressWithPxpipe gates", () => {
  it("returns null when disabled", async () => {
    const result = await compressWithPxpipe({ messages: [] }, { enabled: false });
    expect(result).toBeNull();
  });

  it("returns null when body has no messages", async () => {
    const result = await compressWithPxpipe({}, { enabled: true });
    expect(result).toBeNull();
  });

  it("returns null when messages is not an array", async () => {
    const result = await compressWithPxpipe({ messages: "string" }, { enabled: true });
    expect(result).toBeNull();
  });

  it("returns null when body is below minChars threshold", async () => {
    const body = { messages: [{ role: "user", content: "short" }] };
    const result = await compressWithPxpipe(body, { enabled: true, minChars: 1000 });
    expect(result).toBeNull();
  });

  it("returns null when pxpipe module is not installed (no dir)", async () => {
    const longText = "x".repeat(30000);
    const body = { messages: [{ role: "user", content: longText }] };
    const result = await compressWithPxpipe(body, { enabled: true, minChars: 25000, pxpipeDir: null });
    expect(result).toBeNull();
  });

  it("sets diagnostics reason on each skip path", async () => {
    const diag = {};
    await compressWithPxpipe({ messages: [] }, { enabled: false, diagnostics: diag });
    expect(diag.reason).toBe("disabled");

    const diag2 = {};
    await compressWithPxpipe({ messages: [{ role: "user", content: "hi" }] }, { enabled: true, minChars: 1000, diagnostics: diag2 });
    expect(diag2.reason).toMatch(/below threshold/);
  });
});

describe("pxpipe — formatPxpipeLog", () => {
  it("returns null when no stats", () => {
    expect(formatPxpipeLog(null)).toBeNull();
  });

  it("returns null when no tokens saved", () => {
    expect(formatPxpipeLog({ tokensSaved: 0 })).toBeNull();
  });

  it("formats log line with savings", () => {
    const line = formatPxpipeLog({ tokensSaved: 5000, tokensBefore: 10000, tokensAfter: 5000, imageCount: 3 });
    expect(line).toContain("5,000 tokens");
    expect(line).toContain("10,000");
    expect(line).toContain("3 images");
  });
});

describe("pxpipe — formatPxpipeSizeLog", () => {
  it("returns null when no diagnostics", () => {
    expect(formatPxpipeSizeLog(null)).toBeNull();
  });

  it("formats percentage", () => {
    const line = formatPxpipeSizeLog({ before: 10000, after: 6000 });
    expect(line).toContain("10,000");
    expect(line).toContain("6,000");
    expect(line).toContain("-40%");
  });
});

describe("pxpipe — isPxpipePhantomSavings", () => {
  it("returns false when no stats", () => {
    expect(isPxpipePhantomSavings(null, null)).toBe(false);
  });

  it("returns false when tokensSaved is 0", () => {
    expect(isPxpipePhantomSavings({ tokensSaved: 0 }, { before: 100, after: 99 })).toBe(false);
  });

  it("returns true when shrink ratio is below 5%", () => {
    expect(isPxpipePhantomSavings(
      { tokensSaved: 100 },
      { before: 10000, after: 9900 }, // 1% shrink, but claims 100 saved
    )).toBe(true);
  });

  it("returns false when shrink ratio is above 5%", () => {
    expect(isPxpipePhantomSavings(
      { tokensSaved: 5000 },
      { before: 10000, after: 4000 }, // 60% shrink
    )).toBe(false);
  });
});

describe("pxpipe — module lifecycle", () => {
  it("isPxpipeLoaded returns false when not loaded", () => {
    unloadPxpipeModule();
    expect(isPxpipeLoaded()).toBe(false);
  });
});
