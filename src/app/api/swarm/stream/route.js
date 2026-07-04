import { swarmEmitter, getRecentSwarms } from "open-sse/services/swarmTelemetry.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/swarm/stream — Server-Sent Events stream of Hierarchical Swarm runs.
 * Pushes live stage transitions as they happen, plus a 25s keepalive.
 */
export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, onEvent: null };

  const stream = new ReadableStream({
    async start(controller) {
      // Initial snapshot: send recent runs so the dashboard hydrates immediately.
      try {
        const initial = getRecentSwarms(20);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "snapshot", runs: initial })}\n\n`));
      } catch {
        // ignore
      }

      // Live event relay.
      state.onEvent = (payload) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };

      swarmEmitter.on("swarm:start", state.onEvent);
      swarmEmitter.on("swarm:stage", state.onEvent);
      swarmEmitter.on("swarm:complete", state.onEvent);
      swarmEmitter.on("swarm:error", state.onEvent);

      // Keepalive to prevent proxy/load-balancer idle timeout.
      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },

    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    state.closed = true;
    if (state.onEvent) {
      swarmEmitter.off("swarm:start", state.onEvent);
      swarmEmitter.off("swarm:stage", state.onEvent);
      swarmEmitter.off("swarm:complete", state.onEvent);
      swarmEmitter.off("swarm:error", state.onEvent);
    }
    if (state.keepalive) clearInterval(state.keepalive);
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
