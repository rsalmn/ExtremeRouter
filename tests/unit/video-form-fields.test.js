/**
 * Text-to-Video playground form fields (resolution / aspect ratio / duration).
 */
import { describe, it, expect } from "vitest";
import { KIND_EXAMPLE_CONFIG } from "@/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/exampleShared";

const video = KIND_EXAMPLE_CONFIG.video;

describe("video KIND_EXAMPLE_CONFIG", () => {
  it("defines Duration (s), Aspect Ratio, Ratio, and Resolution fields", () => {
    const keys = (video.extraFields || []).map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["duration", "aspect_ratio", "ratio", "resolution"]));
  });

  it("duration is a number field labeled in seconds", () => {
    const d = video.extraFields.find((f) => f.key === "duration");
    expect(d.type).toBe("number");
    expect(d.label).toMatch(/Duration \(s\)/);
    expect(d.min).toBe(1);
  });

  it("aspect_ratio / ratio / resolution are selects that allow custom values", () => {
    for (const key of ["aspect_ratio", "ratio", "resolution"]) {
      const f = video.extraFields.find((x) => x.key === key);
      expect(f.type).toBe("select");
      expect(f.allowCustom).toBe(true);
      // Empty default → omitted from the request body (provider default).
      expect(f.options).toContain("");
      expect(f.options.length).toBeGreaterThan(1);
    }
  });

  it("resolution presets include common tiers", () => {
    const r = video.extraFields.find((f) => f.key === "resolution");
    expect(r.options).toEqual(expect.arrayContaining(["480p", "720p", "1080p"]));
  });

  it("aspect_ratio presets include widescreen and portrait", () => {
    const a = video.extraFields.find((f) => f.key === "aspect_ratio");
    expect(a.options).toEqual(expect.arrayContaining(["16:9", "9:16", "1:1"]));
  });
});
