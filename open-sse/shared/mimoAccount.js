import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const API_BASE = "https://mimo-server-cn.xiaomimimo.com";
const ACCOUNT_HOST = "account.xiaomi.com";
const API_UA =
  "miNative PC/Normal Windows_NT/10.0.19045 SDKV/1.0.0 DEVT/PC DEVS/Windows APP/miaccount_desktop APPV/0.1.0";
const SSO_UA = "MiClaw/1.0";
const COOKIE_TTL_MS = 30 * 60 * 1000;

const _cache = new Map(); // key -> { cookie, at }
const _inflight = new Map(); // key -> Promise<cookie|null>

const DESKTOP_APP_FOLDER_NAMES = ["Xiaomi MiMo AI", "Xiaomi MiMo"];

function desktopCookiePathCandidates() {
  const home = os.homedir();
  return DESKTOP_APP_FOLDER_NAMES.map((appFolder) => {
    if (process.platform === "win32") {
      return path.join(home, "AppData", "Roaming", appFolder, "Partitions", "xiaomi-account", "Network", "Cookies");
    }
    if (process.platform === "darwin") {
      return path.join(home, "Library", "Application Support", appFolder, "Partitions", "xiaomi-account", "Network", "Cookies");
    }
    return path.join(home, ".config", appFolder, "Partitions", "xiaomi-account", "Network", "Cookies");
  });
}

/**
 * Read the persisted Xiaomi account cookies from MiMo Desktop's Electron profile.
 * The Chromium cookie DB is held with an exclusive lock while Desktop runs, so we
 * copy it first and return null if that fails.
 * @returns {Promise<Record<string,string>|null>}
 */
async function readDesktopAccountCookies() {
  const src = desktopCookiePathCandidates().find((p) => fs.existsSync(p));
  if (!src) return null;
  const tmp = path.join(os.tmpdir(), `mimo-cookies-${process.pid}-${crypto.randomBytes(4).toString("hex")}.db`);
  try {
    fs.copyFileSync(src, tmp);
  } catch {
    return null; // locked by a running Desktop
  }
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare("SELECT name, value FROM cookies WHERE host_key = ?").all("." + ACCOUNT_HOST);
    db.close();
    const jar = Object.fromEntries(rows.map((r) => [r.name, r.value]));
    return jar.passToken ? jar : null;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/**
 * Read just the passToken + identity cookies from Desktop's profile.
 * Exported so the connect flow can persist a per-account passToken into the
 * connection's providerSpecificData — this is what enables multi-account rotation.
 * @returns {Promise<{passToken:string, userId:string|null, cUserId:string|null}|null>}
 */
export async function readDesktopPassToken() {
  try {
    const jar = await readDesktopAccountCookies();
    if (!jar?.passToken) return null;
    return { passToken: jar.passToken, userId: jar.userId || null, cUserId: jar.cUserId || null };
  } catch {
    return null;
  }
}

function signatureClientSign(nonce, ssecurity) {
  const input = `nonce=${nonce}` + (ssecurity && ssecurity.trim() ? `&${ssecurity}` : "");
  return encodeURIComponent(crypto.createHash("sha1").update(input).digest("base64"));
}

function absorbSetCookie(jar, res) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const m = /^([^=]+)=([^;]*)/.exec(c.trim());
    if (m && m[2]) jar[m[1]] = m[2];
  }
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * Exchange a passToken for a mimo-server service session cookie.
 * @returns {Promise<string|null>} Cookie header value, or null on failure.
 */
async function acquireServiceCookie(passJar, proxyOptions) {
  const jar = { ...passJar };
  const ck = () => cookieHeader(jar);

  // 1. Unauthenticated API call -> 302 carrying the sts callback (sid=mimopc)
  const r1 = await proxyAwareFetch(
    `${API_BASE}/api/user/xiaomi/me`,
    { redirect: "manual", headers: { "User-Agent": API_UA, Cookie: ck() } },
    proxyOptions,
  );
  const redirect = r1.headers.get("location");
  if (!redirect) return null;
  const stsCallback = new URL(redirect).searchParams.get("callback");
  if (!stsCallback) return null;

  // 2. passportapi SSO phase 1 -> nonce + ssecurity
  const sso1 = await proxyAwareFetch(
    `https://${ACCOUNT_HOST}/pass/serviceLogin?sid=passportapi&_json=true`,
    { headers: { Cookie: ck(), "User-Agent": SSO_UA, Accept: "application/json" } },
    proxyOptions,
  );
  const j1 = JSON.parse((await sso1.text()).replace(/^&&&START&&&/, ""));
  const nonce = j1.nonce || (j1.location ? new URL(j1.location).searchParams.get("nonce") : null);
  if (!nonce || !j1.location) return null;

  // 3. passportapi SSO phase 2 -> account-level serviceToken
  const sso2 = await proxyAwareFetch(
    `${j1.location}&clientSign=${signatureClientSign(nonce, j1.ssecurity)}`,
    { redirect: "manual", headers: { Cookie: ck(), "User-Agent": SSO_UA } },
    proxyOptions,
  );
  absorbSetCookie(jar, sso2);

  // 4. mimopc SSO -> sts callback carrying a ticket
  const sso3 = await proxyAwareFetch(
    `https://${ACCOUNT_HOST}/pass/serviceLogin?sid=mimopc&callback=${encodeURIComponent(stsCallback)}&_json=true`,
    { headers: { Cookie: ck(), "User-Agent": SSO_UA, Accept: "application/json" } },
    proxyOptions,
  );
  const j3 = JSON.parse((await sso3.text()).replace(/^&&&START&&&/, ""));
  absorbSetCookie(jar, sso3);
  if (!j3?.location || !/\/api\/sts/.test(j3.location)) return null;

  // 5. sts callback -> Set-Cookie: serviceToken (mimopc scope)
  const sts = await proxyAwareFetch(
    j3.location,
    { redirect: "manual", headers: { "User-Agent": API_UA, Cookie: ck() } },
    proxyOptions,
  );
  absorbSetCookie(jar, sts);

  if (!jar.serviceToken) return null;
  const needed = ["serviceToken", "mimopc_ph", "mimopc_slh", "userId"];
  const out = {};
  for (const k of needed) if (jar[k]) out[k] = jar[k];
  return cookieHeader(out);
}

/**
 * Get (and cache) the mimo-server account cookie.
 * @param {object|null} providerSpecificData - may carry `mimoPassToken` override
 */
async function getServiceCookie(providerSpecificData, proxyOptions) {
  const passJar = providerSpecificData?.mimoPassToken
    ? {
        passToken: providerSpecificData.mimoPassToken,
        userId: providerSpecificData.mimoUserId,
        cUserId: providerSpecificData.mimoCUserId,
      }
    : await readDesktopAccountCookies();
  if (!passJar?.passToken) return { cookie: null, reason: "no-pass-token" };

  // One cached session per passToken — accounts/connections rotate independently.
  const key = crypto.createHash("sha256").update(passJar.passToken).digest("hex");

  const cached = _cache.get(key);
  if (cached && Date.now() - cached.at < COOKIE_TTL_MS) {
    return { cookie: cached.cookie };
  }

  const inflight = _inflight.get(key);
  if (inflight) {
    const cookie = await inflight;
    return cookie ? { cookie } : { cookie: null, reason: "sso-failed" };
  }

  const promise = (async () => {
    try {
      return await acquireServiceCookie(passJar, proxyOptions);
    } catch {
      return null;
    } finally {
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, promise);

  const cookie = await promise;
  if (!cookie) return { cookie: null, reason: "sso-failed" };
  _cache.set(key, { cookie, at: Date.now() });
  return { cookie };
}

/** Drop cached sessions so the next call re-runs the handshake (e.g. after a 401). */
export function invalidateMimoAccountCookieCache() {
  _cache.clear();
}

/** mimo-server account API base + the User-Agent its backend expects. */
export const MIMO_API_BASE = API_BASE;
export const MIMO_API_UA = API_UA;

/**
 * Resolve the mimo-server account-session cookie, for upstream /api/route/* calls.
 * @returns {Promise<string|null>} Cookie header value, or null when unavailable.
 */
export async function getMimoAccountCookie(providerSpecificData = null, proxyOptions = null) {
  try {
    const { cookie } = await getServiceCookie(providerSpecificData, proxyOptions);
    return cookie;
  } catch {
    return null;
  }
}

/**
 * Fetch the weekly quota from the account service.
 * @returns {Promise<{percent?:number, resetDate?:string, resetAt?:number, error?:string}>}
 */
export async function getMimoAccountUsage(providerSpecificData = null, proxyOptions = null) {
  const { cookie, reason } = await getServiceCookie(providerSpecificData, proxyOptions);
  if (!cookie) {
    return { error: reason === "no-pass-token" ? "no-session" : "session-failed" };
  }
  try {
    const res = await proxyAwareFetch(
      `${API_BASE}/api/user/usage`,
      {
        headers: { "User-Agent": API_UA, Cookie: cookie, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      },
      proxyOptions,
    );
    if (!res.ok) return { error: `http-${res.status}` };
    const data = await res.json().catch(() => null);
    if (!data || data.code !== 0 || !data.data) return { error: "bad-response" };
    return { percent: data.data.percent, resetDate: data.data.resetDate, resetAt: data.data.resetAt };
  } catch (e) {
    return { error: e.message };
  }
}
