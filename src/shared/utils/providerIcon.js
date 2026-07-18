// Single source of truth for resolving provider icon asset paths.
//
// Previously this logic (SVG_ICON_IDS + compatible-prefix fallback) was
// duplicated/incomplete across many call sites, causing 404s for:
//   - SVG-only providers (icon requested as .png)
//   - OpenAI/Anthropic-compatible providers (id is `*-compatible-{UUID}`,
//     which can never match a static file)
//
// All call sites should call getProviderIconPath() instead of interpolating
// `/providers/${id}.png` inline.

import { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX } from "@/shared/constants/providers";

// Providers whose brand icon is a vector SVG (not PNG).
// MUST stay in sync with public/providers/*.svg (currently 34 files).
// When adding a new .svg asset, add its id here too.
export const SVG_ICON_IDS = new Set([
  "windsurf", "trae", "cody", "kimchi",
  "chatglm-cn", "blackbox-web", "puter", "adapta-web", "deepseek-web",
  "chatgpt-web", "doubao-web", "gemini-web", "copilot-web", "muse-spark-web",
  "duckduckgo-web", "venice-web", "t3-web", "lmarena", "veoaifree-web",
  "claude-web", "pollinations", "poe-web", "v0-vercel-web", "qwen-web",
  "kimi-web", "huggingchat", "api-airforce", "openvecta", "freebuff-web",
  "zenmux-free", "perplexity-agent", "featherless", "moonshot", "qwencloud",
  "devin",
]);

/**
 * Resolve the static asset path for a provider's icon.
 *
 * Three cases:
 *  1. OpenAI-compatible (id starts with "openai-compatible-") → oai-cc.png
 *     (or oai-r.png for the Responses API variant).
 *  2. Anthropic-compatible (id starts with "anthropic-compatible-") → anthropic-m.png.
 *  3. Known providers → /providers/{id}.{svg|png} based on SVG_ICON_IDS.
 *
 * @param {string} providerId - raw provider id (may be UUID-suffixed for compatible)
 * @param {string} [apiType] - "responses" distinguishes oai-r from oai-cc
 * @returns {string} static asset path under /providers/
 */
export function getProviderIconPath(providerId, apiType) {
  if (providerId?.startsWith(OPENAI_COMPATIBLE_PREFIX)) {
    return apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
  }
  if (providerId?.startsWith(ANTHROPIC_COMPATIBLE_PREFIX)) {
    return "/providers/anthropic-m.png";
  }
  const ext = SVG_ICON_IDS.has(providerId) ? "svg" : "png";
  return `/providers/${providerId}.${ext}`;
}
