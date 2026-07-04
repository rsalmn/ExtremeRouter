import { healthEmitter, getAllProviderHealth } from "open-sse/services/healthMonitor.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/stream — SSE stream of provider health updates.
 */
export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, onEvent: null };

  const stream = new ReadableStream({
    async start(controller) {
      // Initial snapshot
      try {
        const snapshot = getAllProviderHealth();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "snapshot", providers: snapshot })}\n\n`));
      } catch {
        // ignore
      }

      state.onEvent = (payload) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };

      healthEmitter.on("health:update", state.onEvent);

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
    if (state.onEvent) healthEmitter.off("health:update", state.onEvent);
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
