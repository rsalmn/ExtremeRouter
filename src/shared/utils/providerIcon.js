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
// MUST stay in sync with public/providers/*.svg (currently 73 files).
// When adding a new .svg asset, add its id here too.
export const SVG_ICON_IDS = new Set([
  "windsurf", "trae", "cody", "kimchi",
  "zai-web", "puter", "adapta-web", "deepseek-web",
  "chatgpt-web", "doubao-web", "gemini-web", "copilot-web", "muse-spark-web",
  "duckduckgo-web", "venice-web", "t3-web", "lmarena", "veoaifree-web",
  "claude-web", "pollinations", "poe-web", "v0-vercel-web", "qwen-web",
  "kimi-web", "huggingchat", "api-airforce", "openvecta", "freebuff-web",
  "zenmux-free", "perplexity-agent", "featherless", "moonshot", "qwencloud",
  "devin", "forge", "tokenrouter", "xkiro",
  "qwen-cloud", "alibaba", "alibaba-cn", "alitp-intl", "hcnsec",
  "cline", "clinepass", "grok-web", "inxorastudio", "inxorastudio-web", "bynara", "infron", "1min", "zed", "wp-studio", "agnes-web", "agnes-api", "stepfun",
  "unimodel",
  "1min-api", "deepinfra", "codestral", "databricks", "venice", "vercel-ai-gateway", "marathon", "qwen2api",
  "kimi-desktop", "novita", "inferx",
  "tokenharbor",
  "felo-web",
  "bazaarlink", "meta-ai", "freebuff", "g4f-pollinations", "fireworks",
  // 2026-08 OmniRoute enterprise + frontier import
  "reka", "pioneer", "meta-llama", "morph", "upstage", "maritalk",
  "nous-research", "liquid", "inception", "writer",
  "modal", "scaleway", "ovhcloud", "heroku", "clarifai", "azure-ai",
  "watsonx", "oci", "sap", "snowflake",
  // 2026-08 OmniRoute gateways + inference-hosts import
  "auriko",
  "chat-oripe", "chatanywhere", "cloudcode-one", "digitalocean", "dit",
  "dxnt", "electronhub", "empower", "factory", "fastrouter", "free-ai",
  "freeaiapikey", "freeinference", "freemodel-dev", "freetheai", "friendliai",
  "getgoapi", "gitlawb-gmi", "gitlawb", "helixmind", "inference-net", "kenari",
  "kilo-gateway", "lambda-ai", "laozhang", "literouter", "llamagate", "llm-kiwi",
  "llmgateway", "meganova-ai", "mixlayer", "mnn-ai", "modelscope", "naga-ac",
  "naga-ai", "nanogpt", "nara", "navy", "nscale", "nube", "ofoxai",
  "ollama-cloud", "openadapter", "opencode-zen", "openference-api",
  "piapi", "poixe-ai", "poolside", "predibase", "publicai", "qiniu", "regolo",
  "requesty", "routeway", "sambanova", "speka", "sumopod", "synthetic",
  "thebai", "tokenreply", "unorouter", "void-ai", "wafer", "wandb", "x5lab",
  "yolo-auto", "zerolimitai", "zylo-api",
  // 2026-08 OmniRoute local + audio import
  "lm-studio", "vllm", "lemonade", "llamafile", "llama-cpp", "triton",
  "docker-model-runner", "xinference", "oobabooga",
  "soniox", "gladia", "fishaudio", "rev-ai", "speechmatics",
  // 2026-08 OmniRoute web-cookie executor ports
  "hailuo-web", "gemini-business", "inner-ai", "notion-web", "hyperagent",
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
