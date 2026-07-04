import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import vm from "node:vm";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// DuckDuckGoWebExecutor — anonymous free reverse of duckduckgo.com/duckchat AI Chat.
//
// Authentication flow:
//   1. GET /duckchat/v1/status → x-vqd-4 header (direct VQD token) OR x-vqd-hash-1 (challenge)
//   2. When x-vqd-hash-1 is present, solve the base64 JS challenge in a node:vm sandbox
//      (browser-fingerprint stubs) to derive a valid hash.
//   3. POST /duckchat/v1/chat with the VQD header + browser-like headers.
//   4. Parse the NDJSON SSE stream and translate to OpenAI format.
//
// Auth input: NONE — anonymous. VQD tokens are per-request; no credentials needed.
// Plain text chat only — tool/function-calling is intentionally NOT supported.
//
// NOTE: This is a self-contained port. OmniRoute's original additionally supported a session
// pool, browser-backed (Playwright) chat, and tool-calling; none of that infra exists in
// ExtremeRouter, so it is stripped here. The node:vm challenge solver + node:crypto are kept
// (both are Node/Bun builtins). parse5 (an OmniRoute dep) is replaced by a regex-based HTML
// element counter — the stub only needs approximate child-element counts.

const DUCKDUCKGO_BASE = PROVIDERS["duckduckgo-web"].baseUrl; // https://duckduckgo.com
const AUTH_TOKEN_URL = `${DUCKDUCKGO_BASE}/duckchat/v1/auth/token`;
const COUNTRY_URL = `${DUCKDUCKGO_BASE}/country.json`;
const STATUS_URL = `${DUCKDUCKGO_BASE}/duckchat/v1/status`;
const CHAT_URL = `${DUCKDUCKGO_BASE}/duckchat/v1/chat`;
const DEFAULT_FE_VERSION = "serp_20260424_180649_ET-0bdc33b2a02ebf8f235def65d887787f694720a1";
// The real served x-fe-version token has a 20-hex tail; bounded {20,40} keeps it ReDoS-safe.
const FE_VERSION_PATTERN = /serp_\d{8}_\d{6}_[A-Z]{2}-[0-9a-f]{20,40}/;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const FAKE_HEADERS = {
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Origin: DUCKDUCKGO_BASE,
  Pragma: "no-cache",
  Referer: `${DUCKDUCKGO_BASE}/`,
  Priority: "u=1, i",
  "Sec-Ch-Ua": '"Chromium";v="149", "Not-A.Brand";v="24", "Google Chrome";v="149"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Linux"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent": DEFAULT_USER_AGENT,
};

const SEEDED_COOKIES = [
  ["5", "1"],
  ["ah", "wt-wt"],
  ["dcs", "1"],
  ["dcm", "3"],
  ["isRecentChatOn", "1"],
];

const FETCH_TIMEOUT_MS = 30_000;

function errorResponse(status, message, code) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code: code || `HTTP_${status}` } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// ─── Cookie jar helpers (inlined) ───────────────────────────────────────────
function splitSetCookieHeader(header) {
  const cookies = [];
  let start = 0;
  for (let index = 0; index < header.length; index++) {
    if (header[index] !== ",") continue;
    const rest = header.slice(index + 1);
    if (/^\s*[^=;\s]+\s*=/.test(rest)) {
      cookies.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  cookies.push(header.slice(start).trim());
  return cookies.filter(Boolean);
}

function collectSetCookieHeaders(headers) {
  const getSetCookie = headers.getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(headers);
  const combined = headers.get("set-cookie");
  return combined ? splitSetCookieHeader(combined) : [];
}

function applySetCookie(cookieJar, setCookie) {
  const pair = setCookie.split(";", 1)[0]?.trim();
  if (!pair) return;
  const separator = pair.indexOf("=");
  if (separator <= 0) return;
  cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
}

function serializeCookieJar(cookieJar) {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function mergeHeadersCaseInsensitive(...sources) {
  const merged = {};
  const canonicalNames = new Map();
  for (const source of sources) {
    if (!source) continue;
    for (const [name, value] of Object.entries(source)) {
      const lowerName = name.toLowerCase();
      const previousName = canonicalNames.get(lowerName);
      if (previousName) delete merged[previousName];
      canonicalNames.set(lowerName, name);
      merged[name] = value;
    }
  }
  return merged;
}

// ─── Model normalization ────────────────────────────────────────────────────
function normalizeDuckDuckGoModel(model) {
  if (!model) return "gpt-4o-mini";
  const clean = model.startsWith("duckduckgo-web/") ? model.slice("duckduckgo-web/".length) : model;
  if (clean === "claude-3-5-haiku-20241022") return "claude-haiku-4-5";
  if (clean === "llama-4-scout") return "meta-llama/Llama-4-Scout-17B-16E-Instruct";
  if (clean === "mistral-small-2501") return "mistral-small-2603";
  if (clean === "gpt-oss-120b") return "tinfoil/gpt-oss-120b";
  return clean;
}

function getDuckDuckGoModelCapabilities(model) {
  if (model === "gpt-5-mini") return { reasoningEffort: "minimal" };
  if (model === "claude-haiku-4-5") return { reasoningEffort: "low" };
  if (model === "tinfoil/gpt-oss-120b") return { reasoningEffort: "low" };
  return { reasoningEffort: null };
}

// ─── Response parsing helpers ───────────────────────────────────────────────
function extractDuckDuckGoContent(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.content === "string") return data.content;
  if (typeof data.message === "string") return data.message;
  return "";
}

function parseDuckDuckGoDataLine(line) {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6));
  } catch {
    return null;
  }
}

function parseDuckDuckGoError(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function normalizeDuckDuckGoError(status, body) {
  const parsed = parseDuckDuckGoError(body);
  if (parsed) {
    const type = typeof parsed.type === "string" ? parsed.type : "";
    const overrideCode = typeof parsed.overrideCode === "string" ? parsed.overrideCode : "";
    if (type === "ERR_CHALLENGE" || type === "ERR_BN_LIMIT") {
      const codeSuffix = overrideCode ? ` (${overrideCode})` : "";
      return (
        `DuckDuckGo AI Chat anti-abuse challenge failed: ${type}${codeSuffix}. ` +
        "Retry later or from a less rate-limited IP; DuckDuckGo is rejecting this anonymous session."
      );
    }
    if (type) return `DuckDuckGo AI Chat error: ${type}`;
  }
  return `DuckDuckGo AI Chat returned HTTP ${status}`;
}

// ─── HTML lookup (parse5-free) ──────────────────────────────────────────────
// The challenge stub needs an approximate child-element count per innerHTML key. parse5 isn't
// available here, so count opening tags via regex — sufficient for the mock querySelectorAll('*').
function countHtmlElements(html) {
  const matches = String(html || "").match(/<[a-zA-Z][^>/]*(?:\/>|>)/g);
  return matches ? matches.length : 0;
}

function buildHtmlLookup(js) {
  const lookup = {};
  const seen = new Set();
  const pattern = /(['"])(<[^'"]{1,400}?)\1/g;
  for (const match of js.matchAll(pattern)) {
    const html = match[2];
    if (seen.has(html)) continue;
    seen.add(html);
    lookup[html] = {
      html, // keep original string verbatim (parse5 serialize unavailable, not needed by stub)
      count: Math.max(0, countHtmlElements(html)),
    };
  }
  return lookup;
}

// ─── Challenge solver (node:crypto + node:vm) ───────────────────────────────
function sha256Base64(value) {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

// DOM stub the challenge code runs against. The challenge probes window/navigator/document
// fingerprinting surface; this mocks enough of it to return client_hashes.
// SECURITY: executes base64-decoded JS from duck.ai via vm.runInContext (upstream-supplied,
// sandboxed with a 5s timeout to limit DoS risk). Intentional for the DDG challenge solver.
const CHALLENGE_STUBS = String.raw`
var __ua = __DDG_REAL_UA__;
var __HTML_LOOKUP = __DDG_HTML_LOOKUP__;
function __makeHtmlElement(tag) {
  var state = { _innerHTML: '', _qsaCount: 0, _cssText: '' };
  var el = {
    tagName: String(tag).toUpperCase(), nodeName: String(tag).toUpperCase(), nodeType: 1,
    children: [], childNodes: [], classList: [], dataset: {},
    offsetWidth: 1, offsetHeight: 1, clientWidth: 1, clientHeight: 1, scrollHeight: 1, scrollWidth: 1,
    getBoundingClientRect: function(){ return { x: 0, y: 0, top: 0, left: 0, right: 1, bottom: 1, width: 1, height: 1, toJSON: function(){ return {}; } }; },
    setAttribute: function(){}, removeAttribute: function(){},
    getAttribute: function(a){ if(a==='srcdoc') return state._srcdoc||''; return null; },
    hasAttribute: function(){ return false; }, appendChild: function(c){ return c; }, removeChild: function(c){ return c; },
    addEventListener: function(){}, removeEventListener: function(){}, querySelector: function(){ return null; },
    querySelectorAll: function(s){ if (s === '*') { var arr = []; arr.length = state._qsaCount; return arr; } return []; },
    cloneNode: function(){ return __makeHtmlElement(tag); }
  };
  Object.defineProperty(el, 'style', { value: new Proxy({}, { set: function(t, k, v){ t[k] = v; if (k === 'cssText') state._cssText = String(v); return true; }, get: function(t, k){ if (k === 'cssText') return state._cssText; return t[k] || ''; } }), enumerable: true, configurable: true });
  Object.defineProperty(el, 'innerHTML', { get: function(){ return state._innerHTML; }, set: function(v){ var key = String(v); var entry = __HTML_LOOKUP && __HTML_LOOKUP[key]; if (entry) { state._innerHTML = String(entry.html); state._qsaCount = entry.count|0; } else { state._innerHTML = key; state._qsaCount = 0; } }, enumerable: true, configurable: true });
  Object.defineProperty(el, 'outerHTML', { get: function(){ return '<' + tag + '>' + state._innerHTML + '</' + tag + '>'; }, enumerable: true });
  Object.defineProperty(el, 'srcdoc', { get: function(){ return state._srcdoc||''; }, set: function(v){ state._srcdoc = String(v); }, enumerable: true });
  Object.defineProperty(el, 'contentWindow', { get: function(){ var w = {}; w.document = __ifDoc; w.Proxy = Proxy; w.self = w; w.top = w; w.parent = w; w.window = w; return w; }, enumerable: true });
  Object.defineProperty(el, 'contentDocument', { get: function(){ return __ifDoc; }, enumerable: true });
  return el;
}
function __mkObj(name, base) {
  base = base || {};
  return new Proxy(base, {
    get: function(t, k) {
      if (k in t) return t[k];
      if (k === Symbol.toPrimitive) return function(){ return ''; };
      if (k === Symbol.iterator) return undefined;
      if (k === 'then' || k === 'catch' || k === 'finally') return undefined;
      if (k === 'constructor') return Object;
      if (k === 'toString' || k === 'valueOf') return function(){ return '[object ' + name + ']'; };
      if (k === 'length') return 0;
      if (k === 'nodeType') return 1;
      if (k === 'tagName' || k === 'nodeName') return 'DIV';
      if (k === 'innerHTML' || k === 'outerHTML' || k === 'textContent' || k === 'innerText' || k === 'value') return '';
      if (k === 'children' || k === 'childNodes' || k === 'classList') return [];
      if (k === 'offsetWidth' || k === 'offsetHeight' || k === 'clientWidth' || k === 'clientHeight' || k === 'scrollHeight' || k === 'scrollWidth') return 1;
      if (k === 'getBoundingClientRect') return function(){ return { x: 0, y: 0, top: 0, left: 0, right: 1, bottom: 1, width: 1, height: 1, toJSON: function(){ return {}; } }; };
      if (typeof k === 'string' && (k.indexOf('get') === 0 || k.indexOf('query') === 0 || k.indexOf('find') === 0)) return function(){ return k === 'querySelectorAll' || k === 'getElementsByTagName' || k === 'getElementsByClassName' ? [] : null; };
      return function(){ return __mkObj(name + '.' + String(k)); };
    },
    has: function(t, k){ return k in t; }, set: function(t, k, v){ t[k] = v; return true; }
  });
}
function __parseCssDisplay(cssText){ if(!cssText) return ''; var m = String(cssText).match(/(?:^|;)\s*display\s*:\s*([^;]+)/i); return m ? String(m[1]).trim() : ''; }
function __getComputedStyle(el){ var cssText = el && el.style && el.style.cssText || ''; var display = __parseCssDisplay(cssText); return { getPropertyValue: function(name){ if(String(name).toLowerCase()==='display') return display; return ''; }, cssText: cssText, display: display }; }
var __ifMeta = __mkObj('meta', { getAttribute: function(a){ return a==='content' ? "default-src 'none'; script-src 'unsafe-inline';" : null; }, hasAttribute: function(a){ return a==='content'; }, tagName: 'META', nodeName: 'META' });
var __ifDoc = __mkObj('iframeDoc', { querySelector: function(s){ if (s && s.indexOf('Content-Security-Policy') !== -1) return __ifMeta; if (s === 'meta') return __ifMeta; return null; }, querySelectorAll: function(s){ if (s && s.indexOf('Content-Security-Policy') !== -1) return [__ifMeta]; if (s === 'meta') return [__ifMeta]; return []; }, getElementsByTagName: function(t){ return t && t.toLowerCase()==='meta' ? [__ifMeta] : []; }, body: __mkObj('iframeBody'), head: __mkObj('iframeHead'), documentElement: __mkObj('iframeRoot'), createElement: function(){ return __mkObj('elem', {setAttribute:function(){}, appendChild:function(){}, removeChild:function(){}, getAttribute:function(){return null;}, hasAttribute:function(){return false;}}); }, cookie: '', readyState: 'complete' });
var __iframeEl = __mkObj('iframe', { contentDocument: __ifDoc, contentWindow: __mkObj('iframeWin', { document: __ifDoc, top: undefined, parent: undefined }), document: __ifDoc, getAttribute: function(a){ if (a==='sandbox') return 'allow-scripts allow-same-origin'; if (a==='srcdoc') return ''; if (a==='id') return 'jsa'; return null; }, hasAttribute: function(a){ return a==='sandbox'||a==='id'; }, tagName: 'IFRAME', nodeName: 'IFRAME', id: 'jsa' });
var document = __mkObj('document', { querySelector: function(s){ if (s === '#jsa') return __iframeEl; if (s && s.indexOf('Content-Security-Policy') !== -1) return __ifMeta; return null; }, querySelectorAll: function(s){ if (s === '#jsa') return [__iframeEl]; if (s && s.indexOf('Content-Security-Policy') !== -1) return [__ifMeta]; return []; }, getElementById: function(id){ return id==='jsa' ? __iframeEl : null; }, getElementsByTagName: function(t){ if(t&&t.toLowerCase()==='iframe') return [__iframeEl]; return []; }, getElementsByClassName: function(){ return []; }, body: __mkObj('body', {appendChild:function(){}, removeChild:function(){}, querySelector:function(s){return s==='#jsa'?__iframeEl:null;}, querySelectorAll:function(s){return s==='#jsa'?[__iframeEl]:[];}}), head: __mkObj('head'), documentElement: __mkObj('root'), createElement: function(tag){ return __makeHtmlElement(tag||'div'); }, createTextNode: function(t){ return {nodeType:3, nodeValue:String(t||''), textContent:String(t||'')}; }, cookie: '', readyState: 'complete', title: '', addEventListener: function(){}, removeEventListener: function(){} });
  var window = __mkObj('window', { document: document, __DDG_BE_VERSION__: 1, __DDG_FE_CHAT_HASH__: 1, navigator: __mkObj('navigator', { userAgent: __ua, webdriver: false, language: 'en-US', languages: ['en-US','en'], platform: 'Linux x86_64', vendor: 'Google Inc.', appVersion: '5.0 (X11)', cookieEnabled: true, onLine: true, hardwareConcurrency: 8, deviceMemory: 8 }), innerWidth: 1280, innerHeight: 800, outerWidth: 1280, outerHeight: 800, devicePixelRatio: 1, screen: __mkObj('screen', { width:1920, height:1080, availWidth:1920, availHeight:1080, colorDepth:24, pixelDepth:24 }), location: __mkObj('location', { href:'https://duck.ai/', origin:'https://duck.ai', host:'duck.ai', hostname:'duck.ai', protocol:'https:', pathname:'/' }), performance: __mkObj('perf', { now: function(){ return 0; }, timeOrigin: 0 }), history: __mkObj('history', { length: 1, state: null }), addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){return true;}, setTimeout: function(fn){ try{fn();}catch(e){} return 0; }, clearTimeout: function(){}, hasOwnProperty: function(k){ if (k==='__DDG_BE_VERSION__'||k==='__DDG_FE_CHAT_HASH__') return true; return Object.prototype.hasOwnProperty.call(this,k); } });
window.top = window; window.self = window; window.window = window; window.parent = window; window.globalThis = window;
var top = window, self = window, parent = window, navigator = window.navigator, location = window.location, screen = window.screen, performance = window.performance, history = window.history;
var __R = null, __E = null;
function __HTMLClass(name){ var c = function(){}; c.prototype = __mkObj(name+'.proto'); return c; }
var HTMLElement = __HTMLClass('HTMLElement'), HTMLDivElement = __HTMLClass('HTMLDivElement'), HTMLIFrameElement = __HTMLClass('HTMLIFrameElement'), HTMLDocument = __HTMLClass('HTMLDocument'), Document = __HTMLClass('Document'), Element = __HTMLClass('Element'), Node = __HTMLClass('Node'), Window = __HTMLClass('Window'), Event = __HTMLClass('Event'), MouseEvent = __HTMLClass('MouseEvent'), KeyboardEvent = __HTMLClass('KeyboardEvent'), TouchEvent = __HTMLClass('TouchEvent'), XMLHttpRequest = __HTMLClass('XMLHttpRequest'), WebSocket = __HTMLClass('WebSocket'), Image = __HTMLClass('Image'), FormData = __HTMLClass('FormData'), Blob = __HTMLClass('Blob'), File = __HTMLClass('File'), FileReader = __HTMLClass('FileReader'), URL = __HTMLClass('URL'), URLSearchParams = __HTMLClass('URLSearchParams'), Headers = __HTMLClass('Headers'), Request = __HTMLClass('Request'), Response = __HTMLClass('Response');
var fetch = function(){ return Promise.resolve(__mkObj('resp', {ok:true, status:200, json:function(){return Promise.resolve({});}, text:function(){return Promise.resolve('');}})); };
var getComputedStyle = __getComputedStyle;
`;

async function solveDuckDuckGoChallenge(challenge, userAgent) {
  const js = Buffer.from(challenge, "base64").toString("utf8");
  const stubs = CHALLENGE_STUBS.replace("__DDG_REAL_UA__", JSON.stringify(userAgent)).replace(
    "__DDG_HTML_LOOKUP__",
    JSON.stringify(buildHtmlLookup(js))
  );
  const context = vm.createContext({});
  vm.runInContext(stubs, context, { timeout: 5000 });
  const result = await vm.runInContext(js, context, { timeout: 5000 });
  const clientHashes = Array.isArray(result.client_hashes) ? result.client_hashes : [];
  if (clientHashes.length === 0) {
    throw new Error("DuckDuckGo challenge returned empty client_hashes");
  }
  clientHashes[0] = userAgent;
  result.client_hashes = clientHashes.map((hash) => sha256Base64(String(hash)));
  return Buffer.from(JSON.stringify(result), "utf8").toString("base64");
}

function makeDuckDuckGoFeSignals() {
  const start = Date.now() - 3000;
  let delta = 80 + Math.floor(Math.random() * 101);
  const events = [{ name: "onboarding_impression_1", delta }];
  delta += 120 + Math.floor(Math.random() * 141);
  events.push({ name: "onboarding_impression_2", delta });
  delta += 200 + Math.floor(Math.random() * 301);
  events.push({ name: "startNewChat", delta });
  const keyEvents = 6 + Math.floor(Math.random() * 13);
  for (let i = 0; i < keyEvents; i++) {
    delta += 40 + Math.floor(Math.random() * 141);
    events.push({ name: "user_input", delta });
  }
  delta += 120 + Math.floor(Math.random() * 231);
  events.push({ name: "user_submit", delta });
  const payload = {
    start,
    events,
    end: Math.max(delta + 20 + Math.floor(Math.random() * 71), 3000),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function extractDuckDuckGoFeVersion(html) {
  return html.match(FE_VERSION_PATTERN)?.[0] ?? null;
}

// Durable RSA public key for the durableStream payload (generated once, reused).
let durablePublicKey = null;
function getDurablePublicKey() {
  if (!durablePublicKey) {
    const { publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicExponent: 0x10001,
    });
    durablePublicKey = {
      ...publicKey.export({ format: "jwk" }),
      alg: "RSA-OAEP-256",
      ext: true,
      key_ops: ["encrypt"],
      use: "enc",
    };
  }
  return durablePublicKey;
}

function buildDuckDuckGoPayload(model, messages) {
  const capabilities = getDuckDuckGoModelCapabilities(model);
  return {
    model,
    metadata: {
      toolChoice: { NewsSearch: false, VideosSearch: false, LocalSearch: false, WeatherForecast: false },
    },
    messages,
    canUseTools: false,
    ...(capabilities.reasoningEffort ? { reasoningEffort: capabilities.reasoningEffort } : {}),
    canUseApproxLocation: null,
    canDelegateImageGeneration: null,
    durableStream: {
      messageId: randomUUID(),
      conversationId: randomUUID(),
      publicKey: getDurablePublicKey(),
    },
  };
}

// ─── Response processing ────────────────────────────────────────────────────
async function processResponse(response, streaming, model, cid, created, signal) {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return errorResponse(response.status, normalizeDuckDuckGoError(response.status, body), `HTTP_${response.status}`);
  }

  if (streaming) {
    if (!response.body) {
      return errorResponse(502, "DuckDuckGo returned an empty response body", "EMPTY_BODY");
    }

    const encoder = new TextEncoder();
    let emittedRole = false;
    const decoder = new TextDecoder();

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === "data: [DONE]") {
            controller.enqueue(encoder.encode(SSE_DONE));
            continue;
          }
          const data = parseDuckDuckGoDataLine(trimmed.startsWith("data: ") ? trimmed : `data: ${trimmed}`);
          const content = extractDuckDuckGoContent(data);
          if (content) {
            if (!emittedRole) {
              emittedRole = true;
              controller.enqueue(
                encoder.encode(
                  sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
                  })
                )
              );
            }
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                  choices: [{ index: 0, delta: { content }, finish_reason: null, logprobs: null }],
                })
              )
            );
          }
        }
      },
      flush(controller) {
        if (!emittedRole) {
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null, logprobs: null }],
              })
            )
          );
        }
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      },
    });

    const transformedBody = response.body.pipeThrough(transformStream);
    return new Response(transformedBody, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } });
  }

  // Non-streaming: aggregate the NDJSON stream.
  const text = await response.text().catch(() => "");
  let fullContent = "";
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]") continue;
    fullContent += extractDuckDuckGoContent(parseDuckDuckGoDataLine(trimmed.startsWith("data: ") ? trimmed : `data: ${trimmed}`));
  }

  const completionTokens = Math.max(1, Math.ceil(fullContent.length / 4));
  return new Response(
    JSON.stringify({
      id: cid,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [
        { index: 0, message: { role: "assistant", content: fullContent }, finish_reason: "stop", logprobs: null },
      ],
      usage: {
        prompt_tokens: completionTokens,
        completion_tokens: completionTokens,
        total_tokens: completionTokens * 2,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ─── Executor ───────────────────────────────────────────────────────────────
export class DuckDuckGoWebExecutor extends BaseExecutor {
  constructor() {
    super("duckduckgo-web", PROVIDERS["duckduckgo-web"]);
    this.warmed = false;
    this.seeded = false;
    this.feVersion = DEFAULT_FE_VERSION;
    this.pendingVqdHash1 = null;
    this.cookieJar = new Map();
  }

  buildRequestHeaders(extra = {}) {
    const headers = { ...FAKE_HEADERS, ...extra };
    const cookie = serializeCookieJar(this.cookieJar);
    return cookie ? { ...headers, Cookie: cookie } : headers;
  }

  rememberResponseCookies(response) {
    for (const cookie of collectSetCookieHeaders(response.headers)) {
      applySetCookie(this.cookieJar, cookie);
    }
  }

  rememberChallengeHeader(response) {
    const nextHash = response.headers.get("x-vqd-hash-1");
    if (nextHash) this.pendingVqdHash1 = nextHash;
  }

  seedBrowserCookies() {
    for (const [name, value] of SEEDED_COOKIES) {
      if (!this.cookieJar.has(name)) this.cookieJar.set(name, value);
    }
  }

  async warmFetch(url, headers, signal, proxyOptions) {
    try {
      const response = await proxyAwareFetch(url, { headers, signal }, proxyOptions);
      this.rememberResponseCookies(response);
      return response;
    } catch {
      return null;
    }
  }

  // Warm the session: fetch homepage (to scrape x-fe-version), country, auth token, and the
  // AI Chat landing page so the cookie jar looks browser-like.
  async warmSession(signal, proxyOptions) {
    if (this.warmed || signal?.aborted) return;
    this.warmed = true;
    this.seedBrowserCookies();
    const homepageResponse = await this.warmFetch(
      `${DUCKDUCKGO_BASE}/`,
      this.buildRequestHeaders({
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      }),
      signal,
      proxyOptions
    );
    if (homepageResponse) {
      try {
        const homepageHtml = await homepageResponse.clone().text();
        const feVersion = extractDuckDuckGoFeVersion(homepageHtml);
        if (feVersion) this.feVersion = feVersion;
      } catch { /* non-fatal */ }
    }
    await this.warmFetch(COUNTRY_URL, this.buildRequestHeaders({ Accept: "*/*" }), signal, proxyOptions);
    await this.warmFetch(AUTH_TOKEN_URL, this.buildRequestHeaders({ Accept: "*/*" }), signal, proxyOptions);
    await this.warmFetch(
      `${DUCKDUCKGO_BASE}/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1`,
      this.buildRequestHeaders({
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Origin: DUCKDUCKGO_BASE,
        Referer: `${DUCKDUCKGO_BASE}/`,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      }),
      signal,
      proxyOptions
    );
  }

  async acquireVqdHeaders(signal, proxyOptions) {
    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const resp = await proxyAwareFetch(
        STATUS_URL,
        {
          method: "GET",
          headers: this.buildRequestHeaders({ Accept: "*/*", "Cache-Control": "no-store", "x-vqd-accept": "1" }),
          signal,
        },
        proxyOptions
      );
      this.rememberResponseCookies(resp);
      if (!resp.ok) return { vqd4: null, vqdHash1: null };
      return {
        vqd4: resp.headers.get("x-vqd-4"),
        vqdHash1: resp.headers.get("x-vqd-hash-1"),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      return { vqd4: null, vqdHash1: null };
    }
  }

  async acquireAuthHeaders(signal, proxyOptions) {
    if (this.pendingVqdHash1) {
      const challenge = this.pendingVqdHash1;
      this.pendingVqdHash1 = null;
      try {
        return { vqd4: null, vqdHash1: await solveDuckDuckGoChallenge(challenge, FAKE_HEADERS["User-Agent"]) };
      } catch { /* fall through to status fetch */ }
    }
    const headers = await this.acquireVqdHeaders(signal, proxyOptions);
    if (headers.vqdHash1) {
      try {
        return {
          vqd4: headers.vqd4,
          vqdHash1: await solveDuckDuckGoChallenge(headers.vqdHash1, FAKE_HEADERS["User-Agent"]),
        };
      } catch {
        return headers;
      }
    }
    return headers;
  }

  // Seed the challenge chain with a throwaway "hi" message so a fresh VQD hash is stashed
  // for the next real request (DDG's anti-abuse expects a warmed challenge token).
  async seedChallengeChain(model, signal, proxyOptions) {
    if (this.seeded || signal?.aborted) return;
    this.seeded = true;
    const seedMessages = [{ role: "user", content: "hi" }];
    const previousPending = this.pendingVqdHash1;
    try {
      const vqdHeaders = await this.acquireAuthHeaders(signal, proxyOptions);
      if (!vqdHeaders.vqd4 && !vqdHeaders.vqdHash1) {
        this.pendingVqdHash1 = previousPending;
        return;
      }
      const response = await proxyAwareFetch(
        CHAT_URL,
        {
          method: "POST",
          headers: mergeHeadersCaseInsensitive(this.buildRequestHeaders(), {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            "x-ddg-journey-id": randomUUID().replaceAll("-", ""),
            "x-fe-signals": makeDuckDuckGoFeSignals(),
            "x-fe-version": this.feVersion,
            ...(vqdHeaders.vqd4 ? { "x-vqd-4": vqdHeaders.vqd4 } : {}),
            ...(vqdHeaders.vqdHash1 ? { "x-vqd-hash-1": vqdHeaders.vqdHash1 } : {}),
          }),
          body: JSON.stringify(buildDuckDuckGoPayload(model, seedMessages)),
          signal,
        },
        proxyOptions
      );
      this.rememberResponseCookies(response);
      if (response.ok) this.rememberChallengeHeader(response);
      else this.pendingVqdHash1 = previousPending;
      await response.body?.cancel().catch(() => {});
    } catch {
      this.pendingVqdHash1 = previousPending;
    }
  }

  async execute({ model, body, stream, signal, log, proxyOptions }) {
    const upstreamModel = normalizeDuckDuckGoModel(model);
    const bodyObj = body || {};
    const rawMessages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    const messages = rawMessages.map((m) => {
      let content = "";
      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content
          .filter((c) => c && (c.type === "text" || c.type === "input_text"))
          .map((c) => String(c.text || ""))
          .join("\n");
      }
      return { role: String(m.role || "user"), content };
    });
    const isStreaming = stream !== false;

    if (messages.length === 0) {
      return {
        response: errorResponse(400, "No messages provided", "INVALID_REQUEST"),
        url: CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

    const cid = `chatcmpl-ddg-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    try {
      const sendChat = async (vqdHeaders) => {
        const payload = buildDuckDuckGoPayload(upstreamModel, messages);
        const response = await proxyAwareFetch(
          CHAT_URL,
          {
            method: "POST",
            headers: mergeHeadersCaseInsensitive(this.buildRequestHeaders(), {
              Accept: "text/event-stream",
              "Content-Type": "application/json",
              "x-ddg-journey-id": randomUUID().replaceAll("-", ""),
              "x-fe-signals": makeDuckDuckGoFeSignals(),
              "x-fe-version": this.feVersion,
              ...(vqdHeaders.vqd4 ? { "x-vqd-4": vqdHeaders.vqd4 } : {}),
              ...(vqdHeaders.vqdHash1 ? { "x-vqd-hash-1": vqdHeaders.vqdHash1 } : {}),
            }),
            body: JSON.stringify(payload),
            signal: mergedSignal,
          },
          proxyOptions
        );
        this.rememberResponseCookies(response);
        this.rememberChallengeHeader(response);
        return response;
      };

      if (mergedSignal.aborted) {
        return {
          response: errorResponse(499, "Request cancelled", "ABORTED"),
          url: CHAT_URL,
          headers: {},
          transformedBody: body,
        };
      }

      await this.warmSession(mergedSignal, proxyOptions);
      await this.seedChallengeChain(upstreamModel, mergedSignal, proxyOptions);
      let vqdHeaders = await this.acquireAuthHeaders(mergedSignal, proxyOptions);
      if (!vqdHeaders.vqd4 && !vqdHeaders.vqdHash1) {
        return {
          response: errorResponse(503, "Failed to acquire VQD token", "NO_VQD"),
          url: STATUS_URL,
          headers: {},
          transformedBody: body,
        };
      }

      let chatResponse = await sendChat(vqdHeaders);

      // 418 (anti-abuse) / 401 / 403 → refresh the VQD token once and retry.
      if (chatResponse.status === 418 || chatResponse.status === 401 || chatResponse.status === 403) {
        this.pendingVqdHash1 = null;
        vqdHeaders = await this.acquireAuthHeaders(mergedSignal, proxyOptions);
        if (vqdHeaders.vqd4 || vqdHeaders.vqdHash1) {
          chatResponse = await sendChat(vqdHeaders);
        }
      }

      const result = await processResponse(chatResponse, isStreaming, model, cid, created, mergedSignal);
      return { response: result, url: CHAT_URL, headers: this.buildRequestHeaders(), transformedBody: body };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          response: errorResponse(499, "Request cancelled", "ABORTED"),
          url: CHAT_URL,
          headers: {},
          transformedBody: body,
        };
      }
      const msg = error instanceof Error ? error.message : "Unknown error";
      log?.error?.("DUCKDUCKGO-WEB", `Execute failed: ${msg}`);
      return {
        response: errorResponse(500, msg, "INTERNAL_ERROR"),
        url: CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export default DuckDuckGoWebExecutor;
