// Generates sea-config.json for the ExtremeRouter single executable.
//
// Assets: the entire CLI payload — cli/app (Next.js standalone + traced
// node_modules + MITM server), cli/src, cli/hooks and cli/package.json —
// keyed as "payload/<relative path>" (forward slashes, matching
// scripts/sea/payload.cjs extraction). cli.js is intentionally NOT included:
// the SEA bootstrap replaces it.
//
// Usage: node scripts/sea/generate-sea-config.cjs [--out sea-config.json]
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const cliDir = path.join(root, "cli");
const PAYLOAD_DIRS = ["app", "src", "hooks"];
const SKIP_NAMES = new Set([".DS_Store", ".env", ".env.local"]);
const SKIP_EXT = [".log", ".node"]; // native addons cannot load from inside SEA

function walk(dir, base, assets) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name) || SKIP_EXT.some((e) => entry.name.endsWith(e))) continue;
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(abs, rel, assets);
    } else if (entry.isFile()) {
      assets[`payload/${rel}`] = abs;
    }
    // Symlinks skipped: the traced standalone should not contain any.
  }
}

function main() {
  const outArg = process.argv.indexOf("--out");
  const outFile = outArg > -1 ? path.resolve(process.argv[outArg + 1]) : path.join(root, "sea-config.json");

  const assets = {};
  for (const dir of PAYLOAD_DIRS) {
    walk(path.join(cliDir, dir), dir, assets);
  }
  const pkg = path.join(cliDir, "package.json");
  if (fs.existsSync(pkg)) assets["payload/package.json"] = pkg;

  const config = {
    main: path.join(root, "scripts", "sea", "bootstrap.cjs"),
    output: path.join(root, "sea-prep.blob"),
    disableExperimentalSEAWarning: true,
    assets,
  };

  fs.writeFileSync(outFile, JSON.stringify(config));

  let total = 0;
  for (const p of Object.values(assets)) total += fs.statSync(p).size;
  console.log(`[sea] assets: ${Object.keys(assets).length} files, ${(total / 1024 / 1024).toFixed(1)} MB → ${outFile}`);
}

main();
