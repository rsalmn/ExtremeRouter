// SEA payload helpers — extraction, manifest gating, and runtime-dir
// resolution are exercised via the ER_SEA_PAYLOAD_DIR dev path (the same
// getAssetBuffer contract the node:sea blob satisfies in production).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const { buildManifest, extractPayload, manifestEquals, readStoredManifest } = await import(
  "../../scripts/sea/payload.cjs"
);

let sandbox;
let payloadDir;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "er-sea-test-"));
  payloadDir = path.join(sandbox, "payload-src");
  fs.mkdirSync(payloadDir, { recursive: true });
  process.env.ER_SEA_PAYLOAD_DIR = payloadDir;
});

afterEach(() => {
  delete process.env.ER_SEA_PAYLOAD_DIR;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function seedPayload(files) {
  // Disk mirror of the SEA asset keys: getAssetBuffer("payload/<rel>") reads
  // <payloadDir>/payload/<rel> — the dir is the PARENT of the "payload" root.
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(payloadDir, "payload", rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
}

// rels already start with "payload/" (the disk mirror nests under a payload
// root matching the SEA asset keys) — no extra prefixing here.
const keysFor = (dir) => Object.keys(filesOf(dir));

function filesOf(dir) {
  const out = {};
  const walk = (d, base) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (rel === "payload" && e.isDirectory()) { walk(abs, rel); return; }
      if (e.isDirectory()) walk(abs, rel);
      else out[rel] = abs;
    }
  };
  walk(dir, "");
  return out;
}

describe("sea payload helpers", () => {
  it("buildManifest hashes every entry", () => {
    const entries = new Map([
      ["payload/a.js", Buffer.from("alpha")],
      ["payload/b.js", Buffer.from("beta")],
    ]);
    const m = buildManifest(entries);
    expect(m.version).toBe(1);
    expect(m.entries["payload/a.js"]).not.toBe(m.entries["payload/b.js"]);
    expect(m.entries["payload/a.js"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extractPayload writes the payload tree and the manifest, no escaping paths", () => {
    seedPayload({ "app/custom-server.js": "require('./server.js');", "hooks/x.js": "x" });
    const dir = path.join(sandbox, "runtime");
    const entries = new Map(
      keysFor(payloadDir).map((k) => [k, fs.readFileSync(path.join(payloadDir, k))])
    );
    entries.set("payload/../escape.js", Buffer.from("evil"));
    extractPayload(entries, dir);

    expect(fs.readFileSync(path.join(dir, "app/custom-server.js"), "utf8")).toContain("server.js");
    expect(fs.readFileSync(path.join(dir, "hooks/x.js"), "utf8")).toBe("x");
    expect(fs.existsSync(path.join(dir, "escape.js"))).toBe(false);
    expect(readStoredManifest(dir)).not.toBeNull();
  });

  it("manifestEquals detects changes (upgrade → re-extract)", () => {
    const a = buildManifest(new Map([["payload/a", Buffer.from("1")]]));
    const b = buildManifest(new Map([["payload/a", Buffer.from("2")]]));
    expect(manifestEquals(a, a)).toBe(true);
    expect(manifestEquals(a, b)).toBe(false);
  });

  it("ensurePayload skips extraction when the manifest matches (fast start)", async () => {
    seedPayload({ "app/server.js": "v1" });
    const runtime = path.join(sandbox, "runtime");
    process.env.ER_SEA_RUNTIME_DIR_OVERRIDE = runtime;

    // Patch runtimeDir via APPDATA indirection used by payload.cjs
    const fakeAppData = path.join(sandbox, "appdata");
    fs.mkdirSync(fakeAppData, { recursive: true });
    const prevAppData = process.env.APPDATA;
    if (process.platform === "win32") process.env.APPDATA = fakeAppData;

    const { ensurePayload } = await import("../../scripts/sea/payload.cjs");
    const first = ensurePayload(keysFor(payloadDir));
    expect(first.state).toBe("extracted");
    const marker = fs.readFileSync(path.join(runtime, "app/server.js"), "utf8");

    // Same content → cached (marker untouched)
    const before = fs.statSync(path.join(runtime, ".sea-manifest.json")).mtimeMs;
    const second = ensurePayload(keysFor(payloadDir));
    expect(second.state).toBe("cached");
    expect(fs.readFileSync(path.join(runtime, "app/server.js"), "utf8")).toBe(marker);

    // Upgraded payload → re-extracted
    seedPayload({ "app/server.js": "v2" });
    const third = ensurePayload(keysFor(payloadDir));
    expect(third.state).toBe("extracted");
    expect(fs.readFileSync(path.join(runtime, "app/server.js"), "utf8")).toBe("v2");

    if (process.platform === "win32") process.env.APPDATA = prevAppData;
    delete process.env.ER_SEA_RUNTIME_DIR_OVERRIDE;
    fs.rmSync(runtime, { recursive: true, force: true });
  });
});
