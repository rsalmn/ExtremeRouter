// Alert Service — central webhook dispatcher.
//
// Subscribes to Circuit Breaker state changes (breakerEmitter) and exposes
// dispatchAlert() for manual triggers (rate limit, health degradation, test).
// Delivers alerts to Discord, Telegram, and/or a generic webhook URL.
//
// Follows the statsEmitter/quotaAutoPing pattern: global singleton to survive
// Next.js hot-reload. Uses proxyAwareFetch so outbound proxy settings are respected.
// Debounced: max 1 alert per (eventType + provider) per 5 minutes.

import { getSettings } from "@/lib/localDb";
import { breakerEmitter } from "open-sse/services/circuitBreaker.js";

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

// Alert colors for Discord embeds
const COLORS = {
  provider_down: 0xef4444,   // red
  rate_limited: 0xf59e0b,    // amber
  health_degraded: 0xf59e0b, // amber
  budget_exceeded: 0xef4444, // red
  test: 0x3b82f6,            // blue
};

const TITLES = {
  provider_down: "🔴 Provider Down",
  rate_limited: "⚠️ Rate Limited",
  health_degraded: "⚠️ Health Degraded",
  budget_exceeded: "🔴 Budget Exceeded",
  test: "🔔 Test Alert",
};

// Global singleton to survive hot-reload
if (!global._alertService) {
  global._alertService = {
    initialized: false,
    lastAlert: new Map(), // key: `${eventType}:${provider}` → timestamp
  };
}
const svc = global._alertService;

/**
 * Initialize: subscribe to breakerEmitter for Circuit Breaker state changes.
 * Called once on app startup (from initializeApp.js).
 */
export function initAlertService() {
  if (svc.initialized) return;
  svc.initialized = true;

  breakerEmitter.on("breaker:update", (data) => {
    // Only alert when breaker OPENS (provider goes down)
    if (data.state === "open") {
      dispatchAlert("provider_down", {
        provider: data.provider,
        failures: data.failures,
        message: `Circuit Breaker OPEN for "${data.provider}" — ${data.failures} failures in window. Provider is now bypassed.`,
      }).catch(() => {});
    }
  });

  console.log("[AlertService] initialized — subscribed to breaker events");
}

/**
 * Main dispatch function. Reads webhook settings, checks debounce, sends alerts.
 * Safe to call from anywhere (auth.js, healthMonitor.js, API route, etc.).
 */
export async function dispatchAlert(eventType, payload = {}) {
  try {
    const settings = await getSettings();
    if (!settings.webhookEnabled) return;

    const events = settings.webhookAlertEvents || {};
    // Check if this event type is enabled (skip for "test" alerts)
    if (eventType !== "test" && !events[eventType]) return;

    // Debounce: skip if same event+provider fired recently
    const debounceKey = `${eventType}:${payload.provider || "global"}`;
    const now = Date.now();
    const last = svc.lastAlert.get(debounceKey);
    if (last && now - last < DEBOUNCE_MS) return;
    svc.lastAlert.set(debounceKey, now);

    const title = TITLES[eventType] || `🔔 ${eventType}`;
    const description = payload.message || JSON.stringify(payload);
    const color = COLORS[eventType] || 0x6b7280;

    const providers = payload.provider ? `[${payload.provider}]` : "";
    const text = `${title} ${providers}\n${description}`;

    // Send to all configured channels (fire-and-forget, don't block caller)
    const promises = [];

    if (settings.webhookDiscordUrl) {
      promises.push(sendDiscord(settings.webhookDiscordUrl, { title, description, color }));
    }
    if (settings.webhookTelegramToken && settings.webhookTelegramChatId) {
      promises.push(sendTelegram(settings.webhookTelegramToken, settings.webhookTelegramChatId, text));
    }
    if (settings.webhookGenericUrl) {
      promises.push(sendGeneric(settings.webhookGenericUrl, { eventType, title, description, ...payload, timestamp: new Date().toISOString() }));
    }

    await Promise.allSettled(promises);
  } catch (e) {
    // Alert delivery failure should never break the request pipeline
    console.warn("[AlertService] dispatch error:", e?.message || String(e));
  }
}

// ─── Delivery methods ──────────────────────────────────────────────────────

async function sendDiscord(url, { title, description, color }) {
  try {
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "ExtremeRouter",
        embeds: [{
          title,
          description,
          color,
          timestamp: new Date().toISOString(),
          footer: { text: "ExtremeRouter Gateway" },
        }],
      }),
    }, null);
  } catch (e) {
    console.warn("[AlertService] Discord delivery failed:", e?.message);
  }
}

async function sendTelegram(token, chatId, text) {
  try {
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    await proxyAwareFetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
      null
    );
  } catch (e) {
    console.warn("[AlertService] Telegram delivery failed:", e?.message);
  }
}

async function sendGeneric(url, payload) {
  try {
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, null);
  } catch (e) {
    console.warn("[AlertService] Generic webhook delivery failed:", e?.message);
  }
}
