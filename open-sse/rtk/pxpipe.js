// Pxpipe — multimodal prompt compression via the pxpipe-proxy library.
//
// Renders dense Claude-format request bodies as PNG images before dispatch,
// cutting estimated input tokens by ~35-60% on token-dense contexts.
//
// Unlike Headroom (which calls an external HTTP proxy), pxpipe loads the
// npm package's library entry (transformAnthropicMessages) in-process.
// This preserves ExtremeRouter's account fallback, OAuth credential injection,
// and multi-provider routing — the package never touches the network itself.
//
// Integration follows the existing Headroom pattern:
//   - Applied to the final body in chatCore just before dispatch
//   - Fail-open on any error/timeout (never blocks a request)
//   - Only applies to Claude-format bodies above a configurable size threshold
//   - Token estimates use remaining-text/4 + pixels/750 (Anthropic image billing)
//
// Reference: github.com/pxpipe/pxpipe-proxy (transform library API)

const DEFAULT_MIN_CHARS = 25_000;
const DEFAULT_TIMEOUT_MS = 5_000;

// In-process module cache — the pxpipe package is dynamically loaded from
// DATA_DIR/pxpipe (managed install). Survives hot-reload via global.
let _pxpipeModule = null;
let _pxpipeVersion = null;

/**
 * Load the pxpipe transform module from the managed install directory.
 * Returns the module's exports or null if not installed/fail-open.
 *
 * @param {string} pxpipeDir — absolute path to the pxpipe install directory
 * @returns {Promise<object|null>}
 */
export async function loadPxpipeModule(pxpipeDir) {
  if (_pxpipeModule && _pxpipeVersion) return _pxpipeModule;
  if (!pxpipeDir) return null;

  try {
    const { createRequire } = /* @vite-ignore */ await import(/* webpackIgnore: true */ "node:module");
    const { pathToFileURL } = /* @vite-ignore */ await import(/* webpackIgnore: true */ "node:url");
    const req = createRequire(import.meta.url);
    const entryPath = req.resolve("pxpipe-proxy/transform", { paths: [pxpipeDir] });
    const mod = await /* @vite-ignore */ import(/* webpackIgnore: true */ pathToFileURL(entryPath).href);
    _pxpipeModule = mod;
    _pxpipeVersion = mod.version || "unknown";
    return mod;
  } catch {
    return null;
  }
}

/**
 * Unload the cached pxpipe module (used by /api/pxpipe/stop).
 */
export function unloadPxpipeModule() {
  _pxpipeModule = null;
  _pxpipeVersion = null;
}

/**
 * Check if the pxpipe module is loaded (for status endpoint).
 */
export function isPxpipeLoaded() {
  return _pxpipeModule !== null;
}

/**
 * Estimate the character count of a Claude-format request body's text content.
 * Only counts text blocks — not images, not tool schemas, not metadata.
 */
function estimateBodyChars(body) {
  if (!body?.messages) return 0;
  let chars = 0;
  for (const msg of body.messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && typeof block.text === "string") {
          chars += block.text.length;
        } else if (block.type === "tool_result" && typeof block.content === "string") {
          chars += block.content.length;
        } else if (block.type === "tool_result" && Array.isArray(block.content)) {
          for (const part of block.content) {
            if (part.type === "text" && typeof part.text === "string") chars += part.text.length;
          }
        }
      }
    }
  }
  return chars;
}

/**
 * Estimate input tokens from text characters + image pixels.
 * Anthropic bills: text at ~4 chars/token, images at ~750 tokens per image
 * (depending on resolution, but this is a conservative average).
 */
function estimateInputTokens(body, imageCount = 0) {
  const textChars = estimateBodyChars(body);
  return Math.ceil(textChars / 4) + imageCount * 750;
}

/**
 * Compress a Claude-format request body using pxpipe.
 *
 * Mutates `body` in place (messages replaced with image blocks where profitable).
 * Returns stats object on success, or null on any failure (fail-open).
 *
 * @param {object} body — the request body (Claude format)
 * @param {object} opts
 * @param {boolean} opts.enabled — master toggle
 * @param {string} opts.pxpipeDir — path to managed pxpipe install
 * @param {number} opts.minChars — minimum text chars to trigger compression (default: 25000)
 * @param {number} opts.timeoutMs — compression timeout (default: 5000)
 * @param {object} opts.diagnostics — optional caller-owned diagnostics object
 * @returns {Promise<object|null>} stats: { tokensBefore, tokensAfter, tokensSaved, imageCount, skipReason }
 */
export async function compressWithPxpipe(body, {
  enabled,
  pxpipeDir,
  minChars = DEFAULT_MIN_CHARS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  diagnostics = null,
} = {}) {
  const setDiag = (d, reason) => { if (d) d.reason = reason; };

  if (!enabled) { setDiag(diagnostics, "disabled"); return null; }
  if (!body?.messages) { setDiag(diagnostics, "no messages"); return null; }

  // Gate: only Claude format. pxpipe's transformAnthropicMessages expects Claude shape.
  // The caller (chatCore) should only pass Claude-format bodies.
  if (!body.messages || !Array.isArray(body.messages)) {
    setDiag(diagnostics, "not claude format");
    return null;
  }

  // Gate: size threshold. Don't compress small bodies — overhead isn't worth it.
  const charCount = estimateBodyChars(body);
  if (charCount < minChars) {
    setDiag(diagnostics, `below threshold (${charCount} < ${minChars} chars)`);
    return null;
  }

  // Load the module
  const mod = await loadPxpipeModule(pxpipeDir);
  if (!mod) {
    setDiag(diagnostics, "pxpipe not installed");
    return null;
  }

  if (typeof mod.transformAnthropicMessages !== "function") {
    setDiag(diagnostics, "pxpipe module missing transformAnthropicMessages export");
    return null;
  }

  const tokensBefore = estimateInputTokens(body, 0);

  try {
    // Race the transform against a timeout — fail-open if it takes too long.
    const result = await Promise.race([
      mod.transformAnthropicMessages(body),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("pxpipe timeout")), timeoutMs),
      ),
    ]);

    // The transform returns { messages, skipReason?, meta? } or modifies body in place.
    // Handle both patterns.
    if (result?.skipReason) {
      setDiag(diagnostics, `skipped by library: ${result.skipReason}`);
      return null;
    }

    // If the transform returned new messages, apply them.
    if (result?.messages) {
      body.messages = result.messages;
    }

    // Count images in the transformed body for token estimation.
    let imageCount = 0;
    for (const msg of body.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "image" || (block.source?.type === "base64")) imageCount++;
        }
      }
    }

    const tokensAfter = estimateInputTokens(body, imageCount);
    const tokensSaved = Math.max(0, tokensBefore - tokensAfter);

    if (diagnostics) {
      diagnostics.before = tokensBefore;
      diagnostics.after = tokensAfter;
    }

    return {
      tokensBefore,
      tokensAfter,
      tokensSaved,
      imageCount,
      charCount,
    };
  } catch (error) {
    setDiag(diagnostics, `error: ${error?.message || String(error)}`);
    return null;
  }
}

/**
 * Format pxpipe stats for console log.
 */
export function formatPxpipeLog(stats) {
  if (!stats || !stats.tokensSaved) return null;
  return `pxpipe saved ${stats.tokensSaved.toLocaleString()} tokens (${stats.tokensBefore.toLocaleString()} → ${stats.tokensAfter.toLocaleString()}, ${stats.imageCount} images)`;
}

/**
 * Format pxpipe size for diagnostic log.
 */
export function formatPxpipeSizeLog(diagnostics) {
  if (!diagnostics?.before || !diagnostics?.after) return null;
  const pct = diagnostics.before > 0 ? Math.round((1 - diagnostics.after / diagnostics.before) * 100) : 0;
  return `${diagnostics.before.toLocaleString()} → ${diagnostics.after.toLocaleString()} tokens (-${pct}%)`;
}

/**
 * Detect phantom savings (library claims savings but body barely changed).
 */
export function isPxpipePhantomSavings(stats, diagnostics, minShrinkRatio = 0.05) {
  if (!stats || !diagnostics?.before || !diagnostics?.after) return false;
  if (stats.tokensSaved <= 0) return false;
  const shrinkRatio = 1 - diagnostics.after / diagnostics.before;
  return shrinkRatio < minShrinkRatio;
}
