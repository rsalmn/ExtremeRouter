"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { consumeSSEStream } from "@/shared/utils/sseStream";

/**
 * Playground streaming orchestration hook.
 *
 * Owns the AbortController map + unmount cleanup so the component can stay
 * declarative. Previously the abort controllers lived in a ref inside
 * PlaygroundClient and were NEVER aborted on unmount — navigating away
 * mid-stream orphaned the request on the server (consuming provider tokens +
 * rate-limit budget). This hook aborts all in-flight requests on unmount.
 *
 * Each stream writes via the `onDelta(id, parsed)` callback, and the component
 * applies functional state updates (setMessages(prev => ...) / setCompareResults)
 * so there's no shared mutable object across concurrent compare-mode callbacks.
 *
 * @param {object} handlers
 * @param {(id: string, parsed: object) => void} handlers.onDelta
 *        Called for every SSE chunk. `parsed` has {content, reasoning, toolCalls,
 *        finishReason, usage}.
 * @param {(id: string, result: {usage: object|null, ok: true}) => void} handlers.onComplete
 *        Called when a stream finishes normally. Carries the terminal usage.
 * @param {(id: string, message: string, status: number) => void} handlers.onError
 *        Called on non-OK response or thrown error. AbortError is NOT forwarded.
 * @returns {{ streamChat, abort, abortAll, streaming }}
 */
export function usePlaygroundStream({ onDelta, onComplete, onError }) {
  const controllersRef = useRef({});
  const [streamingCount, setStreamingCount] = useState(0);

  // HIGH #6: abort ALL in-flight requests on unmount. Without this, navigating
  // away mid-stream leaves the fetch running on the server.
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      Object.values(controllers).forEach((c) => c?.abort?.());
    };
  }, []);

  const streamChat = useCallback(
    async (id, { body, apiKey }) => {
      const controller = new AbortController();
      controllersRef.current[id] = controller;
      setStreamingCount((n) => n + 1);

      try {
        const headers = {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const res = await fetch("/api/v1/chat/completions", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...body, stream: true }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
          onError(id, err.error?.message || `HTTP ${res.status}`, res.status);
          return;
        }

        // consumeSSEStream resolves with the terminal usage object (or null).
        const usage = await consumeSSEStream(res, {
          onChunk: (parsed) => onDelta(id, parsed),
        });
        onComplete(id, { usage, ok: true });
      } catch (err) {
        // AbortError is expected (user clicked Stop or navigated away) — don't
        // surface it as an error.
        if (err?.name !== "AbortError") {
          onError(id, err?.message || "Network error", 0);
        }
      } finally {
        delete controllersRef.current[id];
        setStreamingCount((n) => Math.max(0, n - 1));
      }
    },
    [onDelta, onComplete, onError]
  );

  const abort = useCallback((id) => {
    controllersRef.current[id]?.abort?.();
  }, []);

  const abortAll = useCallback(() => {
    Object.values(controllersRef.current).forEach((c) => c?.abort?.());
  }, []);

  return { streamChat, abort, abortAll, streaming: streamingCount > 0 };
}
