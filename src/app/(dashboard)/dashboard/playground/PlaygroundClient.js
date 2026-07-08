"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { PageHeader, SegmentedControl, Button, CardSkeleton } from "@/shared/components";
import ModelPicker from "./components/ModelPicker";
import ParameterPanel from "./components/ParameterPanel";
import StatsBar from "./components/StatsBar";
import HistoryPanel from "./components/HistoryPanel";
import ChatArea from "./components/ChatArea";

const STORAGE_KEY = "extremerouter.playground.sessions";

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(sessions) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch {}
}

export default function PlaygroundClient() {
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [abortControllers, setAbortControllers] = useState({});

  // Mode: "single" or "compare"
  const [mode, setMode] = useState("single");

  // Selected models (1 for single, 2-4 for compare)
  const [selectedModels, setSelectedModels] = useState([""]);
  const [compareResults, setCompareResults] = useState({});

  // Parameters
  const [params, setParams] = useState({
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1,
  });

  // Stats
  const [stats, setStats] = useState({});
  const abortRef = useRef({});
  const apiKeyRef = useRef(null);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const loaded = loadSessions();
      setSessions(loaded);
      // Fetch API key for auth (needed if requireApiKey is on)
      try {
        const keysRes = await fetch("/api/keys");
        const keysData = await keysRes.json();
        const activeKey = (keysData.keys || keysData || []).find?.((k) => k.isActive !== false);
        if (activeKey?.key) apiKeyRef.current = activeKey.key;
      } catch {}
      try {
        const res = await fetch("/api/v1/models");
        const data = await res.json();
        const list = (data.data || []).map((m) => ({
          id: m.id,
          name: m.id,
          provider: m.owned_by || m.id.split("/")[0],
        }));
        setModels(list);
        if (list.length > 0) setSelectedModels([list[0].id]);
      } catch {}
      setLoading(false);
    })();
  }, []);

  // ── Session management ────────────────────────────────────────────────────

  const newSession = useCallback(() => {
    // Save current if has messages
    if (messages.length > 0 && currentSession) {
      updateSession(currentSession, messages);
    }
    setMessages([]);
    setCurrentSession(null);
    setStats({});
    setCompareResults({});
  }, [messages, currentSession]);

  const loadSession = useCallback((session) => {
    if (messages.length > 0 && currentSession) {
      updateSession(currentSession, messages);
    }
    setMessages(session.messages || []);
    setCurrentSession(session.id);
    if (session.model) setSelectedModels([session.model]);
    if (session.params) setParams(session.params);
    setStats({});
    setCompareResults({});
  }, [messages, currentSession]);

  const deleteSession = useCallback((id) => {
    const updated = sessions.filter((s) => s.id !== id);
    setSessions(updated);
    saveSessions(updated);
    if (currentSession === id) {
      setCurrentSession(null);
      setMessages([]);
    }
  }, [sessions, currentSession]);

  const updateSession = useCallback((id, msgs) => {
    const updated = sessions.map((s) =>
      s.id === id ? { ...s, messages: msgs, updatedAt: Date.now() } : s
    );
    setSessions(updated);
    saveSessions(updated);
  }, [sessions]);

  const saveCurrentSession = useCallback(() => {
    if (messages.length === 0) return;
    const id = currentSession || createId();
    const title = messages.find((m) => m.role === "user")?.content?.slice(0, 40) || "New Chat";
    const session = {
      id,
      title,
      messages,
      model: selectedModels[0],
      params,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const existing = sessions.find((s) => s.id === id);
    const updated = existing
      ? sessions.map((s) => (s.id === id ? { ...s, ...session } : s))
      : [session, ...sessions];
    setSessions(updated);
    saveSessions(updated);
    setCurrentSession(id);
  }, [messages, currentSession, sessions, selectedModels, params]);

  // ── Chat send ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || streaming) return;

    const userMsg = { role: "user", content: text, id: createId() };
    const baseMessages = [...messages, userMsg];
    if (params.systemPrompt) {
      baseMessages.unshift({ role: "system", content: params.systemPrompt });
    }

    if (mode === "single") {
      const modelId = selectedModels[0];
      if (!modelId) return;

      const assistantId = createId();
      const assistantMsg = { role: "assistant", content: "", id: assistantId, model: modelId, streaming: true };
      setMessages([...baseMessages.filter(m => m.role !== "system"), assistantMsg]);
      setStreaming(true);
      const startTime = Date.now();

      const controller = new AbortController();
      abortRef.current = { single: controller };

      try {
        const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
        if (apiKeyRef.current) headers["Authorization"] = `Bearer ${apiKeyRef.current}`;
        const res = await fetch("/api/v1/chat/completions", {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: baseMessages,
            stream: true,
            temperature: params.temperature,
            max_tokens: params.maxTokens,
            top_p: params.topP,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
          setMessages(prev => prev.map(m => m.id === assistantId
            ? { ...m, content: `❌ Error: ${err.error?.message || res.status}`, streaming: false, error: true }
            : m));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        let usage = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const chunk = JSON.parse(payload);
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullText } : m));
              }
              if (chunk.usage) usage = chunk.usage;
            } catch {}
          }
        }

        const elapsed = Date.now() - startTime;
        setStats({
          model: modelId,
          inputTokens: usage?.prompt_tokens || 0,
          outputTokens: usage?.completion_tokens || 0,
          latencyMs: elapsed,
        });
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m));
      } catch (err) {
        if (err.name !== "AbortError") {
          setMessages(prev => prev.map(m => m.id === assistantId
            ? { ...m, content: `❌ Error: ${err.message}`, streaming: false, error: true } : m));
        } else {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m));
        }
      } finally {
        setStreaming(false);
        delete abortRef.current.single;
      }
    } else {
      // Compare mode: send to all selected models simultaneously
      const validModels = selectedModels.filter(Boolean);
      if (validModels.length === 0) return;

      setCompareResults({});
      setStreaming(true);
      const startTime = Date.now();

      const results = {};
      await Promise.allSettled(validModels.map(async (modelId) => {
        const controller = new AbortController();
        abortRef.current[modelId] = controller;
        results[modelId] = { content: "", streaming: true, error: null };
        setCompareResults({ ...results });

        try {
          const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
          if (apiKeyRef.current) headers["Authorization"] = `Bearer ${apiKeyRef.current}`;
          const res = await fetch("/api/v1/chat/completions", {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: modelId,
              messages: baseMessages,
              stream: true,
              temperature: params.temperature,
              max_tokens: params.maxTokens,
              top_p: params.topP,
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
            results[modelId] = { ...results[modelId], content: `❌ ${err.error?.message || res.status}`, streaming: false, error: true };
            setCompareResults({ ...results });
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let fullText = "";

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const chunk = JSON.parse(payload);
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) {
                  fullText += delta;
                  results[modelId] = { ...results[modelId], content: fullText, streaming: true };
                  setCompareResults({ ...results });
                }
              } catch {}
            }
          }
          results[modelId] = { ...results[modelId], streaming: false };
          setCompareResults({ ...results });
        } catch (err) {
          if (err.name !== "AbortError") {
            results[modelId] = { ...results[modelId], content: `❌ ${err.message}`, streaming: false, error: true };
          } else {
            results[modelId] = { ...results[modelId], streaming: false };
          }
          setCompareResults({ ...results });
        } finally {
          delete abortRef.current[modelId];
        }
      }));

      const elapsed = Date.now() - startTime;
      setStats({ compareLatencyMs: elapsed, models: validModels.length });
      setStreaming(false);
    }
  }, [messages, streaming, mode, selectedModels, params]);

  const handleStop = useCallback(() => {
    Object.values(abortRef.current).forEach((c) => c?.abort?.());
    setStreaming(false);
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
    setCompareResults(prev => {
      const updated = {};
      for (const [k, v] of Object.entries(prev)) updated[k] = { ...v, streaming: false };
      return updated;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Playground" description="Test models, compare outputs, tune parameters" icon="science" />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Playground"
        description="Test models, compare outputs, tune parameters"
        icon="science"
        actions={
          <div className="flex items-center gap-2">
            <SegmentedControl
              options={[
                { value: "single", label: "Chat" },
                { value: "compare", label: "Compare" },
              ]}
              value={mode}
              onChange={setMode}
              size="sm"
            />
            <Button size="sm" variant="ghost" icon={streaming ? "stop" : "save"} onClick={streaming ? handleStop : saveCurrentSession} disabled={!streaming && messages.length === 0}>
              {streaming ? "Stop" : "Save"}
            </Button>
          </div>
        }
      />

      <div className="flex min-w-0 gap-4">
        {/* History sidebar (hidden on mobile) */}
        <div className="hidden w-56 shrink-0 lg:block">
          <HistoryPanel
            sessions={sessions}
            currentSession={currentSession}
            onNew={newSession}
            onLoad={loadSession}
            onDelete={deleteSession}
          />
        </div>

        {/* Center: chat / compare area */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Model picker(s) */}
          {mode === "single" ? (
            <ModelPicker
              models={models}
              value={selectedModels[0]}
              onChange={(val) => setSelectedModels([val])}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedModels.map((modelId, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <ModelPicker
                    models={models}
                    value={modelId}
                    onChange={(val) => {
                      const next = [...selectedModels];
                      next[idx] = val;
                      setSelectedModels(next);
                    }}
                    compact
                  />
                  {selectedModels.length > 2 && (
                    <button
                      onClick={() => setSelectedModels(selectedModels.filter((_, i) => i !== idx))}
                      className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-danger"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  )}
                </div>
              ))}
              {selectedModels.length < 4 && (
                <button
                  onClick={() => setSelectedModels([...selectedModels, ""])}
                  className="flex items-center gap-1 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-text-muted hover:border-primary/40 hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  Add Model
                </button>
              )}
            </div>
          )}

          {/* Chat area or compare results */}
          {mode === "single" ? (
            <ChatArea
              messages={messages}
              onSend={sendMessage}
              streaming={streaming}
              stats={stats}
            />
          ) : (
            <div className="flex min-w-0 gap-3">
              {selectedModels.filter(Boolean).map((modelId) => {
                const result = compareResults[modelId];
                return (
                  <div key={modelId} className="flex min-w-0 flex-1 flex-col rounded-brand border border-border-subtle bg-panel">
                    <div className="border-b border-border-subtle px-3 py-2">
                      <span className="truncate text-xs font-medium text-text-main">{modelId}</span>
                    </div>
                    <div className="custom-scrollbar max-h-[60vh] min-h-[200px] overflow-y-auto p-3">
                      {result?.content ? (
                        <p className={`whitespace-pre-wrap text-sm ${result.error ? "text-danger" : "text-text-main"}`}>
                          {result.content}
                          {result.streaming && <span className="ml-0.5 inline-block size-3 animate-pulse rounded-full bg-primary/50 align-middle" />}
                        </p>
                      ) : (
                        <p className="text-sm text-text-muted">
                          {streaming ? "Waiting..." : "Send a message to compare"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Composer */}
          <Composer onSend={sendMessage} streaming={streaming} onStop={handleStop} />

          {/* Stats */}
          {Object.keys(stats).length > 0 && (
            <StatsBar stats={stats} mode={mode} />
          )}
        </div>

        {/* Parameters sidebar (hidden on mobile) */}
        <div className="hidden w-60 shrink-0 xl:block">
          <ParameterPanel params={params} onChange={setParams} />
        </div>
      </div>
    </div>
  );
}

// ── Inline composer (simpler than a separate file for this) ─────────────────

function Composer({ onSend, streaming, onStop }) {
  const [text, setText] = useState("");
  const ref = useRef(null);

  const handleSend = () => {
    if (!text.trim() || streaming) return;
    onSend(text);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-brand border border-border-subtle bg-panel p-2">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
        }}
        onKeyDown={handleKeyDown}
        placeholder="Send a message... (Enter to send, Shift+Enter for new line)"
        rows={1}
        className="custom-scrollbar max-h-[120px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-text-main placeholder:text-text-muted focus:outline-none"
      />
      {streaming ? (
        <button
          onClick={onStop}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger/15 text-danger hover:bg-danger/25"
          title="Stop"
        >
          <span className="material-symbols-outlined text-[18px]">stop</span>
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-40"
          title="Send"
        >
          <span className="material-symbols-outlined text-[18px]">send</span>
        </button>
      )}
    </div>
  );
}
