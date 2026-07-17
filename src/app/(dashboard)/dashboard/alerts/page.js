"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Button, Input, Toggle, PageHeader, Badge } from "@/shared/components";

const EVENT_OPTIONS = [
  { key: "providerDown", label: "Provider Down", desc: "Circuit breaker opens (provider repeatedly failing)", icon: "error" },
  { key: "rateLimited", label: "Rate Limited", desc: "Account hits 429/403 from upstream", icon: "block" },
  { key: "healthDegraded", label: "Health Degraded", desc: "Success rate drops below 70%", icon: "monitor_heart" },
  { key: "budgetExceeded", label: "Budget Exceeded", desc: "Usage quota reached", icon: "data_usage" },
];

export default function AlertsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [savedField, setSavedField] = useState(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch { /* non-fatal */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // Cleanup: clear debounce timer on unmount to prevent state updates on unmounted component
  useEffect(() => () => { if (patchTimer.current) clearTimeout(patchTimer.current); }, []);

  // H4 FIX: Use a ref to always read the latest settings when building the PATCH
  // body, avoiding stale closure on concurrent keystrokes. Debounce the actual
  // network call to prevent data loss from rapid successive writes.
  const patchTimer = useRef(null);
  const patch = useCallback(async (key, value, subKey) => {
    // Build body from current settings state (functional read)
    setSettings(prev => {
      const updated = subKey
        ? { ...prev, [key]: { ...(prev?.[key] || {}), [subKey]: value } }
        : { ...prev, [key]: value };
      // Debounce the network write: clear any pending write and schedule a new one
      if (patchTimer.current) clearTimeout(patchTimer.current);
      patchTimer.current = setTimeout(async () => {
        try {
          const body = subKey
            ? { [key]: { ...(updated[key] || {}), [subKey]: value } }
            : { [key]: value };
          const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (res.ok) {
            setSavedField(subKey || key);
            setTimeout(() => setSavedField(null), 1500);
          }
        } catch { /* non-fatal */ }
      }, 500); // 500ms debounce
      return updated;
    });
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/alerts/test", { method: "POST" });
      const data = await res.json();
      setTestResult(data.success ? "sent" : "failed");
    } catch {
      setTestResult("failed");
    }
    setTesting(false);
    setTimeout(() => setTestResult(null), 5000);
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <Card><div className="h-6 w-48 animate-pulse rounded bg-sidebar" /></Card>
        <Card><div className="h-32 animate-pulse rounded bg-sidebar" /></Card>
      </div>
    );
  }

  const enabled = settings?.webhookEnabled === true;
  const hasChannel = !!(settings?.webhookDiscordUrl || settings?.webhookTelegramToken || settings?.webhookGenericUrl);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="Webhook Alerts"
        description="Get notified via Discord, Telegram, or generic webhook when providers fail"
        icon="notifications_active"
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={testing ? "progress_activity" : "send"}
            onClick={handleTest}
            disabled={testing || !enabled || !hasChannel}
          >
            {testing ? "Sending..." : "Send Test"}
          </Button>
        }
      />

      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Toggle
              checked={enabled}
              onChange={(checked) => patch("webhookEnabled", checked)}
              label="Enable Webhook Alerts"
            />
            {enabled && (
              <Badge variant="success" size="sm" dot>Active</Badge>
            )}
          </div>
          {enabled && !hasChannel && (
            <Badge variant="warning" size="sm" icon="warning">
              No channel configured
            </Badge>
          )}
        </div>
      </Card>

      {enabled && (
        <>
          <Card>
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-text-main">Delivery Channels</h3>
              <p className="text-xs text-text-muted mt-0.5">Configure where alerts are sent. Fill one or more.</p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#5865F2]/10">
                  <span className="material-symbols-outlined text-[#5865F2] text-lg">chat</span>
                </div>
                <div className="flex-1">
                  <Input
                    label="Discord Webhook URL"
                    type="text"
                    value={settings?.webhookDiscordUrl || ""}
                    onChange={(e) => patch("webhookDiscordUrl", e.target.value)}
                    placeholder="https://discord.com/api/webhooks/..."
                    hint={savedField === "webhookDiscordUrl" ? "✓ Saved" : undefined}
                  />
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0088cc]/10">
                  <span className="material-symbols-outlined text-[#0088cc] text-lg">send</span>
                </div>
                <div className="flex-1 flex flex-col gap-3">
                  <Input
                    label="Telegram Bot Token"
                    type="password"
                    value={settings?.webhookTelegramToken || ""}
                    onChange={(e) => patch("webhookTelegramToken", e.target.value)}
                    placeholder="123456:ABC-DEF..."
                    hint={savedField === "webhookTelegramToken" ? "✓ Saved" : undefined}
                  />
                  <Input
                    label="Telegram Chat ID"
                    type="text"
                    value={settings?.webhookTelegramChatId || ""}
                    onChange={(e) => patch("webhookTelegramChatId", e.target.value)}
                    placeholder="Example -1001234567890"
                    hint={savedField === "webhookTelegramChatId" ? "✓ Saved" : undefined}
                  />
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <span className="material-symbols-outlined text-primary text-lg">webhook</span>
                </div>
                <div className="flex-1">
                  <Input
                    label="Generic Webhook URL"
                    type="text"
                    value={settings?.webhookGenericUrl || ""}
                    onChange={(e) => patch("webhookGenericUrl", e.target.value)}
                    placeholder="https://your-server.com/webhook"
                    hint={savedField === "webhookGenericUrl" ? "✓ Saved" : undefined}
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-text-main">Alert Events</h3>
              <p className="text-xs text-text-muted mt-0.5">Choose which events trigger an alert.</p>
            </div>
            <div className="flex flex-col gap-3">
              {EVENT_OPTIONS.map(evt => {
                const isOn = settings?.webhookAlertEvents?.[evt.key] === true;
                return (
                  <div
                    key={evt.key}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${isOn ? "border-primary/30 bg-primary/[0.03]" : "border-border-subtle"}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`material-symbols-outlined text-lg ${isOn ? "text-primary" : "text-text-muted"}`}>
                        {evt.icon}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-text-main">{evt.label}</p>
                        <p className="text-xs text-text-muted">{evt.desc}</p>
                      </div>
                    </div>
                    <Toggle
                      size="sm"
                      checked={isOn}
                      onChange={(checked) => patch("webhookAlertEvents", checked, evt.key)}
                    />
                  </div>
                );
              })}
            </div>
          </Card>

          {testResult === "sent" && (
            <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/[0.05] px-4 py-2.5 text-sm text-success">
              <span className="material-symbols-outlined text-base">check_circle</span>
              Test alert sent! Check your configured channels.
            </div>
          )}
          {testResult === "failed" && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/[0.05] px-4 py-2.5 text-sm text-danger">
              <span className="material-symbols-outlined text-base">error</span>
              Failed to send test alert. Check your channel URLs.
            </div>
          )}
        </>
      )}
    </div>
  );
}
