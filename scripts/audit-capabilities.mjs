#!/usr/bin/env node
/**
 * Capability drift audit — READ-ONLY diagnostic tooling.
 *
 * Hand-written capability tables (PROVIDER_CAPABILITIES / MODEL_CAPABILITIES
 * in open-sse/providers/capabilities.js) are INTENTIONALLY authoritative:
 * they exist precisely because outside sources (models.dev, gateway metadata)
 * get things wrong, and the runtime never lets those sources override an
 * explicit entry. The cost of that design is that a hand-written entry can
 * silently drift from reality (real incident: bynara "glm-5.3-flash-free"
 * pinned 128000 context while live was 1000000 → tokenBudget starved →
 * max_tokens:0 → months of production failures with zero warnings).
 *
 * This tool surfaces drift for HUMAN REVIEW. It never writes to source files.
 *
 * Modes:
 *   --offline (default)  Compare hand-written entries against the models.dev
 *                        catalog (the runtime's normalized DATA_DIR snapshot
 *                        if present, else https://models.dev/api.json with a
 *                        24h TTL cache). models.dev is the WEAKER source of
 *                        truth → findings are tagged LOW_CONFIDENCE_SOURCE
 *                        and never trip --strict. A provider not listed on
 *                        models.dev at all (e.g. bynara) is normal → INFO.
 *   --live               Fetch each provider's own /v1/models (registry
 *                        entries declaring modelsFetcher.url) with an optional
 *                        key from env AUDIT_CAPS_<PROVIDER_ID>_KEY. Providers
 *                        without a configured key are SKIPPED, never failed.
 *                        Live findings carry real severity:
 *                          MISMATCH        numeric (>10% tolerance, same rule
 *                                          as the runtime sync) or boolean
 *                                          vision/reasoning differs
 *                          STALE_KEY       hand-written id absent from the
 *                                          live list (retired/renamed)
 *                          MISSING_ENTRY   live model with a concrete
 *                                          context_window whose runtime
 *                                          resolution lands on the DEFAULT
 *                                          floor (known:false) — capability
 *                                          data we could have but silently
 *                                          do not. Other unlisted passthrough
 *                                          models are aggregated as INFO.
 * Options:
 *   --provider=<id>  restrict to one provider
 *   --json           machine-readable report (CI artifact)
 *   --strict         exit 1 on any live-mode MISMATCH
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const MODE = argv.includes("--live") ? "live" : "offline";
const asOpt = (flag) => {
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1) || null;
  const i = argv.indexOf(flag);
  return i > -1 ? argv[i + 1] : null;
};
const providerFilter = asOpt("--provider");
const JSON_OUT = argv.includes("--json");
const STRICT = argv.includes("--strict");

const LIMIT_TOLERANCE = 0.1; // runtime MODEL_CATALOG_CONFIG.limitTolerance
const FETCH_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = path.join(ROOT, ".cache", "models.dev-audit.json");

// ─── tables + registry (pure relative-import modules; plain-node safe) ────

const { PROVIDER_CAPABILITIES, MODEL_CAPABILITIES, getCapabilitiesForModel } =
  await import(pathToFileURL(path.join(ROOT, "open-sse/providers/capabilities.js")).href);
const REGISTRY = (await import(pathToFileURL(path.join(ROOT, "open-sse/providers/registry/index.js")).href)).default;

/** File:line index of hand-written entries (reviewer convenience). */
function buildLineIndex() {
  const src = fs.readFileSync(path.join(ROOT, "open-sse/providers/capabilities.js"), "utf8").split("\n");
  const lines = new Map(); // "pid|modelId" -> line ; "|modelId" -> line (MODEL_CAPABILITIES)
  const sectionOf = (re) => src.findIndex((l) => re.test(l));
  const endOf = (start) => { for (let i = start + 1; i < src.length; i++) if (/^\}/.test(src[i])) return i; return src.length; };

  const pStart = sectionOf(/^export const PROVIDER_CAPABILITIES = \{/);
  if (pStart > -1) {
    let current = null;
    for (let i = pStart + 1; i < endOf(pStart); i++) {
      const prov = src[i].match(/^  ([A-Za-z0-9_-]+): \{/);
      if (prov) { current = prov[1]; continue; }
      if (current) {
        const key = src[i].match(/^ {4}"([^"]+)":/);
        if (key) lines.set(`${current}|${key[1]}`, i + 1);
        if (/^  \}/.test(src[i])) current = null;
      }
    }
  }
  const mStart = sectionOf(/^export const MODEL_CAPABILITIES = \{/);
  if (mStart > -1) {
    for (let i = mStart + 1; i < endOf(mStart); i++) {
      const key = src[i].match(/^ {2}"?([^":]+)"?: \{/);
      if (key) lines.set(`|${key[1]}`, i + 1);
    }
  }
  return lines;
}

// ─── shared comparison ─────────────────────────────────────────────────────

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

function numMismatch(tableVal, srcVal) {
  const a = num(tableVal), b = num(srcVal);
  if (a == null || b == null || a === b) return null;
  const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
  return rel > LIMIT_TOLERANCE ? { static: a, liveValue: b } : null;
}

function whereFor(providerId, modelId, lines) {
  const loc = lines.get(`${providerId ?? ""}|${modelId}`) || lines.get(`|${modelId}`);
  const table = providerId ? `PROVIDER_CAPABILITIES.${providerId}["${modelId}"]` : `MODEL_CAPABILITIES["${modelId}"]`;
  return `${table}${loc ? ` @ capabilities.js:${loc}` : ""}`;
}

/**
 * Diff one hand-written entry against an external record
 * ({contextWindow,maxOutput,vision,reasoning} — undefined fields ignored).
 */
function diffEntry(providerId, modelId, caps, source, lines) {
  const out = [];
  const cm = numMismatch(caps.contextWindow, source.contextWindow);
  if (cm) out.push({ kind: "MISMATCH", field: "contextWindow", ...cm, where: whereFor(providerId, modelId, lines) });
  const mm = numMismatch(caps.maxOutput, source.maxOutput);
  if (mm) out.push({ kind: "MISMATCH", field: "maxOutput", ...mm, where: whereFor(providerId, modelId, lines) });
  if (typeof source.vision === "boolean" && caps.vision !== source.vision) {
    out.push({ kind: "MISMATCH", field: "vision", static: caps.vision, liveValue: source.vision, where: whereFor(providerId, modelId, lines) });
  }
  if (typeof source.reasoning === "boolean" && caps.reasoning !== source.reasoning) {
    out.push({ kind: "MISMATCH", field: "reasoning", static: caps.reasoning, liveValue: source.reasoning, where: whereFor(providerId, modelId, lines) });
  }
  return out;
}

// ─── offline: models.dev (LOW_CONFIDENCE_SOURCE) ───────────────────────────

function dataDir() {
  return process.env.EXTREMEROUTER_DATA_DIR
    || path.join(
      process.platform === "win32" ? process.env.LOCALAPPDATA || os.homedir() : path.join(os.homedir(), ".local", "share"),
      "extremerouter",
    );
}

/** Load models.dev as {providers: {pid: {mid: {contextWindow,maxOutput,vision,reasoning}}}}. */
async function loadModelsDev() {
  const snapFile = path.join(dataDir(), "model-catalog.json");
  try {
    const raw = JSON.parse(fs.readFileSync(snapFile, "utf8"));
    if (raw?.providers) {
      const out = {};
      for (const [pid, models] of Object.entries(raw.providers)) {
        out[pid] = {};
        for (const [mid, lim] of Object.entries(models)) out[pid][mid] = { contextWindow: lim.contextWindow, maxOutput: lim.maxOutput };
      }
      return { providers: out, meta: `runtime snapshot (${raw.meta?.syncedAt ? new Date(raw.meta.syncedAt).toISOString() : "age?"})` };
    }
  } catch { /* no snapshot — fall through to raw */ }

  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) cached = null;
  } catch { /* miss */ }
  let raw = cached?.data;
  if (!raw) {
    process.stderr.write("[audit] fetching https://models.dev/api.json …\n");
    const res = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`models.dev fetch failed: HTTP ${res.status}`);
    raw = await res.json();
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), data: raw }));
  }
  const out = {};
  for (const [pid, pdef] of Object.entries(raw)) {
    const models = pdef?.models;
    if (!models || typeof models !== "object") continue;
    out[pid] = {};
    for (const [mid, mdef] of Object.entries(models)) {
      const rec = {};
      const ctx = mdef?.limit?.context ?? mdef?.context;
      const mo = mdef?.limit?.output ?? mdef?.maxTokens;
      if (typeof ctx === "number") rec.contextWindow = ctx;
      if (typeof mo === "number") rec.maxOutput = mo;
      const ins = mdef?.modalities?.input;
      if (Array.isArray(ins)) rec.vision = ins.includes("image");
      if (mdef?.reasoning != null) rec.reasoning = mdef.reasoning === true || typeof mdef.reasoning === "object";
      out[pid][mid] = rec;
    }
  }
  return { providers: out, meta: "models.dev api.json (raw)" };
}

function offlineFindings(catalog, lines) {
  const groups = new Map();
  const entries = [];
  for (const [pid, block] of Object.entries(PROVIDER_CAPABILITIES)) {
    for (const mid of Object.keys(block)) entries.push({ provider: pid, model: mid, caps: getCapabilitiesForModel(pid, mid) });
  }
  for (const mid of Object.keys(MODEL_CAPABILITIES)) entries.push({ provider: null, model: mid, caps: getCapabilitiesForModel(null, mid) });

  for (const e of entries) {
    let rec = null, sourcePid = null;
    if (e.provider) {
      // Provider-scoped entries compare ONLY against models.dev's record for
      // THE SAME provider id. Cross-provider matching is meaningless here —
      // resellers disagree wildly (that variance is exactly why the hand-
      // written block exists), and gateways like bynara simply aren't listed
      // on models.dev; absence is a normal outcome, not drift.
      const cat = catalog.providers[e.provider];
      if (cat) {
        rec = cat[e.model] || null;
        if (!rec && e.model.includes("/")) rec = cat[e.model.split("/").pop()] || null;
        sourcePid = e.provider;
      }
    } else {
      // MODEL_CAPABILITIES is the canonical provider-AGNOSTIC table, so a
      // record from any provider carrying this exact id is a valid (still
      // low-confidence) cross-check.
      const base = e.model.includes("/") ? e.model.split("/").pop() : null;
      for (const [cpid, catModels] of Object.entries(catalog.providers)) {
        if (catModels[e.model]) { rec = catModels[e.model]; sourcePid = cpid; break; }
        if (base && catModels[base]) { rec = catModels[base]; sourcePid = cpid; break; }
      }
    }
    if (!rec) continue; // not covered by models.dev — normal, not an error
    const diffs = diffEntry(e.provider, e.model, e.caps, rec, lines);
    for (const d of diffs) {
      const pid = e.provider || "MODEL_CAPABILITIES";
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid).push({ ...d, tag: "LOW_CONFIDENCE_SOURCE", sourceName: `models.dev:${sourcePid}` });
    }
  }
  return groups;
}

// ─── live: gateway /v1/models ──────────────────────────────────────────────

function envKeyFor(providerId) {
  return process.env[`AUDIT_CAPS_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_KEY`] || null;
}

async function fetchLiveList(fetcher, key) {
  const url = fetcher?.url;
  if (!url || !/^https:\/\//i.test(url)) return { skip: "no-https-url" };
  const headers = { accept: "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  let res;
  try {
    res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    return { skip: `network: ${e.message}` };
  }
  if ([301, 302, 303, 307, 308].includes(res.status)) return { skip: "redirect refused" };
  if (res.status === 401 || res.status === 403) return { skip: "auth-required" };
  if (!res.ok) return { skip: `http-${res.status}` };
  const payload = await res.json().catch(() => null);
  if (!payload) return { skip: "non-json" };
  // An unauthenticated gateway may answer 200 with an error-shaped body
  // ({error:{...}} instead of {data:[]}); a parser crash on that is a SKIP,
  // never a fatal audit error.
  try {
    const { FILTERS } = await import(pathToFileURL(path.join(ROOT, "src/app/api/providers/suggested-models/filters.js")).href);
    const fn = FILTERS[fetcher.type];
    const models = typeof fn === "function"
      ? fn(payload)
      : (Array.isArray(payload.data) ? payload.data : []).map((m) => ({
          id: m.id,
          contextLength: m.context_window ?? m.context_length ?? m.limit?.context,
          vision: Boolean(m.vision),
          reasoning: Boolean(m.reasoning),
        }));
    return { models: Array.isArray(models) ? models : [] };
  } catch (e) {
    return { skip: `unparseable payload (${key ? "with key" : "no key"}): ${e.message}` };
  }
}

function liveFindingsFor(providerId, models, lines) {
  const live = new Map((models || []).filter((m) => m?.id).map((m) => [m.id, m]));
  const findings = [];
  const statics = Object.keys(PROVIDER_CAPABILITIES[providerId] || {});
  let unlistedInfo = 0;

  for (const mid of statics) {
    const rec = live.get(mid);
    if (!rec) {
      findings.push({ kind: "STALE_KEY", where: whereFor(providerId, mid, lines) });
      continue;
    }
    findings.push(...diffEntry(providerId, mid, getCapabilitiesForModel(providerId, mid), {
      contextWindow: num(rec.contextLength),
      maxOutput: num(rec.maxOutputLength),
      vision: typeof rec.vision === "boolean" ? rec.vision : undefined,
      reasoning: typeof rec.reasoning === "boolean" ? rec.reasoning : undefined,
    }, lines));
  }
  for (const [mid, rec] of live) {
    if (statics.includes(mid)) continue;
    const concrete = num(rec.contextLength);
    if (concrete != null && getCapabilitiesForModel(providerId, mid).known === false) {
      findings.push({ kind: "MISSING_ENTRY", where: `${providerId}/${mid}`, liveValue: concrete });
    } else {
      unlistedInfo++;
    }
  }
  return { findings, unlistedInfo, liveCount: live.size };
}

async function runLive(lines) {
  const groups = new Map();
  const skips = [];
  const infos = [];
  const targets = (providerFilter
    ? [REGISTRY.find((p) => p.id === providerFilter)].filter(Boolean)
    : REGISTRY.filter((p) => p.modelsFetcher?.url)
  );
  for (const p of targets) {
    const key = envKeyFor(p.id);
    let out = await fetchLiveList(p.modelsFetcher, key);
    if (out.skip === "auth-required" && !key) {
      skips.push({ id: p.id, reason: `no key — set AUDIT_CAPS_${p.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_KEY` });
      continue;
    }
    if (out.skip) { skips.push({ id: p.id, reason: out.skip }); continue; }
    const r = liveFindingsFor(p.id, out.models, lines);
    if (r.findings.length) groups.set(p.id, r.findings);
    infos.push({ id: p.id, live: r.liveCount, unlistedPassthrough: r.unlistedInfo });
  }
  return { groups, skips, infos };
}

// ─── output ────────────────────────────────────────────────────────────────

function render(groups, extras) {
  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ mode: MODE, provider: providerFilter || null, generatedAt: new Date().toISOString(), ...extras, groups: Object.fromEntries(groups) }, null, 2) + "\n");
    return;
  }
  process.stdout.write(`\nCapability drift audit — mode: ${MODE}${providerFilter ? ` (provider: ${providerFilter})` : ""}\n`);
  process.stdout.write("Hand-written entries are AUTHORITATIVE by design; findings are advisory, never auto-applied.\n");
  if (extras.catalog) process.stdout.write(`Source: ${extras.catalog}\n`);
  if (extras.unlistedOnModelsDev?.length) process.stdout.write(`Providers hand-written but NOT on models.dev (${extras.unlistedOnModelsDev.length}, normal — gateway/proprietary lanes; use --live for these): ${extras.unlistedOnModelsDev.join(", ")}\n`);
  process.stdout.write("\n");
  const sev = { MISMATCH: 0, STALE_KEY: 1, MISSING_ENTRY: 2 };
  const counts = { MISMATCH: 0, STALE_KEY: 0, MISSING_ENTRY: 0, LOW_CONFIDENCE_SOURCE: 0 };
  const pids = [...groups.keys()].sort();
  if (!pids.length) process.stdout.write("No findings.\n");
  for (const pid of pids) {
    const fl = [...groups.get(pid)].sort((a, b) => (sev[a.kind] ?? 9) - (sev[b.kind] ?? 9) || a.where.localeCompare(b.where));
    process.stdout.write(`── ${pid} (${fl.length})\n`);
    for (const f of fl) {
      const low = f.tag === "LOW_CONFIDENCE_SOURCE";
      counts[low ? "LOW_CONFIDENCE_SOURCE" : f.kind]++;
      let detail;
      if (f.kind === "MISMATCH") {
        detail = low
          ? `[LOW_CONFIDENCE_SOURCE] ${f.where} ${f.field}: table=${JSON.stringify(f.static)} vs ${f.sourceName}=${JSON.stringify(f.liveValue)}`
          : `${f.where} ${f.field}: table=${JSON.stringify(f.static)} live=${JSON.stringify(f.liveValue)}`;
      } else if (f.kind === "STALE_KEY") {
        detail = `${f.where} — id absent from live /v1/models (retired/renamed?)`;
      } else {
        detail = `${f.where} — live context ${f.liveValue}, runtime resolves to DEFAULT floor`;
      }
      process.stdout.write(`   ${low ? "·" : "!"} ${detail}\n`);
    }
    process.stdout.write("\n");
  }
  process.stdout.write(`Summary: MISMATCH=${counts.MISMATCH} STALE_KEY=${counts.STALE_KEY} MISSING_ENTRY=${counts.MISSING_ENTRY} LOW_CONFIDENCE_SOURCE=${counts.LOW_CONFIDENCE_SOURCE}\n`);
  if (extras.skips?.length) process.stdout.write(`Skipped: ${extras.skips.map((s) => `${s.id} (${s.reason})`).join("; ")}\n`);
}

const lines = buildLineIndex();
let groups, extras = {};
if (MODE === "offline") {
  const catalog = await loadModelsDev();
  groups = offlineFindings(catalog, lines);
  if (providerFilter) groups = new Map([...groups].filter(([pid]) => pid === providerFilter));
  if (providerFilter && PROVIDER_CAPABILITIES[providerFilter] && !catalog.providers[providerFilter]) {
    process.stderr.write(`INFO: ${providerFilter} is not listed on models.dev (normal for gateway providers).\n`);
  }

  extras = { catalog: catalog.meta, modelsDevProviders: Object.keys(catalog.providers).length };
  extras.unlistedOnModelsDev = Object.keys(PROVIDER_CAPABILITIES).filter((pid) => !catalog.providers[pid]);
} else {
  const r = await runLive(lines);
  groups = r.groups;
  extras = { skips: r.skips, live: r.infos };
}
render(groups, extras);

const mismatchCount = [...groups.values()].flat().filter((f) => f.kind === "MISMATCH" && f.tag !== "LOW_CONFIDENCE_SOURCE").length;
process.exit(STRICT && MODE === "live" && mismatchCount > 0 ? 1 : 0);
