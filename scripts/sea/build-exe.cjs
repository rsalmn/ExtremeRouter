// Builds single executables for ALL target platforms from ONE linux-built
// payload. The SEA blob is platform-independent (same node version), and
// postject edits PE/Mach-O/ELF binaries cross-platform — so Windows and macOS
// hosts never need to run a Next.js build (which is fragile on those runners).
//
// The macOS binary still needs `codesign` (macOS-only tool) — that final step
// runs in the sign-macos workflow job (scripts/sea/sign-macos.cjs).
//
// Prereqs (ubuntu): npm run build + node cli/scripts/build-cli.js produced
// cli/app/, then:
//   node scripts/sea/build-exe.cjs --all
// Or a single host:
//   node scripts/sea/build-exe.cjs --node-bin <node> --out <out> [--smoke]
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..", "..");
const distDir = path.join(root, "dist-sea");
const blob = path.join(root, "sea-prep.blob");
const seaConfig = path.join(root, "sea-config.json");
const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const POSTJECT = "postject@1.0.0-alpha.6";
const NODE_VERSION = process.versions.node; // blob and hosts must match exactly

// Target platforms - nodejs.org dist paths per platform.
const TARGETS = {
  "win-x64": { dist: "win-x64/node.exe", out: "ExtremeRouter-windows-x64.exe" },
  "linux-x64": { dist: "linux-x64/bin/node", out: "ExtremeRouter-linux-x64" },
  "darwin-arm64": { dist: "darwin-arm64/bin/node", out: "ExtremeRouter-macos-arm64" },
};

function httpsGet(url, redirects = 0) {
  if (redirects > 4) throw new Error(`too many redirects: ${url}`);
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "extremerouter-sea-build" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(httpsGet(res.headers.location, redirects + 1));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function run(cmd, args, opts = {}) {
  console.log(`[sea] > ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], ...opts });
}

function inject(hostBin, outPath, { chmod, smoke }) {
  fs.copyFileSync(hostBin, outPath);
  if (chmod) fs.chmodSync(outPath, 0o755);
  console.log(`[sea] injecting blob into ${path.basename(outPath)}`);
  // Node >= 20.12 refuses to spawn .cmd shims without a shell (EINVAL, CVE
  // 2024-27980) - route npx through cmd /c on Windows.
  const npxArgs = ["--yes", POSTJECT, outPath, "NODE_SEA_BLOB", blob, "--sentinel-fuse", SENTINEL];
  // Required for Mach-O targets: without NODE_SEA the kernel rejects the
  // injected binary (SIGKILL) even after a valid ad-hoc re-sign.
  if (outPath.includes("macos")) npxArgs.push("--macho-segment-name", "NODE_SEA");
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/c", "npx", ...npxArgs], { cwd: root, stdio: "inherit" });
  } else {
    execFileSync("npx", npxArgs, { cwd: root, stdio: "inherit" });
  }
  if (smoke) {
    const ver = execFileSync(outPath, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim();
    console.log(`[sea] smoke --version: ${ver}`);
    return ver;
  }
  return null;
}

async function buildAll() {
  fs.mkdirSync(distDir, { recursive: true });

  // 0-2. Payload -> blob (stitched main + asset map)
  const genMain = path.join(root, "sea-main.gen.cjs");
  const payloadSrc = fs.readFileSync(path.join(__dirname, "payload.cjs"), "utf8");
  const bootSrc = fs.readFileSync(path.join(__dirname, "bootstrap.cjs"), "utf8")
    .replace('const payload = require("./payload.cjs");', "const payload = payloadModule;")
    .replace('"use strict";', "");
  fs.writeFileSync(
    genMain,
    '"use strict";\n' +
      "const payloadModule = (function (module) {\n" +
      payloadSrc +
      "\nreturn module.exports;\n})({ exports: {} });\n" +
      "(function () {\n" + bootSrc + "\n})();\n"
  );

  run(process.execPath, [path.join(__dirname, "generate-sea-config.cjs"), "--out", seaConfig], { cwd: root });
  const cfg = JSON.parse(fs.readFileSync(seaConfig, "utf8"));
  cfg.main = genMain;
  fs.writeFileSync(seaConfig, JSON.stringify(cfg));
  run(process.execPath, ["--experimental-sea-config", seaConfig], { cwd: root });

  fs.writeFileSync(path.join(distDir, "version.txt"), NODE_VERSION + "\n");

  // 3-5. One exe per target host binary
  for (const [target, t] of Object.entries(TARGETS)) {
    const outPath = path.join(distDir, t.out);
    const hostBin = await downloadNodeDist(target);
    const smoke = (process.platform === "win32" && target === "win-x64") ||
                  (process.platform === "linux" && target === "linux-x64") ||
                  (process.platform === "darwin" && target.startsWith("darwin"));
    const ver = inject(hostBin, outPath, { chmod: true, smoke });
    const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
    console.log(`[sea] DONE ${t.out} (${mb} MB)${ver ? ` v${ver}` : " (unsigned host)"}`);
  }
  console.log(`[sea] hosts built with node v${NODE_VERSION}; macOS codesign runs in the sign job`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isGzip(buf) {
  return Buffer.isBuffer(buf) && buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

async function downloadNodeDist(target) {
  const dir = path.join(distDir, `node-${target}`);
  fs.mkdirSync(dir, { recursive: true });
  const suffix = target.startsWith("win") ? "zip" : "tar.gz";
  const archiveName = `node-v${NODE_VERSION}-${target}.${suffix}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;
  const archive = path.join(distDir, archiveName);
  // Truncated CDN connections happen - validate (gzip magic for tar.gz, size
  // sanity for zip) and re-download before giving the extractor a broken file.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[sea] downloading ${url}`);
      const buf = await httpsGet(url);
      if (suffix === "tar.gz" && !isGzip(buf)) throw new Error("downloaded archive is not gzip");
      if (buf.length < 1_000_000) throw new Error(`download suspiciously small (${buf.length} bytes)`);
      fs.writeFileSync(archive, buf);
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`[sea] download attempt ${attempt} failed (${e.message}) - retrying`);
      await sleep(2000);
    }
  }

  if (suffix === "tar.gz") {
    // Extract the full archive: single-entry extraction trips bsdtar on the
    // hardlink/symlink entries some node dist archives contain. AV scanners
    // occasionally lock freshly-written archives on Windows - retry.
    const bin = path.join(dir, `node-v${NODE_VERSION}-${target}`, "bin", "node");
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        execFileSync("tar", ["-xzf", path.basename(archive), "-C", path.basename(dir)], { cwd: distDir });
        if (fs.existsSync(bin)) {
          fs.chmodSync(bin, 0o755);
          return bin;
        }
        throw new Error("node binary missing after extraction");
      } catch (e) {
        if (attempt === 3) throw e;
        console.warn(`[sea] extraction attempt ${attempt} failed (${e.message}) - retrying`);
        await sleep(3000);
      }
    }
  }
  execFileSync("unzip", ["-o", "-j", archive, `node-v${NODE_VERSION}-${target}/node.exe`, "-d", dir]);
  return path.join(dir, "node.exe");
}

const argv = process.argv.slice(2);
if (argv.includes("--all")) {
  buildAll().catch((e) => {
    console.error(`[sea] build failed: ${e.message}`);
    process.exit(1);
  });
} else {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i > -1 ? argv[i + 1] : null;
  };
  const hostBin = get("--node-bin");
  const outPath = get("--out");
  const smoke = argv.includes("--smoke");
  if (!hostBin || !outPath) {
    console.error("usage: build-exe.cjs --all | --node-bin <bin> --out <out> [--smoke]");
    process.exit(1);
  }
  try {
    const ver = inject(hostBin, outPath, { chmod: process.platform !== "win32", smoke });
    console.log(`[sea] DONE ${path.basename(outPath)}${ver ? ` v${ver}` : ""}`);
  } catch (e) {
    console.error(`[sea] build failed: ${e.message}`);
    process.exit(1);
  }
}
