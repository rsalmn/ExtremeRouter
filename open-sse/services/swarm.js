/**
 * Hierarchical Swarm Engine — flagship multi-agent orchestration strategy.
 *
 * Pipeline:
 *   Stage 0  Gatekeeper (Manager)     classify: simple → direct answer, complex → swarm
 *   Stage 1  Manager Analyze          decompose prompt → JSON execution strategy
 *   Stage 2  Staff Dispatch           assign subtasks → fan-out parallel workers
 *   Stage 3  Workers Execute          each worker runs its subtask (parallel, quorum)
 *   Stage 4  Staff Audit              compile worker outputs → technical audit report
 *   Stage 5  Manager Synthesis        produce final answer from audit (streamed to client)
 *
 * Persona-bleed protection: coordinators (Manager/Staff) get IDE system prompts
 * stripped; workers receive full unsanitized context so they write contextual code.
 *
 * Mirrors handleFusionChat's shape: takes `handleSingleModel` closure, reuses
 * flattenToolHistory / extractPanelText / appendUserTurn / collectPanel / withTimeout.
 */
import {
  flattenToolHistory,
  extractPanelText,
  appendUserTurn,
  collectPanel,
  withTimeout,
} from "./combo.js";
import { stripIdeSystemPrompt, buildWorkerDirective } from "./swarmPersona.js";
import {
  createSwarmRun,
  markStageStart,
  markStageDone,
  markWorkerStatus,
  markRunError,
  markRunComplete,
} from "./swarmTelemetry.js";

// Tuning defaults. Overridable per-combo via settings.comboStrategies[name].swarmTuning.
export const SWARM_DEFAULTS = {
  workerHardTimeoutMs: 90000,  // absolute cap per worker call
  workerQuorum: 2,             // min workers that must succeed before grace window
  stragglerGraceMs: 10000,     // wait this long for laggard workers once quorum hit
  managerTimeoutMs: 60000,     // cap for each coordinator (gatekeeper/manager/audit) call
  minWorkers: 2,               // if fewer workers succeed, fall back to direct
  maxWorkers: 8,               // safety cap on fan-out width
};

// ── Role prompts ──────────────────────────────────────────────────────────

const GATEKEEPER_PROMPT = [
  "=== SWARM GATEKEEPER ===",
  "You are the GATEKEEPER of a hierarchical swarm. Classify the user's most recent request as SIMPLE or COMPLEX.",
  "",
  "SIMPLE = greeting, small talk, a factual question, a one-line clarification, or anything answerable in under ~50 tokens without decomposition.",
  "COMPLEX = a coding task, multi-step build request, design problem, debugging session, or anything benefiting from decomposition into parallel specialist work.",
  "",
  "Respond with EXACTLY one line, nothing else:",
  "VERDICT: SIMPLE",
  "or",
  "VERDICT: COMPLEX",
].join("\n");

function buildManagerStrategyPrompt(userPrompt) {
  return [
    "=== SWARM MANAGER (STRATEGY) ===",
    "You are the MANAGER of a hierarchical swarm. Analyze the user's request and produce a high-level execution strategy that decomposes it into independent parallel subtasks.",
    "",
    "Respond with ONLY a JSON object (no markdown fences, no prose) of this exact shape:",
    `{`,
    `  "assessment": "<1-2 sentence summary of what the request needs>",`,
    `  "subtasks": [`,
    `    { "id": 1, "title": "<short title>", "role": "<architecture|game-logic|data-layer|ui|testing|security|devops|default>", "instruction": "<detailed instruction for the specialist worker>" }`,
    `  ]`,
    `}`,
    "",
    "Rules:",
    "- Aim for 2-5 subtasks. Each must be independently executable in parallel.",
    "- `role` must be one of the listed values; pick the best specialist fit.",
    "- `instruction` must be self-contained — a worker sees only its own subtask.",
    "- Do NOT include integration/assembly as a subtask; the Staff auditor + Manager synthesis handle that.",
    "",
    "=== USER REQUEST ===",
    userPrompt,
  ].join("\n");
}

function buildStaffAuditPrompt(subtasks, workerOutputs) {
  const report = subtasks
    .map((st, i) => {
      const out = workerOutputs[i] || "(worker did not produce output)";
      return `### Subtask ${st.id}: ${st.title}\nRole: ${st.role}\nInstruction: ${st.instruction}\n\n#### Worker Output\n${out}`;
    })
    .join("\n\n---\n\n");

  return [
    "=== SWARM STAFF (AUDIT) ===",
    "You are the STAFF auditor of a hierarchical swarm. Specialist workers have independently completed their assigned subtasks. Your job is to produce a TECHNICAL AUDIT REPORT that the Manager will use to synthesize the final answer.",
    "",
    "For each worker output, evaluate:",
    "- Completeness: did it fulfill the subtask instruction?",
    "- Correctness: any bugs, type errors, logic flaws, or missing edge cases?",
    "- Consistency: naming conflicts, duplicated logic, or mismatched interfaces with other workers?",
    "- Integration risks: what will need reconciliation when combining outputs?",
    "",
    "Then provide a CONSOLIDATION PLAN: the order in which outputs should be merged, what conflicts to resolve, and what gaps remain.",
    "",
    "=== SUBTASKS & WORKER OUTPUTS ===",
    report,
    "=== END ===",
    "",
    "Now write the technical audit report. Be concrete and specific. Reference subtask IDs.",
  ].join("\n");
}

function buildManagerSynthesisPrompt(auditReport, userPrompt) {
  return [
    "=== SWARM MANAGER (SYNTHESIS) ===",
    "You are the MANAGER producing the FINAL ANSWER. A Staff auditor has reviewed the parallel worker outputs and produced a technical audit report below. Synthesize ONE cohesive, complete, production-quality answer for the user's original request.",
    "",
    "Rules:",
    "- Resolve any conflicts the auditor flagged.",
    "- Integrate all worker outputs into a single coherent result (codebase, explanation, or both).",
    "- Do NOT mention the swarm, workers, audit, or that multiple agents were used. The user sees only your final answer.",
    "- Match the user's language and intent exactly.",
    "",
    "=== TECHNICAL AUDIT REPORT ===",
    auditReport,
    "=== END AUDIT ===",
    "",
    "=== ORIGINAL USER REQUEST ===",
    userPrompt,
    "",
    "Now produce the final answer.",
  ].join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────

function extractUserPrompt(body) {
  // Get the last user message text across formats.
  for (const key of ["messages", "input"]) {
    if (Array.isArray(body[key])) {
      for (let i = body[key].length - 1; i >= 0; i--) {
        const m = body[key][i];
        if (m?.role === "user") {
          if (typeof m.content === "string") return m.content;
          if (Array.isArray(m.content)) {
            return m.content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
          }
        }
      }
    }
  }
  if (Array.isArray(body.contents)) {
    const last = body.contents[body.contents.length - 1];
    if (last?.role === "user" && Array.isArray(last.parts)) {
      return last.parts.map((p) => p?.text || "").join("");
    }
  }
  return "";
}

function parseStrategy(text) {
  if (!text) return null;
  // Strip markdown fences if present.
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  // Find the outermost JSON object.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (Array.isArray(obj.subtasks) && obj.subtasks.length > 0) return obj;
  } catch {
    // fall through
  }
  return null;
}

// Build a non-streaming, tool-stripped body for coordinator/worker calls.
function buildPanelBody(body) {
  const { tools, tool_choice, ...rest } = body;
  const panelBody = { ...rest, stream: false };
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages);
  }
  return panelBody;
}

// ── Stage runners ─────────────────────────────────────────────────────────

async function runGatekeeper({ runId, body, managerModel, handleSingleModel, cfg, log }) {
  markStageStart(runId, "gatekeeper", { model: managerModel });
  const prompt = extractUserPrompt(body);
  const gateBody = stripIdeSystemPrompt(buildPanelBody(body));
  const directiveBody = appendUserTurn(gateBody, GATEKEEPER_PROMPT);

  try {
    const res = await withTimeout(handleSingleModel(directiveBody, managerModel, true), cfg.managerTimeoutMs);
    if (res?.__timeout || res?.__error) {
      markStageDone(runId, "gatekeeper", { verdict: "complex" }); // assume complex on failure
      return "complex";
    }
    const text = extractPanelText(await res.clone().json().catch(() => ({})));
    const verdict = /VERDICT:\s*SIMPLE/i.test(text) ? "simple" : "complex";
    markStageDone(runId, "gatekeeper", { verdict });
    log?.info?.("SWARM", `Gatekeeper verdict: ${verdict}`);
    return verdict;
  } catch (e) {
    log?.warn?.("SWARM", `Gatekeeper error, assuming complex: ${e?.message || e}`);
    markStageDone(runId, "gatekeeper", { verdict: "complex" });
    return "complex";
  }
}

async function runManagerStrategy({ runId, body, managerModel, handleSingleModel, cfg, log }) {
  markStageStart(runId, "manager", { model: managerModel });
  const userPrompt = extractUserPrompt(body);
  const mgrBody = stripIdeSystemPrompt(buildPanelBody(body));
  const directiveBody = appendUserTurn(mgrBody, buildManagerStrategyPrompt(userPrompt));

  try {
    const res = await withTimeout(handleSingleModel(directiveBody, managerModel, true), cfg.managerTimeoutMs);
    if (res?.__timeout || res?.__error) {
      markStageDone(runId, "manager", { strategy: null });
      return null;
    }
    const text = extractPanelText(await res.clone().json().catch(() => ({})));
    const strategy = parseStrategy(text);
    markStageDone(runId, "manager", { strategy: strategy ? { subtaskCount: strategy.subtasks.length } : null });
    if (!strategy) log?.warn?.("SWARM", "Manager produced unparseable strategy");
    return strategy;
  } catch (e) {
    log?.warn?.("SWARM", `Manager strategy error: ${e?.message || e}`);
    markStageDone(runId, "manager", { strategy: null });
    return null;
  }
}

async function dispatchWorkers({ runId, strategy, models, handleSingleModel, cfg, log }) {
  markStageStart(runId, "workers", { workerCount: strategy.subtasks.length });
  const subtasks = strategy.subtasks;
  const workerModels = models.filter(Boolean);
  if (workerModels.length === 0) {
    markStageDone(runId, "workers", { workers: [] });
    return [];
  }

  // Assign each subtask to a worker model (round-robin across available combo models).
  const calls = subtasks.map((subtask, i) => {
    const workerModel = workerModels[i % workerModels.length];
    // Workers get FULL unsanitized context (no IDE strip) + specialist directive as user turn.
    const workerBody = appendUserTurn(buildPanelBody(body_global), buildWorkerDirective(subtask));
    markWorkerStatus(runId, i, "running", { model: workerModel });
    return withTimeout(handleSingleModel(workerBody, workerModel, true), cfg.workerHardTimeoutMs)
      .then(async (res) => {
        if (res?.__timeout || res?.__error) {
          markWorkerStatus(runId, i, "error", { model: workerModel });
          return { ok: false, text: "" };
        }
        const text = extractPanelText(await res.clone().json().catch(() => ({})));
        markWorkerStatus(runId, i, "done", { model: workerModel, outputLen: text.length });
        return { ok: true, text, subtask };
      })
      .catch(() => {
        markWorkerStatus(runId, i, "error", { model: workerModel });
        return { ok: false, text: "" };
      });
  });

  const settled = await collectPanel(calls, {
    minPanel: Math.min(cfg.workerQuorum, calls.length),
    stragglerGraceMs: cfg.stragglerGraceMs,
    panelHardTimeoutMs: cfg.workerHardTimeoutMs,
  });

  const outputs = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r && r.ok) outputs.push({ subtask: subtasks[i], text: r.text });
  }
  markStageDone(runId, "workers", { workers: settled.map((r, i) => ({ index: i, ok: !!r?.ok })) });
  return outputs;
}

async function runStaffAudit({ runId, strategy, workerOutputs, staffModel, auditModel, handleSingleModel, cfg, log }) {
  const model = staffModel || auditModel;
  if (!model) {
    markStageDone(runId, "audit", { skipped: true });
    return null;
  }
  markStageStart(runId, "audit", { model });
  const subtasksWithOutputs = strategy.subtasks.map((st, i) => {
    const match = workerOutputs.find((w) => w.subtask?.id === st.id);
    return { ...st, output: match?.text || "(no output)" };
  });
  const auditBody = stripIdeSystemPrompt(buildPanelBody(body_global));
  const directiveBody = appendUserTurn(auditBody, buildStaffAuditPrompt(subtasksWithOutputs, workerOutputs.map((w) => w.text)));

  try {
    const res = await withTimeout(handleSingleModel(directiveBody, model, true), cfg.managerTimeoutMs);
    if (res?.__timeout || res?.__error) {
      markStageDone(runId, "audit", { skipped: true });
      return null;
    }
    const text = extractPanelText(await res.clone().json().catch(() => ({})));
    markStageDone(runId, "audit", { reportLen: text.length });
    return text;
  } catch (e) {
    log?.warn?.("SWARM", `Staff audit error: ${e?.message || e}`);
    markStageDone(runId, "audit", { skipped: true });
    return null;
  }
}

// Body is threaded via a module-level ref because dispatchWorkers is invoked
// as a map callback and can't easily take extra args without changing the
// collectPanel contract. Set before fan-out, cleared after.
let body_global = null;

// ── Main entry ────────────────────────────────────────────────────────────

/**
 * Hierarchical Swarm orchestration. Mirrors handleFusionChat's contract.
 * @param {object} opts
 * @returns {Promise<Response>}
 */
export async function handleSwarmChat({
  body,
  models,
  handleSingleModel,
  log,
  comboName,
  managerModel,
  staffModel,
  auditModel,
  workerCount,
  swarmTuning,
  telemetry = true,
}) {
  const panel = models.filter(Boolean);
  if (panel.length === 0) {
    return new Response(JSON.stringify({ error: "Swarm requires at least one worker model" }), { status: 400 });
  }

  const cfg = { ...SWARM_DEFAULTS, ...(swarmTuning || {}) };
  const manager = (managerModel || "").trim() || panel[0];
  const userPrompt = extractUserPrompt(body);

  // Single-model fast path: no point orchestrating a swarm over one model.
  if (panel.length === 1 && !managerModel && !staffModel && !auditModel) {
    return handleSingleModel(body, panel[0]);
  }

  body_global = body;
  const run = telemetry
    ? createSwarmRun({
        comboName,
        promptPreview: userPrompt,
        managerModel: manager,
        staffModel,
        auditModel,
        workerCount: workerCount || cfg.minWorkers,
      })
    : null;
  const runId = run?.runId;

  try {
    // ── Stage 0: Gatekeeper ──
    const verdict = telemetry
      ? await runGatekeeper({ runId, body, managerModel: manager, handleSingleModel, cfg, log })
      : (await runGatekeeperNoTelemetry({ body, managerModel: manager, handleSingleModel, cfg, log }));

    if (verdict === "simple") {
      // Manager answers directly, streaming to client (original body preserved).
      log?.info?.("SWARM", "Gatekeeper bypass — simple request, direct answer");
      if (runId) markRunComplete(runId, { bypassed: true });
      body_global = null;
      return handleSingleModel(body, manager);
    }

    // ── Stage 1: Manager Strategy ──
    const strategy = telemetry
      ? await runManagerStrategy({ runId, body, managerModel: manager, handleSingleModel, cfg, log })
      : (await runManagerStrategyNoTelemetry({ body, managerModel: manager, handleSingleModel, cfg, log }));

    if (!strategy || !Array.isArray(strategy.subtasks) || strategy.subtasks.length === 0) {
      // Strategy parse failed → fall back to direct answer.
      log?.warn?.("SWARM", "Strategy decomposition failed — falling back to direct answer");
      if (runId) markRunComplete(runId, { fallback: true });
      body_global = null;
      return handleSingleModel(body, manager);
    }

    // Clamp worker count.
    const effectiveSubtasks = strategy.subtasks.slice(0, cfg.maxWorkers);

    // ── Stage 2+3: Dispatch Workers (parallel) ──
    const workerOutputs = telemetry
      ? await dispatchWorkers({ runId, strategy: { subtasks: effectiveSubtasks }, models: panel, handleSingleModel, cfg, log })
      : (await dispatchWorkersNoTelemetry({ strategy: { subtasks: effectiveSubtasks }, models: panel, handleSingleModel, cfg, log }));

    if (workerOutputs.length < cfg.minWorkers) {
      // Too few workers succeeded → fall back to direct answer from best worker or manager.
      log?.warn?.("SWARM", `Only ${workerOutputs.length}/${effectiveSubtasks.length} workers succeeded — fallback`);
      if (runId) markRunComplete(runId, { fallback: true });
      body_global = null;
      if (workerOutputs.length === 1) {
        // Return the single worker's output directly.
        return handleSingleModel(appendUserTurn(body, "The specialist worker produced this answer. Output it verbatim to the user."), manager);
      }
      return handleSingleModel(body, manager);
    }

    // ── Stage 4: Staff Audit ──
    const auditReport = telemetry
      ? await runStaffAudit({ runId, strategy: { subtasks: effectiveSubtasks }, workerOutputs, staffModel, auditModel, handleSingleModel, cfg, log })
      : (await runStaffAuditNoTelemetry({ strategy: { subtasks: effectiveSubtasks }, workerOutputs, staffModel, auditModel, handleSingleModel, cfg, log }));

    // ── Stage 5: Manager Synthesis (STREAMED to client) ──
    const synthesisDirective = auditReport
      ? buildManagerSynthesisPrompt(auditReport, userPrompt)
      : buildManagerSynthesisPrompt(workerOutputs.map((w) => w.text).join("\n\n---\n\n"), userPrompt);

    // Final call uses ORIGINAL body (tools restored, stream flag intact) so SSE reaches client.
    const synthBody = appendUserTurn(body, synthesisDirective);
    log?.info?.("SWARM", `Synthesizing final answer from ${workerOutputs.length} worker outputs`);

    // Wrap the synthesis call so we can mark telemetry complete after it finishes.
    if (runId) {
      markStageStart(runId, "synthesis", { model: manager });
      const res = await handleSingleModel(synthBody, manager);
      markStageDone(runId, "synthesis");
      markRunComplete(runId, { workerCount: workerOutputs.length });
      body_global = null;
      return res;
    }

    body_global = null;
    return handleSingleModel(synthBody, manager);
  } catch (e) {
    log?.error?.("SWARM", `Swarm failed: ${e?.message || e}`);
    if (runId) markRunError(runId, e);
    body_global = null;
    // Graceful degradation: fall back to direct answer on any uncaught error.
    return handleSingleModel(body, manager);
  }
}

// ── No-telemetry variants (leaner, used when telemetry disabled) ──────────

async function runGatekeeperNoTelemetry({ body, managerModel, handleSingleModel, cfg, log }) {
  const gateBody = stripIdeSystemPrompt(buildPanelBody(body));
  const directiveBody = appendUserTurn(gateBody, GATEKEEPER_PROMPT);
  try {
    const res = await withTimeout(handleSingleModel(directiveBody, managerModel, true), cfg.managerTimeoutMs);
    if (res?.__timeout || res?.__error) return "complex";
    const text = extractPanelText(await res.clone().json().catch(() => ({})));
    return /VERDICT:\s*SIMPLE/i.test(text) ? "simple" : "complex";
  } catch {
    return "complex";
  }
}

async function runManagerStrategyNoTelemetry({ body, managerModel, handleSingleModel, cfg, log }) {
  const userPrompt = extractUserPrompt(body);
  const mgrBody = stripIdeSystemPrompt(buildPanelBody(body));
  const directiveBody = appendUserTurn(mgrBody, buildManagerStrategyPrompt(userPrompt));
  try {
    const res = await withTimeout(handleSingleModel(directiveBody, managerModel, true), cfg.managerTimeoutMs);
    if (res?.__timeout || res?.__error) return null;
    const text = extractPanelText(await res.clone().json().catch(() => ({})));
    return parseStrategy(text);
  } catch {
    return null;
  }
}

async function dispatchWorkersNoTelemetry({ strategy, models, handleSingleModel, cfg }) {
  const workerModels = models.filter(Boolean);
  if (workerModels.length === 0) return [];
  const calls = strategy.subtasks.map((subtask, i) => {
    const workerModel = workerModels[i % workerModels.length];
    const workerBody = appendUserTurn(buildPanelBody(body_global), buildWorkerDirective(subtask));
    return withTimeout(handleSingleModel(workerBody, workerModel, true), cfg.workerHardTimeoutMs);
  });
  const settled = await collectPanel(calls, {
    minPanel: Math.min(cfg.workerQuorum, calls.length),
    stragglerGraceMs: cfg.stragglerGraceMs,
    panelHardTimeoutMs: cfg.workerHardTimeoutMs,
  });
  const outputs = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r && !r.__timeout && !r.__error) {
      const text = extractPanelText(await r.clone().json().catch(() => ({})));
      if (text) outputs.push({ subtask: strategy.subtasks[i], text });
    }
  }
  return outputs;
}

async function runStaffAuditNoTelemetry({ strategy, workerOutputs, staffModel, auditModel, handleSingleModel, cfg }) {
  const model = staffModel || auditModel;
  if (!model) return null;
  const subtasksWithOutputs = strategy.subtasks.map((st, i) => {
    const match = workerOutputs.find((w) => w.subtask?.id === st.id);
    return { ...st, output: match?.text || "(no output)" };
  });
  const auditBody = stripIdeSystemPrompt(buildPanelBody(body_global));
  const directiveBody = appendUserTurn(auditBody, buildStaffAuditPrompt(subtasksWithOutputs, workerOutputs.map((w) => w.text)));
  try {
    const res = await withTimeout(handleSingleModel(directiveBody, model, true), cfg.managerTimeoutMs);
    if (res?.__timeout || res?.__error) return null;
    return extractPanelText(await res.clone().json().catch(() => ({})));
  } catch {
    return null;
  }
}
