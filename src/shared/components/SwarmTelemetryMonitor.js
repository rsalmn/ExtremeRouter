"use client";

import { useState, useEffect, useRef } from "react";
import Badge from "@/shared/components/Badge";
import EmptyState from "@/shared/components/EmptyState";
import { cn } from "@/shared/utils/cn";

const STAGE_META = {
  gatekeeper: { label: "Gatekeeper", icon: "fork_right", desc: "Classifies request complexity" },
  manager: { label: "Manager", icon: "psychology", desc: "Decomposes into subtasks" },
  workers: { label: "Workers", icon: "group_work", desc: "Parallel specialist execution" },
  audit: { label: "Staff Audit", icon: "fact_check", desc: "Reviews worker outputs" },
  synthesis: { label: "Synthesis", icon: "auto_awesome", desc: "Final cohesive answer" },
};

const STAGE_ORDER = ["gatekeeper", "manager", "workers", "audit", "synthesis"];

function statusVariant(status) {
  if (status === "done") return "success";
  if (status === "running") return "info";
  if (status === "error") return "error";
  return "default";
}

function statusLabel(status) {
  if (status === "done") return "Done";
  if (status === "running") return "Running";
  if (status === "error") return "Error";
  return "Pending";
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimeAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

export default function SwarmTelemetryMonitor() {
  const [runs, setRuns] = useState([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    const es = new EventSource("/api/swarm/stream");
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setRuns((prev) => {
          // Snapshot: replace all
          if (data.type === "snapshot" && Array.isArray(data.runs)) {
            return data.runs;
          }
          // Per-event: find the runId and update its stage(s)
          if (data.runId) {
            return prev.map((run) => {
              if (run.runId !== data.runId) return run;
              const next = { ...run, stages: { ...run.stages } };

              if (data.stage === "workers" && data.worker !== undefined) {
                // Per-worker update
                const workers = [...(next.stages.workers?.workers || [])];
                if (workers[data.worker]) {
                  workers[data.worker] = { ...workers[data.worker], status: data.status, model: data.model ?? workers[data.worker].model };
                }
                next.stages.workers = { ...next.stages.workers, workers };
              } else if (data.stage) {
                // Stage-level update
                next.stages[data.stage] = {
                  ...next.stages[data.stage],
                  status: data.status,
                  durationMs: data.durationMs ?? next.stages[data.stage]?.durationMs,
                  model: data.model ?? next.stages[data.stage]?.model,
                  verdict: data.verdict ?? next.stages[data.stage]?.verdict,
                  strategy: data.strategy ?? next.stages[data.stage]?.strategy,
                };
              }

              // Run-level completion
              if (data.type === "swarm:complete") {
                next.status = "done";
                next.totalDurationMs = data.totalDurationMs;
              } else if (data.type === "swarm:error") {
                next.status = "error";
                next.error = data.error;
              }
              return next;
            });
          }
          return prev;
        });
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  const activeRuns = runs.filter((r) => r.status === "running");
  const completedRuns = runs.filter((r) => r.status !== "running");

  return (
    <div className="flex flex-col gap-5">
      {/* Connection status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <span className={cn("size-2 rounded-full", connected ? "bg-success animate-pulse" : "bg-danger")} />
          {connected ? "Live" : "Reconnecting…"}
        </div>
        {activeRuns.length > 0 && (
          <Badge variant="info" dot>{activeRuns.length} active run{activeRuns.length > 1 ? "s" : ""}</Badge>
        )}
      </div>

      {runs.length === 0 ? (
        <EmptyState
          icon="hub"
          title="No swarm runs yet"
          description="Hierarchical Swarm runs will appear here in real time. Send a request to a combo with the 'Hierarchical Swarm' strategy to see the pipeline in action."
        />
      ) : (
        <>
          {/* Active runs (expanded) */}
          {activeRuns.length > 0 && (
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Active</h3>
              {activeRuns.map((run) => (
                <SwarmRunCard key={run.runId} run={run} expanded />
              ))}
            </div>
          )}

          {/* Recent completed runs (collapsed) */}
          {completedRuns.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Recent</h3>
              {completedRuns.slice(0, 10).map((run) => (
                <SwarmRunCard key={run.runId} run={run} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SwarmRunCard({ run, expanded = false }) {
  const stageEntries = STAGE_ORDER.map((key) => [key, run.stages?.[key]]);

  return (
    <div className={cn(
      "rounded-panel border bg-panel shadow-[var(--shadow-soft)]",
      run.status === "error" ? "border-danger/30" : "border-border-subtle"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Badge variant={statusVariant(run.status)} dot size="sm">{statusLabel(run.status)}</Badge>
          <div className="min-w-0">
            <div className="truncate font-mono text-sm font-medium text-text-main">{run.comboName || "swarm"}</div>
            <div className="truncate text-xs text-text-muted">{formatTimeAgo(run.startedAt)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-text-muted">
          {run.totalDurationMs && <span className="font-mono">{formatDuration(run.totalDurationMs)}</span>}
          {run.workerCount != null && run.workerCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">group_work</span>
              {run.workerCount}
            </span>
          )}
        </div>
      </div>

      {/* Prompt preview */}
      {run.promptPreview && (
        <div className="border-b border-border-subtle px-4 py-2">
          <p className="truncate text-xs text-text-muted">{run.promptPreview}</p>
        </div>
      )}

      {/* Pipeline visualization */}
      <div className="grid grid-cols-2 gap-px bg-border-subtle sm:grid-cols-5">
        {stageEntries.map(([key, stage]) => {
          const meta = STAGE_META[key];
          const variant = statusVariant(stage?.status);
          const isRunning = stage?.status === "running";
          return (
            <div key={key} className={cn("bg-panel p-3 transition-colors", isRunning && "bg-primary/5")}>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "material-symbols-outlined text-[16px]",
                  stage?.status === "done" && "text-success",
                  stage?.status === "running" && "text-info",
                  stage?.status === "error" && "text-danger",
                  (!stage?.status || stage?.status === "pending") && "text-text-subtle"
                )}>
                  {isRunning ? "progress_activity" : meta.icon}
                </span>
                <span className="text-xs font-semibold text-text-main">{meta.label}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className={cn(
                  "size-1.5 rounded-full",
                  stage?.status === "done" && "bg-success",
                  stage?.status === "running" && "bg-info animate-pulse",
                  stage?.status === "error" && "bg-danger",
                  (!stage?.status || stage?.status === "pending") && "bg-text-subtle"
                )} />
                <span className="text-[11px] text-text-muted">
                  {stage?.durationMs ? formatDuration(stage.durationMs) : statusLabel(stage?.status)}
                </span>
              </div>
              {stage?.verdict && (
                <div className="mt-1 text-[10px] uppercase tracking-wide text-text-subtle">{stage.verdict}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Worker fan-out detail (only for workers stage + expanded) */}
      {expanded && run.stages?.workers?.workers?.length > 0 && (
        <div className="border-t border-border-subtle px-4 py-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Workers</div>
          <div className="flex flex-wrap gap-2">
            {run.stages.workers.workers.map((w, i) => (
              <div key={i} className={cn(
                "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                w.status === "done" ? "border-success/30 bg-success/5" : w.status === "running" ? "border-info/30 bg-info/5" : w.status === "error" ? "border-danger/30 bg-danger/5" : "border-border-subtle bg-surface-2"
              )}>
                <span className="font-mono text-text-subtle">#{i + 1}</span>
                <span className="truncate max-w-[160px] text-text-muted">{w.model || "—"}</span>
                <span className={cn(
                  "size-1.5 rounded-full",
                  w.status === "done" && "bg-success",
                  w.status === "running" && "bg-info animate-pulse",
                  w.status === "error" && "bg-danger",
                  (!w.status || w.status === "pending") && "bg-text-subtle"
                )} />
                {w.durationMs && <span className="font-mono text-text-subtle">{formatDuration(w.durationMs)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error detail */}
      {run.status === "error" && run.error && (
        <div className="border-t border-danger/20 bg-danger/5 px-4 py-2">
          <p className="text-xs text-danger">{run.error}</p>
        </div>
      )}
    </div>
  );
}
