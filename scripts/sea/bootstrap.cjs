// ExtremeRouter SEA bootstrap — the embedded main script of the single
// executable. Quad-mode, resolved from argv (the SEA binary ignores nothing:
// it always runs this script, argv[1..] carry the caller's arguments):
//
//   ExtremeRouter.exe --version          → print version, exit
//   ExtremeRouter.exe --serve            → run the extracted standalone server
//                                          in-process (NODE_ENV=production)
//   ExtremeRouter.exe <path/to/file.js>  → runner mode: require() that file
//                                          in-process with argv normalized —
//                                          makes the exe behave like `node`
//                                          for child-process spawns (MITM
//                                          server, updater) that use
//                                          process.execPath + a script path
//   ExtremeRouter.exe                    → first run: extract the payload to
//                                          ~/.extremerouter/sea-runtime, spawn
//                                          a detached `--serve` child, open
//                                          the dashboard, exit (server keeps
//                                          running; stop via dashboard or by
//                                          killing the process)
//
// The db layer resolves SQLite on its own: inside SEA there is no
// better-sqlite3, so src/lib/db/driver.js falls through to the built-in
// node:sqlite adapter (Node ≥ 22.5; the release binaries are built with
// Node 24 where node:sqlite needs no experimental flag).
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const payload = require("./payload.cjs");

// SEA embedder require() resolves ONLY builtin modules — disk files (the
// extracted payload) must be loaded through a require anchored to disk.
// createRequire comes from the real `module` builtin, which is resolvable.
const { createRequire } = require("module");

function diskRequire(anchorPath, request) {
  return createRequire(anchorPath)(request);
}

const DEFAULT_PORT = "20128";

function argv() {
  // process.argv = [execPath, embeddedMainWasArgv1?, ...userArgs]. Under SEA
  // argv[1] is empty — user args start at index 2 in some node versions and
  // 1 in others; normalize by dropping anything before the first real arg.
  const raw = process.argv.slice(2);
  return raw.filter((a, i) => !(i === 0 && a === "--"));
}

function isJsFile(p) {
  return (
    typeof p === "string" &&
    /\.([cm]?js)$/.test(p) &&
    !p.startsWith("--") &&
    fs.existsSync(p)
  );
}

function openDashboard(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch { /* best-effort */ }
}

function serveMode() {
  // Auto-extract on first run / after an upgrade (manifest-gated, so this is
  // a no-op when the payload is already current).
  const { state } = payload.ensurePayload(payload.assetKeys());
  console.log(`[sea] payload ${state}`);
  const dir = payload.runtimeDir();
  const appDir = path.join(dir, "app");
  const serverEntry = path.join(appDir, "custom-server.js");
  const fallbackEntry = path.join(appDir, "server.js");
  if (!fs.existsSync(serverEntry) && !fs.existsSync(fallbackEntry)) {
    console.error("[sea] payload extraction produced no server entry");
    process.exit(1);
  }
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  process.env.PORT = process.env.PORT || DEFAULT_PORT;
  // The bg-refresh module imports "@/lib/..." jsconfig aliases that only the
  // Next-bundled graph can resolve — outside it (npm CLI included) the dynamic
  // import fails. Request-path token refresh is unaffected. Opt-out honored.
  if (!process.env.DISABLE_BACKGROUND_TOKEN_REFRESH) {
    process.env.DISABLE_BACKGROUND_TOKEN_REFRESH = "1";
    console.log("[sea] background token refresh disabled (request-path refresh unaffected)");
  }
  process.chdir(appDir);
  const entry = fs.existsSync(serverEntry) ? serverEntry : fallbackEntry;
  // Mirror a plain `node server.js` argv for anything reading it.
  process.argv = [process.execPath, entry, ...argv()];
  // Anchored at app/package.json so the whole disk-based module graph
  // (standalone server.js + traced node_modules) resolves normally.
  diskRequire(path.join(appDir, "package.json"), entry);
}

function runnerMode(scriptPath) {
  const abs = path.resolve(scriptPath);
  // Normalize argv so the script sees [node, script, ...args].
  process.argv = [process.execPath, abs, ...argv().slice(1)];
  diskRequire(abs, abs);
}

function versionMode() {
  let version = "unknown";
  try {
    version = JSON.parse(payload.getAssetBuffer("payload/package.json").toString("utf8")).version;
  } catch { /* fall through */ }
  console.log(`ExtremeRouter ${version} (sea ${process.platform}-${process.arch}, node ${process.versions.node})`);
}

function defaultMode() {
  const { dir, state } = payload.ensurePayload(payload.assetKeys());
  const port = process.env.PORT || DEFAULT_PORT;
  const url = `http://localhost:${port}`;
  console.log(`[sea] payload ${state} at ${dir}`);
  console.log(`[sea] starting server on ${url} (stop: close this window or kill the process)`);

  const child = spawn(process.execPath, ["--serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, PORT: port },
  });
  child.unref();

  // Give the server a beat, then open the dashboard.
  setTimeout(() => openDashboard(url), 1500);
  console.log(`[sea] detached server pid=${child.pid} — this launcher can be closed`);
}

function main() {
  const args = argv();
  if (args.includes("--version")) return versionMode();
  if (args.includes("--serve")) return serveMode();
  if (args.includes("--extract")) {
    const { dir, state } = payload.ensurePayload(payload.assetKeys());
    return console.log(`[sea] payload ${state} at ${dir}`);
  }
  // Runner mode must win over default for any existing .js path — child
  // processes spawned with process.execPath + a script (MITM, updater) rely
  // on the exe behaving like node.
  if (args[0] && isJsFile(args[0])) return runnerMode(args[0]);
  return defaultMode();
}

main();
