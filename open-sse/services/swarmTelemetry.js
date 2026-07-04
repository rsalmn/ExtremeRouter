/**
 * Swarm Telemetry — in-memory event bus + run registry for Hierarchical Swarm.
 *
 * Mirrors the statsEmitter pattern from usageRepo.js: a singleton EventEmitter
 * with a debounced emit helper so a worker fan-out of N workers doesn't flood
 * the SSE stream. Active runs are kept in an in-memory Map (cleared on restart);
 * history persistence is deferred to Phase 2.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// Singleton on global to survive Next.js dev hot-reload.
if (!global._swarmEmitter) {
  global._swarmEmitter = new EventEmitter();
  global._swarmEmitter.setMaxListeners(100);
  global._swarmRuns = new Map(); // runId → SwarmRun
  global._swarmEmitTimers = {}; // key → timeout (debounce)
}
const swarmEmitter = global._swarmEmitter;
const swarmRuns = global._swarmRuns;
const emitTimers = global._swarmEmitTimers;

export { swarmEmitter };

const MAX_RUNS_KEPT = 50;

/**
 * Debounced emit. Coalesces rapid bursts of the same event key into a single
 * emission, mirroring scheduleStatsEvent() from usageRepo.js.
 */
export function scheduleSwarmEvent(event, payload, delayMs = 120) {
  const key = `${event}:${payload?.runId || ""}`;
  if (emitTimers[key]) clearTimeout(emitTimers[key]);
  emitTimers[key] = setTimeout(() => {
    delete emitTimers[key];
    swarmEmitter.emit(event, payload);
  }, delayMs);
}

/**
 * Create + register a new swarm run. Returns the run object.
 */
export function createSwarmRun({ comboName, promptPreview, managerModel, staffModel, auditModel, workerCount }) {
  const runId = randomUUID();
  const now = Date.now();
  const run = {
    runId,
    comboName,
    promptPreview: (promptPreview || "").slice(0, 200),
    managerModel,
    staffModel,
    auditModel,
    workerCount: workerCount || 0,
    status: "running",
    startedAt: now,
    completedAt: null,
    totalDurationMs: null,
    stages: {
      gatekeeper: { status: "pending", startedAt: null, completedAt: null, durationMs: null, model: managerModel, verdict: null },
      manager: { status: "pending", startedAt: null, completedAt: null, durationMs: null, model: managerModel, strategy: null },
      workers: { status: "pending", startedAt: null, completedAt: null, durationMs: null, workers: [] },
      audit: { status: "pending", startedAt: null, completedAt: null, durationMs: null, model: staffModel || auditModel },
      synthesis: { status: "pending", startedAt: null, completedAt: null, durationMs: null, model: managerModel },
    },
  };

  // Initialize per-worker slots
  for (let i = 0; i < (workerCount || 0); i++) {
    run.stages.workers.workers.push({ index: i, status: "pending", model: null, durationMs: null });
  }

  swarmRuns.set(runId, run);
  // Evict oldest if over cap (keep most recent)
  if (swarmRuns.size > MAX_RUNS_KEPT) {
    const oldest = [...swarmRuns.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0];
    if (oldest) swarmRuns.delete(oldest[0]);
  }

  scheduleSwarmEvent("swarm:start", { runId, comboName, promptPreview: run.promptPreview, workerCount: run.workerCount }, 0);
  return run;
}

/**
 * Mark a stage as started/running.
 */
export function markStageStart(runId, stage, extra = {}) {
  const run = swarmRuns.get(runId);
  if (!run) return;
  const s = run.stages[stage];
  if (!s) return;
  s.status = "running";
  s.startedAt = Date.now();
  Object.assign(s, extra);
  scheduleSwarmEvent("swarm:stage", { runId, stage, status: "running", ...extra });
}

/**
 * Mark a stage as completed.
 */
export function markStageDone(runId, stage, extra = {}) {
  const run = swarmRuns.get(runId);
  if (!run) return;
  const s = run.stages[stage];
  if (!s) return;
  s.status = "done";
  s.completedAt = Date.now();
  s.durationMs = s.startedAt ? s.completedAt - s.startedAt : null;
  Object.assign(s, extra);
  scheduleSwarmEvent("swarm:stage", { runId, stage, status: "done", durationMs: s.durationMs, ...extra });
}

/**
 * Mark an individual worker slot within the workers stage.
 */
export function markWorkerStatus(runId, workerIndex, status, extra = {}) {
  const run = swarmRuns.get(runId);
  if (!run) return;
  const w = run.stages.workers.workers[workerIndex];
  if (!w) return;
  w.status = status;
  Object.assign(w, extra);
  scheduleSwarmEvent("swarm:stage", { runId, stage: "workers", worker: workerIndex, status, ...extra });
}

/**
 * Mark the whole run as errored.
 */
export function markRunError(runId, error) {
  const run = swarmRuns.get(runId);
  if (!run) return;
  run.status = "error";
  run.error = String(error?.message || error || "unknown");
  run.completedAt = Date.now();
  run.totalDurationMs = run.completedAt - run.startedAt;
  scheduleSwarmEvent("swarm:error", { runId, error: run.error, totalDurationMs: run.totalDurationMs }, 0);
}

/**
 * Mark the whole run as completed successfully.
 */
export function markRunComplete(runId, extra = {}) {
  const run = swarmRuns.get(runId);
  if (!run) return;
  run.status = "done";
  run.completedAt = Date.now();
  run.totalDurationMs = run.completedAt - run.startedAt;
  Object.assign(run, extra);
  scheduleSwarmEvent("swarm:complete", { runId, totalDurationMs: run.totalDurationMs, ...extra }, 0);
}

/**
 * Get a snapshot of recent swarm runs (newest first).
 * Used by GET /api/swarm/active for dashboard initial load.
 */
export function getRecentSwarms(limit = 20) {
  return [...swarmRuns.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}
