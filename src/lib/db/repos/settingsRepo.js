import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  requireLogin: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  enableObservability: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  // Reliability: circuit breaker + health monitor
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    windowMs: 60000,
    cooldownMs: 30000,
    halfOpenMaxCalls: 1,
  },
  healthMonitor: {
    enabled: true,
    windowMs: 300000,
  },
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  // Pxpipe — multimodal prompt compression (in-process library)
  pxpipeEnabled: false,
  pxpipeAutoInstall: false,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 5000,
  // Semantic Cache — Jaccard similarity-based response cache
  semanticCacheEnabled: false,
  semanticCacheThreshold: 0.85,
  // Webhook / Alert System
  webhookEnabled: false,
  webhookDiscordUrl: "",
  webhookTelegramToken: "",
  webhookTelegramChatId: "",
  webhookGenericUrl: "",
  webhookAlertEvents: {
    providerDown: true,
    rateLimited: true,
    healthDegraded: true,
    budgetExceeded: false,
  },
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  return merged;
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };

    // Deep-merge `comboStrategies`: it is a map keyed by combo name where each
    // entry holds per-combo config (fallbackStrategy/judgeModel/managerModel/
    // fusionTuning/swarmTuning). A shallow top-level merge would let one
    // writer's full snapshot clobber every other combo's entry — a classic
    // lost-update race when two browser tabs edit different combos. Merge at
    // the combo-name level instead: incoming entries win, others are preserved.
    // Deletions are signalled by sending `{ [comboName]: null }`.
    if (updates && typeof updates.comboStrategies === "object" && !Array.isArray(updates.comboStrategies)) {
      const baseCs = (current.comboStrategies && typeof current.comboStrategies === "object") ? current.comboStrategies : {};
      const mergedCs = { ...baseCs };
      for (const [name, entry] of Object.entries(updates.comboStrategies)) {
        if (entry === null) {
          delete mergedCs[name];
        } else {
          mergedCs[name] = { ...(mergedCs[name] || {}), ...(entry || {}) };
        }
      }
      next.comboStrategies = mergedCs;
    }

    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}
