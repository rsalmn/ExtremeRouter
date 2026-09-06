// Builds the ExtremeRouter single executable for the CURRENT platform.
//
// Pipeline (Node 24 recommended — node:sqlite unflagged for the db driver):
//   1. node scripts/sea/generate-sea-config.cjs   (asset map → sea-config.json)
//   2. node --experimental-sea-config sea-config.json → sea-prep.blob
//   3. copy the running node binary → dist-sea/ExtremeRouter-<os>-<arch>[.exe]
//   4. [win] strip Authenticode signature (signtool), if available
//   5. npx postject injects the blob (NODE_SEA_BLOB + sentinel fuse)
//   6. [mac] ad-hoc codesign; [linux] chmod +x
//   7. smoke: run `--version` and assert the version prints
//
// Prerequisites: `npm run build` (Next standalone) + `node cli/scripts/build-cli.js`
// must have produced cli/app/ on this machine.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..", "..");
const distDir = path.join(root, "dist-sea");
const blob = path.join(root, "sea-prep.blob");
const seaConfig = path.join(root, "sea-config.json");
const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(cmd, args, opts = {}) {
  console.log(`[sea] > ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], ...opts });
}

function findSigntool() {
  if (process.platform !== "win32") return null;
  const base = "C:/Program Files (x86)/Windows Kits/10/bin";
  try {
    const versions = fs.readdirSync(base).filter((v) => /^10\./.test(v)).sort().reverse();
    for (const v of versions) {
      for (const arch of ["x64", "x86"]) {
        const p = path.join(base, v, arch, "signtool.exe");
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { /* SDK not installed */ }
  return null;
}

function main() {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const arch = os.arch(); // x64 | arm64
  const plat = process.platform; // win32 | linux | darwin
  const osName = plat === "win32" ? "windows" : plat === "darwin" ? "macos" : "linux";
  const ext = plat === "win32" ? ".exe" : "";
  const outName = `ExtremeRouter-${osName}-${arch}${ext}`;
  const outPath = path.join(distDir, outName);

  fs.mkdirSync(distDir, { recursive: true });

  // 0. Generate the SEA main: payload.cjs inlined + bootstrap (SEA embeds only
  // the main script — relative require() between our files does not resolve
  // inside the blob, so the two sources are stitched into one file).
  const genMain = path.join(root, "sea-main.gen.cjs");
  const payloadSrc = fs.readFileSync(path.join(__dirname, "payload.cjs"), "utf8");
  const bootSrc = fs.readFileSync(path.join(__dirname, "bootstrap.cjs"), "utf8")
    .replace('const payload = require("./payload.cjs");', 'const payload = payloadModule;')
    .replace('"use strict";', "");
  const stitched = (
    '"use strict";\n' +
    "const payloadModule = (function (module) {\n" +
    payloadSrc +
    "\nreturn module.exports;\n})({ exports: {} });\n" +
    "(function () {\n" + bootSrc + "\n})();\n"
  );
  fs.writeFileSync(genMain, stitched);

  // 1-2. Config + blob (main points at the stitched file)
  run(process.execPath, [path.join(__dirname, "generate-sea-config.cjs"), "--out", seaConfig], { cwd: root });
  const cfg = JSON.parse(fs.readFileSync(seaConfig, "utf8"));
  cfg.main = genMain;
  fs.writeFileSync(seaConfig, JSON.stringify(cfg));
  run(process.execPath, ["--experimental-sea-config", seaConfig], { cwd: root });
  if (!fs.existsSync(blob)) throw new Error("sea-prep.blob was not produced");

  // 3. Copy the running node binary as the host executable
  fs.copyFileSync(process.execPath, outPath);
  if (plat !== "win32") fs.chmodSync(outPath, 0o755);
  console.log(`[sea] host binary: ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);

  // 4. Windows: strip the Authenticode signature — postject cannot inject
  // into a signed section without invalidating it.
  if (plat === "win32") {
    const signtool = findSigntool();
    if (signtool) {
      try {
        run(signtool, ["remove", "/s", outPath]);
        console.log("[sea] signature removed");
      } catch (e) {
        console.warn(`[sea] signtool remove failed (continuing): ${e.message}`);
      }
    } else {
      console.warn("[sea] signtool not found — attempting injection on a signed binary");
    }
  }

  // 5. Inject the blob
  // Node >= 20.12 refuses to spawn .cmd shims without a shell (EINVAL, CVE
  // 2024-27980) — route npx through cmd /c with argv-array quoting intact.
  if (plat === "win32") {
    run("cmd.exe", ["/c", "npx", "--yes", "postject@1.0.0-alpha.6",
      outPath,
      "NODE_SEA_BLOB", blob,
      "--sentinel-fuse", SENTINEL,
    ], { cwd: root });
  } else {
    run("npx", [
      "--yes", "postject@1.0.0-alpha.6",
      outPath,
      "NODE_SEA_BLOB", blob,
      "--sentinel-fuse", SENTINEL,
    ], { cwd: root });
  }

  // 6. Platform finalization
  if (plat === "darwin") {
    run("codesign", ["--sign", "-", "--force", outPath]);
  } else if (plat !== "win32") {
    fs.chmodSync(outPath, 0o755);
  }

  // 7. Smoke: --version must print from the embedded payload
  const ver = execFileSync(outPath, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim();
  console.log(`[sea] smoke --version: ${ver}`);
  if (!ver.includes(version)) throw new Error(`smoke --version mismatch: expected ${version}, got "${ver}"`);

  console.log(`[sea] DONE ${outName} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB) v${version}`);
}

try {
  main();
} catch (e) {
  console.error(`[sea] build failed: ${e.message}`);
  process.exit(1);
}
