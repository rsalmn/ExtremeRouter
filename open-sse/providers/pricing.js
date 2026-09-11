// Pricing rates for AI models — all rates in $/1M tokens
//
// Fallback order (first match wins):
//   1. PROVIDER_PRICING[provider][model]  — provider-specific override
//   2. MODEL_PRICING[model]               — canonical model price (provider-agnostic)
//   3. PATTERN_PRICING                    — glob pattern match (e.g. "codex-*")

import { resolveProviderAlias } from "../services/model.js";

/**
 * Canonical model pricing — provider-agnostic.
 * Cover all known models; deduplicated across providers.
 */
export const MODEL_PRICING = {
  // === Anthropic / Claude ===
  "claude-opus-4-6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-opus-4-5-20251101":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-sonnet-4-6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-sonnet-4-5-20250929":   { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-haiku-4-5-20251001":    { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  },
  "claude-sonnet-4-20250514":     { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-opus-4-20250514":       { input: 15.00, output: 25.00, cached: 7.50,  reasoning: 112.50, cache_creation: 15.00 },
  "claude-3-5-sonnet-20241022":   { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-haiku-4.5":             { input: 0.50,  output: 2.50,  cached: 0.05,  reasoning: 3.75,   cache_creation: 0.50  },
  "claude-opus-4.1":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.5":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-sonnet-4":              { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.5":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-opus-4-5-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4-6-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.7":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.8":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-sonnet-5":              { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-5-thinking":     { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-fable-5":               { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },

  // === OpenAI / GPT ===
  "gpt-3.5-turbo":                { input: 0.50,  output: 1.50,  cached: 0.25,  reasoning: 2.25,   cache_creation: 0.50  },
  "gpt-4":                        { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-4-turbo":                  { input: 10.00, output: 30.00, cached: 5.00,  reasoning: 45.00,  cache_creation: 10.00 },
  "gpt-4o":                       { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-4o-mini":                  { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90,   cache_creation: 0.15  },
  "gpt-4.1":                      { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-5":                        { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  },
  "gpt-5-mini":                   { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  },
  "gpt-5-codex":                  { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  },
  "gpt-5.1":                      { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00,  cache_creation: 4.00  },
  "gpt-5.1-codex":                { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00,  cache_creation: 4.00  },
  "gpt-5.1-codex-mini":           { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "gpt-5.1-codex-mini-high":      { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },
  "gpt-5.1-codex-max":            { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "gpt-5.2":                      { input: 5.00,  output: 20.00, cached: 2.50,  reasoning: 30.00,  cache_creation: 5.00  },
  "gpt-5.2-codex":                { input: 5.00,  output: 20.00, cached: 2.50,  reasoning: 30.00,  cache_creation: 5.00  },
  "gpt-5.3-codex":                { input: 6.00,  output: 24.00, cached: 3.00,  reasoning: 36.00,  cache_creation: 6.00  },
  "gpt-5.3-codex-xhigh":         { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 },
  "gpt-5.3-codex-high":          { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "gpt-5.3-codex-low":           { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00,  cache_creation: 4.00  },
  "gpt-5.3-codex-none":          { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  },
  "gpt-5.3-codex-spark":         { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  },
  "gpt-5.4":                      { input: 6.00,  output: 24.00, cached: 3.00,  reasoning: 36.00,  cache_creation: 6.00  },
  "gpt-5.4-mini":                 { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },
  "gpt-5.4-nano":                 { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  },
  "gpt-5.5":                      { input: 7.00,  output: 28.00, cached: 3.50,  reasoning: 42.00,  cache_creation: 7.00  },
  "gpt-5.6-luna":                 { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "gpt-5.6-sol":                  { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "gpt-5.6-terra":                { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  // GPT 6.0 Astra — priced at parity with the gpt-5.6 flagships, mirroring
  // 9router's astra:sol 1:1 intent against OUR flat sol rates.
  "gpt-6-astra":                  { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "o1":                           { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00,  cache_creation: 15.00 },
  "o1-mini":                      { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  },

  // === Gemini ===
  "gemini-3.8-flash":             { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.8-flash-high":        { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.8-flash-medium":      { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.8-flash-low":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash":             { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash-high":        { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash-medium":      { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.7-flash-low":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash":             { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-high":        { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-medium":      { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-low":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3-flash-preview":       { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-pro-preview":         { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-low":           { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-high":          { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  "gemini-pro-agent":             { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  "gemini-3-flash-agent":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3.5-flash-low":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3.5-flash-extra-low":   { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-flash":               { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-2.5-pro":               { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-2.5-flash":             { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  },
  "gemini-2.5-flash-lite":        { input: 0.15,  output: 1.25,  cached: 0.015, reasoning: 1.875,  cache_creation: 0.15  },

  // === Qwen ===
  "qwen3-coder-plus":             { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "qwen3-coder-flash":            { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  // === Kimi ===
  "kimi-k2":                      { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "kimi-k2-thinking":             { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "kimi-k2.5":                    { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  },
  "kimi-k2.5-thinking":           { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  },
  "kimi-latest":                  { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },

  // === DeepSeek ===
  "deepseek-chat":                { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-reasoner":            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-r1":                  { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2-chat":           { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2-reasoner":       { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v4-flash":            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v4-pro":              { input: 0.435, output: 0.87,  cached: 0.003625, reasoning: 0.87,  cache_creation: 0.435 },

  // === GLM ===
  "glm-4.6":                      { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "glm-4.6v":                     { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  },
  "glm-4.7":                      { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  },
  "glm-5":                        { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  // GLM-5.3 (2026-08-14): Z.ai hasn't published 5.3 rates yet — mirrored from
  // GLM-5.2 (same base model). Correct when https://docs.z.ai/guides/overview/pricing
  // lists glm-5.3. The -high/-low tiers bill at the base rate.
  "glm-5.3":                      { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "glm-5.3-high":                 { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "glm-5.3-low":                  { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },

  // === MiniMax ===
  "MiniMax-M3":                   { input: 0.30,  output: 1.20,  cached: 0.06,  reasoning: 1.80,   cache_creation: 0.30  },
  "MiniMax-M2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.5":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.7":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.5":                 { input: 0.60,  output: 2.40,  cached: 0.30,  reasoning: 3.60,   cache_creation: 0.60  },

  // === Grok (xAI official rates, pre-200k context; ≥200k bills 2x) ===
  // Source: https://docs.x.ai/docs/models — grok-4.6/4.5 $2/$6, cached $0.50/$0.30.
  "grok-4.6":                     { input: 2.00,  output: 6.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 2.00  },
  "grok-4.5":                     { input: 2.00,  output: 6.00,  cached: 0.30,  reasoning: 6.00,   cache_creation: 2.00  },
  "grok-4.20-multi-agent":        { input: 2.00,  output: 6.00,  cached: 0.20,  reasoning: 6.00,   cache_creation: 2.00  },
  "grok-4.20-reasoning":          { input: 2.00,  output: 6.00,  cached: 0.20,  reasoning: 6.00,   cache_creation: 2.00  },
  "grok-4.3":                     { input: 1.25,  output: 2.50,  cached: 0.20,  reasoning: 2.50,   cache_creation: 1.25  },
  "grok-4":                       { input: 3.00,  output: 15.00, cached: 0.75,  reasoning: 15.00,  cache_creation: 3.00  },
  "grok-4-fast-reasoning":        { input: 0.20,  output: 0.50,  cached: 0.05,  reasoning: 0.50,   cache_creation: 0.20  },
  "grok-3":                       { input: 3.00,  output: 15.00, cached: 0.75,  reasoning: 15.00,  cache_creation: 3.00  },
  "grok-code-fast-1":             { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  // === OpenRouter fallback ===
  "auto":                         { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },

  // === Misc ===
  "oswe-vscode-prime":            { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "gpt-oss-120b-medium":          { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "vision-model":                 { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "coder-model":                  { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },

  // === models.dev-derived fill (audit: paid-provider LLM gaps, $/1M) ===
  // Values sourced from https://models.dev/api.json (the same authoritative
  // source capabilities.js cites). reasoning = output for reasoning models
  // (codebase convention). Kept provider-agnostic; PROVIDER_PRICING overrides
  // when a specific host charges differently.
  "gpt-oss-120b":                 { input: 0.228, output: 0.798, reasoning: 0.798 },
  "zai-glm-4.7":                  { input: 2.25,  output: 2.75,  reasoning: 2.75  },
  "llama-3.3-70b":                { input: 0.70,  output: 2.80 },
  "llama-4-scout-17b-16e-instruct": { input: 0.20, output: 0.78 },
  "poolside/laguna-s-2.1:free":   { input: 0,     output: 0 },
  "laguna-s-2.1:free":            { input: 0,     output: 0 },
  "stepfun/step-3.7-flash":       { input: 0.19,  output: 1.14,  reasoning: 1.14 },
  "step-3.7-flash":               { input: 0.185, output: 1.11,  reasoning: 1.11 },
  "kwaipilot/kat-coder-pro":      { input: 0.30,  output: 1.20 },
  "cline-pass/mimo-v2.5":         { input: 0.14,  output: 0.28,  reasoning: 0.28 },
  "cline-pass/mimo-v2.5-pro":     { input: 1.74,  output: 3.48,  reasoning: 3.48 },
  "hy3-preview":                  { input: 0,     output: 0 },
  // Hy4 preview family — same CodeBuddy/WorkBuddy subscription gateway as hy3
  // (no per-token price; billed through the plan quota).
  "hy4-preview":                  { input: 0,     output: 0 },
  "hy4-preview-x":                { input: 0,     output: 0 },
  "hy3":                          { input: 0,     output: 0 },
  // LongCat-2.0 (Meituan) — OpenCode Go / zenmux rate ($0.30·$1.20 per 1M).
  "longcat-2.0":                  { input: 0.30,  output: 1.20,  cached: 0.006,  reasoning: 1.20,   cache_creation: 0.30  },
  "mimo-auto":                    { input: 0,     output: 0 },
  // Muse Spark 1.3 contributor — OpenCode Go reseller lane; same contributor-tier
  // rates as meta-ai's muse-spark-1.2-contributor (data-sharing tier).
  "muse-spark-1.3-contributor":   { input: 0.10,  output: 0.20,  cached: 0.15, reasoning: 0.20 },
  // BazaarLink paid catalog (vendor-parity rates; the `auto:free` tier is $0 above)
  "gemma-4-31b-it":                { input: 0.50,  output: 1.50,  cached: 0.10,  reasoning: 1.50,   cache_creation: 0.50  },
  "gemma-4-26b-a4b-it":            { input: 0.30,  output: 0.90,  cached: 0.06,  reasoning: 0.90,   cache_creation: 0.30  },
  "llama-4-scout":                 { input: 0.20,  output: 0.78,  cached: 0.04,  reasoning: 0.78,   cache_creation: 0.20  },
  "mistral-large-2512":            { input: 2.00,  output: 6.00,  cached: 0.40,  reasoning: 6.00,   cache_creation: 2.00  },
  "mistral-medium-3.1":            { input: 1.50,  output: 7.50,  cached: 0.30,  reasoning: 7.50,   cache_creation: 1.50  },
  "mistral-small-2603":            { input: 0.10,  output: 0.30,  cached: 0.02,  reasoning: 0.30,   cache_creation: 0.10  },
  "nemotron-3-super-120b-a12b":    { input: 0.25,  output: 1.00,  cached: 0.05,  reasoning: 1.00,   cache_creation: 0.25  },
  // ── No-auth / free-tier gateways (zero-cost inference, $0/1M) ──
  "auto:free":                    { input: 0,     output: 0 },
  "dgridai/free":                 { input: 0,     output: 0 },
  "felo-chat":                    { input: 0,     output: 0 },
  "felo-search":                  { input: 0,     output: 0 },
  "felo-scholar":                 { input: 0,     output: 0 },
  "felo-social":                  { input: 0,     output: 0 },
  "felo-document":                { input: 0,     output: 0 },
  "adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic": { input: 0, output: 0 },
  "qwen3.6:27b":                  { input: 0,     output: 0 },
  "gemma4:31b":                   { input: 0,     output: 0 },
  "meta-llama/llama-3.3-70b-instruct": { input: 0, output: 0 },
  "mistralai/mistral-7b-instruct": { input: 0,     output: 0 },
  "deepseek-ai/deepseek-coder-33b": { input: 0,    output: 0 },
  "GPT_5_4":                      { input: 0,     output: 0 },
  "GPT_5_3":                      { input: 0,     output: 0 },
  "GPT_5_2":                      { input: 0,     output: 0 },
  "GPT_5_1":                      { input: 0,     output: 0 },
  "GPT_5":                        { input: 0,     output: 0 },
  "GPT_o4_mini":                  { input: 0,     output: 0 },
  "GPT_o3_mini":                  { input: 0,     output: 0 },
  "CLAUDE_4_6_OPUS":              { input: 0,     output: 0 },
  "CLAUDE_4_6_SONNET":            { input: 0,     output: 0 },
  "CLAUDE_4_5_HAIKU":             { input: 0,     output: 0 },
  "aphrodite/TheDrummer/Cydonia-24B-v4.3": { input: 0, output: 0 },
  "aphrodite/TheDrummer/Skyfall-31B-v4.2": { input: 0, output: 0 },
  "google/gemma-4-31b":           { input: 0,     output: 0 },
  "command-r-plus-08-2024":       { input: 2.50,  output: 10.00 },
  "command-r-08-2024":            { input: 0.15,  output: 0.60 },
  "command-a-03-2025":            { input: 2.50,  output: 10.00 },
  "llama-3.3-70b-versatile":      { input: 0.59,  output: 0.79 },
  "openai/gpt-oss-120b":          { input: 0.037, output: 0.17,  reasoning: 0.17 },
  "meta-llama/Llama-3.3-70B-Instruct": { input: 0.05, output: 0.23 },
  "meta-llama/Llama-3.2-3B-Instruct": { input: 0.0306, output: 0.0493 },
  "NousResearch/Hermes-3-Llama-3.1-70B": { input: 0.70, output: 0.70 },
  "mistral-large-latest":         { input: 0.50,  output: 1.50 },
  "codestral-latest":             { input: 0.30,  output: 0.90 },
  "codestral-2508":               { input: 0.30,  output: 0.90 },
  "mistral-medium-latest":        { input: 1.50,  output: 7.50,  reasoning: 7.50 },
  "mimo-v2.5":                    { input: 0.14,  output: 0.28,  reasoning: 0.28 },
  "mimo-v2.5-pro":                { input: 0.435, output: 0.87,  reasoning: 0.87 },
  "sonar-pro":                    { input: 3.00,  output: 15.00 },
  "sonar":                        { input: 1.00,  output: 1.00 },
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": { input: 0.371, output: 1.484 },
  "venice-uncensored-1-2":        { input: 0.20,  output: 0.90 },
  "zai-org-glm-5":                { input: 1.00,  output: 3.20,  reasoning: 3.20 },
  "hermes-3-llama-3.1-405b":      { input: 1.10,  output: 3.00 },
  "mistral-small-3-2-24b-instruct": { input: 0.09375, output: 0.25 },
  "mimo-v2-pro":                  { input: 1.00,  output: 3.00,  reasoning: 3.00 },
  "mimo-v2-omni":                 { input: 0.40,  output: 2.00,  reasoning: 2.00 },
  "mimo-v2-tts":                  { input: 0,     output: 0 },
  "mimo-v2.5-tts":                { input: 0,     output: 0 },
  "mimo-v2.5-tts-voiceclone":     { input: 0,     output: 0 },
  "mimo-v2.5-tts-voicedesign":    { input: 0,     output: 0 },
  "gemma-4-31b":                  { input: 0.144, output: 0.42,  reasoning: 0.42 },
  "llama-3.3-70b-instruct":       { input: 1.254, output: 1.254 },
  "llama-4-maverick":             { input: 0.15,  output: 0.60 },
  "nemotron-3-super-120b":        { input: 0.30,  output: 0.90,  reasoning: 0.90 },
  "perplexity/sonar":             { input: 0.25,  output: 2.50 },
  "mistralai/Mistral-7B-Instruct-v0.3": { input: 0, output: 0 },
  "nemotron-3-ultra":             { input: 0.10,  output: 0.10,  reasoning: 0.10 },
  "step-3.5-flash":               { input: 0.10,  output: 0.30,  reasoning: 0.30 },
  "step-3.5-flash-2603":          { input: 0.10,  output: 0.30,  reasoning: 0.30 },
  "step-3":                       { input: 0.2499, output: 0.6494 },
  "openai/gpt-oss-20b":           { input: 0.03,  output: 0.14,  reasoning: 0.14 },
  "meta-llama/Llama-4-Scout-17B-16E-Instruct": { input: 0.18, output: 0.59 },
  "google/gemma-4-31B-it":        { input: 0,     output: 0 },
  "XiaomiMiMo/MiMo-V2.5-Pro":     { input: 0.522, output: 1.044, reasoning: 1.044 },
  "databricks-gpt-5":             { input: 1.25,  output: 10.00, reasoning: 10.00 },
  "databricks-claude-sonnet-4":   { input: 3.00,  output: 15.00, reasoning: 15.00 },
  "databricks-gemini-2-5-pro":    { input: 1.25,  output: 10.00, reasoning: 10.00 },
  "meta-llama/llama-3.3-70b-instruct": { input: 0.05, output: 0.23 },
  "mistralai/mistral-nemo":       { input: 0.019, output: 0.03 },
  // Together Llama-3.3-70B-Turbo (well-known vendor rate).
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": { input: 0.88, output: 0.88 },
};

/**
 * Provider-specific pricing overrides.
 * Only include entries where price DIFFERS from MODEL_PRICING.
 * Keyed by provider alias (cc, cx, gc, gh, ...) or provider id (openai, anthropic, ...).
 */
export const PROVIDER_PRICING = {
  // GitHub Copilot (gh) — gpt-5.3-codex has different rate than canonical.
  // Keyed by provider id "github" (runtime resolves gh→github). Previously keyed
  // "gh", which no caller passed — usage cost silently fell back to the
  // canonical $6/$24 instead of GitHub's actual $1.75/$14.
  github: {
    "gpt-5.3-codex": { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 },
  },
  // cline / clinepass — 0x-Alpha stealth tier (free/promo)
  cline: {
    "stealth/ox-alpha": { input: 0, output: 0, cached: 0 },
  },
  clinepass: {
    "stealth/ox-alpha": { input: 0, output: 0, cached: 0 },
  },
  // xAI (xai) — official console.x.ai rates (pre-200k). ≥200k context bills 2x.
  // Mirrors MODEL_PRICING so provider-scoped lookups don't fall through to the
  // old $0.50/$2.00 grok-* pattern for unknown aliases.
  xai: {
    "grok-4.6":              { input: 2.00, output: 6.00, cached: 0.50, reasoning: 6.00, cache_creation: 2.00 },
    "grok-4.5":              { input: 2.00, output: 6.00, cached: 0.30, reasoning: 6.00, cache_creation: 2.00 },
    "grok-4.20-multi-agent": { input: 2.00, output: 6.00, cached: 0.20, reasoning: 6.00, cache_creation: 2.00 },
    "grok-4.20-reasoning":   { input: 2.00, output: 6.00, cached: 0.20, reasoning: 6.00, cache_creation: 2.00 },
    "grok-4.3":              { input: 1.25, output: 2.50, cached: 0.20, reasoning: 2.50, cache_creation: 1.25 },
    "grok-4":                { input: 3.00, output: 15.00, cached: 0.75, reasoning: 15.00, cache_creation: 3.00 },
    "grok-4-fast-reasoning": { input: 0.20, output: 0.50, cached: 0.05, reasoning: 0.50, cache_creation: 0.20 },
    "grok-3":                { input: 3.00, output: 15.00, cached: 0.75, reasoning: 15.00, cache_creation: 3.00 },
    "grok-code-fast-1":      { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 },
  },
  // Fireworks AI (fireworks) — serverless rates, $/1M tokens (docs.fireworks.ai/serverless/pricing).
  // Keys carry the full accounts/fireworks/models/... id as served by Fireworks.
  // Cached-input rates from the pricing page; reasoning = output (codebase convention).
  fireworks: {
    "accounts/fireworks/models/deepseek-v3p1":         { input: 0.56, output: 1.68 },
    "accounts/fireworks/models/glm-5p2":               { input: 1.40, cached: 0.14, output: 4.40, reasoning: 4.40 },
    "accounts/fireworks/models/kimi-k2p6":             { input: 0.95, cached: 0.16, output: 4.00, reasoning: 4.00 },
    "accounts/fireworks/models/kimi-k2-instruct-0905": { input: 0.60, output: 2.50 },
    "accounts/fireworks/models/llama-v3p3-70b-instruct": { input: 0.90, output: 0.90 },
    "accounts/fireworks/models/qwen3-235b-a22b":       { input: 0.22, output: 0.88 },
  },
  // Forge Workspace (forge) — tier-based pricing via /v1/models-rates
  forge: {
    "gpt-5.6-sol": { input: 5.00, output: 30.00 },
    "gpt-5.6-terra": { input: 2.50, output: 15.00 },
    "gpt-5.6-luna": { input: 1.00, output: 6.00 },
    "gpt-5.5": { input: 5.00, output: 40.00 },
    "gpt-5.3-codex": { input: 1.75, output: 14.00 },
    "claude-opus-4-5-20251101": { input: 5.00, output: 25.00 },
    "claude-sonnet-4-5-20250929": { input: 3.00, output: 15.00 },
    "claude-haiku-4-5-20251001": { input: 1.00, output: 5.00 },
    "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
    "claude-sonnet-4-6-thinking": { input: 3.00, output: 15.00 },
    "claude-sonnet-5": { input: 2.00, output: 10.00 },
    "claude-fable-5": { input: 10.00, output: 50.00 },
    "grok-4.5": { input: 2.00, output: 6.00 },
    "grok-4.3": { input: 1.25, output: 2.50 },
    "grok-build-0.1": { input: 1.00, output: 2.00 },
    "deepseek-r1": { input: 0.401, output: 1.605 },
    "deepseek-v4-flash": { input: 0.098, output: 0.196 },
    "deepseek-v4-pro": { input: 0.304, output: 0.609 },
    "deepseek-v3.2": { input: 0.20, output: 0.301 },
    "deepseek-v3.1": { input: 0.401, output: 1.204 },
    "deepseek-v3": { input: 0.20, output: 0.802 },
    "kimi-k3": { input: 3.00, output: 15.00 },
    "kimi-k2.7-code": { input: 0.625, output: 2.599 },
    "kimi-k2.6": { input: 0.625, output: 2.599 },
    "kimi-k2.5": { input: 0.401, output: 2.107 },
    "gemini-3-pro-preview": { input: 2.00, output: 12.00 },
    "gemini-3.5-flash": { input: 1.50, output: 9.00 },
    "tencent/hy3": { input: 0.20, output: 0.80 },
    "mimo-v2.5": { input: 0.10, output: 0.20 },
    "mimo-v2.5-pro": { input: 0.30, output: 0.60 },
    "MiniMax-M3": { input: 0.21, output: 0.84 },
    "MiniMax-M2.5": { input: 0.21, output: 0.84 },
    "glm-5.2": { input: 0.77, output: 2.695 },
  },
  // TokenRouter (tokenrouter) — AI model gateway (api.tokenrouter.com).
  // Rates are TokenRouter's own per-model prices (NOT canonical vendor prices).
  // Keys carry the vendor prefix as served by TokenRouter's /v1/models, e.g.
  // "anthropic/claude-sonnet-4.6". Mixed-prefix entries (no vendor) match as-is.
  tokenrouter: {
    "MiniMax-M3": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "anthropic/claude-fable-5": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-haiku-4.5": { input: 1.0, output: 5.0, cached: 0.1, cache_creation: 1.25, reasoning: 5.0 },
    "anthropic/claude-opus-4.5": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.6": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.7": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.7-fast": { input: 30, output: 150, cached: 3.0, reasoning: 150 },
    "anthropic/claude-opus-4.8": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.8-fast": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-opus-5": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-5-fast": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-4.5": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-4.6": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-5": { input: 2, output: 10, cached: 0.2, reasoning: 10 },
    "claude-opus-4-8-m-aws": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "deepseek/deepseek-v3.2": { input: 0.26, output: 0.38, cached: 0.13, reasoning: 0.38 },
    "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "deepseek/deepseek-v4-flash-0731": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87, cached: 0.003625, reasoning: 0.87 },
    "ex/gpt-5.4": { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    "google/gemini-2.5-flash-image": { input: 0.3, output: 2.5, reasoning: 2.5 },
    "google/gemini-3-flash-preview": { input: 0.5, output: 3.0, cached: 0.05, cache_creation: 0.08333, reasoning: 3.0 },
    "google/gemini-3-pro-image-preview": { input: 2, output: 12, reasoning: 12 },
    "google/gemini-3.1-flash-image-preview": { input: 0.5, output: 3.0, reasoning: 3.0 },
    "google/gemini-3.1-flash-lite-image": { input: 0.25, output: 1.5, reasoning: 1.5 },
    "google/gemini-3.1-pro-preview": { input: 2, output: 12, cached: 0.2, cache_creation: 0.375, reasoning: 12 },
    "google/gemini-3.5-flash": { input: 1.5, output: 9.0, cached: 0.15, cache_creation: 0.08333, reasoning: 9.0 },
    "google/gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cached: 0.03, cache_creation: 0.08333, reasoning: 2.5 },
    "google/gemini-3.6-flash": { input: 1.5, output: 7.5, cached: 0.15, cache_creation: 0.08333, reasoning: 7.5 },
    "google/gemini-embedding-2": { input: 1.0, output: 6.0, cached: 0.1, reasoning: 6.0 },
    "google/gemma-4-26b-a4b-it": { input: 0.06, output: 0.33, reasoning: 0.33 },
    "kling-3.0-turbo": { input: 2.1, output: 2.1, reasoning: 2.1 },
    "microsoft/mai-image-2.5": { input: 5.0, output: 47.0, reasoning: 47.0 },
    "minimax/minimax-m2-her": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.1": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.1-highspeed": { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    "minimax/minimax-m2.5": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.7": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "minimax/minimax-m2.7-highspeed": { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    "miromind/mirothinker-1-7-deepresearch": { input: 4, output: 25.0, reasoning: 25.0 },
    "miromind/mirothinker-1-7-deepresearch-mini": { input: 1.25, output: 10.0, reasoning: 10.0 },
    "mistralai/devstral-2512": { input: 0.4, output: 2.0, cached: 0.04, reasoning: 2.0 },
    "mistralai/mistral-medium-3-5": { input: 1.5, output: 7.5, reasoning: 7.5 },
    "mistralai/mistral-small-2603": { input: 0.15, output: 0.6, cached: 0.015, reasoning: 0.6 },
    "mistralai/voxtral-small-24b-2507": { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    "moonshotai/kimi-k2.5": { input: 0.6, output: 3.0, cached: 0.1, reasoning: 3.0 },
    "moonshotai/kimi-k2.6": { input: 0.95, output: 4.0, cached: 0.16, reasoning: 4.0 },
    "moonshotai/kimi-k2.7-code": { input: 0.9286, output: 3.8571, cached: 0.1857, reasoning: 3.8571 },
    "moonshotai/kimi-k3": { input: 3.0, output: 15.0, cached: 0.3, reasoning: 15.0 },
    "nvidia/nemotron-3-super-120b-a12b": { input: 0.3, output: 0.9, cached: 0.1, reasoning: 0.9 },
    "openai/gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075, reasoning: 0.6 },
    "openai/gpt-5": { input: 1.25, output: 10.0, cached: 0.125, reasoning: 10.0 },
    "openai/gpt-5-image": { input: 10, output: 40, cached: 2.5, reasoning: 40 },
    "openai/gpt-5-image-mini": { input: 2.5, output: 8.0, cached: 0.25, reasoning: 8.0 },
    "openai/gpt-5-mini": { input: 0.25, output: 2.0, cached: 0.025, reasoning: 2.0 },
    "openai/gpt-5.2": { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    "openai/gpt-5.3-codex": { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    "openai/gpt-5.4": { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    "openai/gpt-5.4-image-2": { input: 8, output: 30.0, cached: 2.0, reasoning: 30.0 },
    "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, cached: 0.075, reasoning: 4.5 },
    "openai/gpt-5.4-nano": { input: 0.2, output: 1.25, cached: 0.02, reasoning: 1.25 },
    "openai/gpt-5.4-pro": { input: 30, output: 180, reasoning: 180 },
    "openai/gpt-5.5": { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    "openai/gpt-5.5-pro": { input: 30, output: 180, reasoning: 180 },
    "openai/gpt-5.6-luna": { input: 0.2, output: 1.2, cached: 0.02, cache_creation: 0.25, reasoning: 1.2 },
    "openai/gpt-5.6-sol": { input: 5.0, output: 30.0, cached: 0.5, cache_creation: 6.25, reasoning: 30.0 },
    "openai/gpt-5.6-terra": { input: 2, output: 12, cached: 0.2, cache_creation: 2.5, reasoning: 12 },
    "openai/gpt-audio": { input: 2.5, output: 10.0, reasoning: 10.0 },
    "openai/gpt-audio-mini": { input: 0.6, output: 2.4, reasoning: 2.4 },
    "openai/gpt-oss-120b": { input: 0.039, output: 0.18, reasoning: 0.18 },
    "qwen/qwen3-coder-next": { input: 0.12, output: 0.75, cached: 0.06, reasoning: 0.75 },
    "qwen/qwen3.5-122b-a10b": { input: 0.26, output: 2.08, reasoning: 2.08 },
    "qwen/qwen3.5-35b-a3b": { input: 0.1625, output: 1.3, reasoning: 1.3 },
    "qwen/qwen3.5-397b-a17b": { input: 0.39, output: 2.34, reasoning: 2.34 },
    "qwen/qwen3.5-9b": { input: 0.1, output: 0.15, reasoning: 0.15 },
    "qwen/qwen3.5-flash": { input: 0.1048, output: 0.4194, reasoning: 0.4194 },
    "qwen/qwen3.5-plus-02-15": { input: 0.26, output: 1.56, reasoning: 1.56 },
    "qwen/qwen3.6-plus": { input: 0.54, output: 3.21, reasoning: 3.21 },
    "qwen/qwen3.7-max": { input: 1.25, output: 3.75, cached: 0.25, reasoning: 3.75 },
    "qwen/qwen3.7-plus": { input: 0.4, output: 1.6, cached: 0.08, reasoning: 1.6 },
    "qwen/qwen3.8-max": { input: 2, output: 6, cached: 0.25, cache_creation: 2.5, reasoning: 6 },
    "qwen3.5-omni-plus": { input: 1.0, output: 5.7143, reasoning: 5.7143 },
    "qwen3.6-flash": { input: 0.171, output: 1.029, cached: 0.017, cache_creation: 0.214, reasoning: 1.029 },
    "sakana/fugu-ultra": { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    "seed-2-0-code-preview-260328": { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    "seed-2-0-lite-260428": { input: 0.5, output: 4.0, cached: 0.1, cache_creation: 0.008333, reasoning: 4.0 },
    "seed-2-0-mini-260428": { input: 0.2, output: 0.8, cached: 0.04, cache_creation: 0.00833, reasoning: 0.8 },
    "seed-2-0-pro-260328": { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    "stepfun/step-3.5-flash": { input: 0.1, output: 0.3, cached: 0.02, reasoning: 0.3 },
    "stepfun/step-3.7-flash": { input: 0.2, output: 1.15, cached: 0.04, reasoning: 1.15 },
    "tencent/hy3-preview": { input: 0.066, output: 0.26, cached: 0.029, reasoning: 0.26 },
    "x-ai/grok-4.1-fast": { input: 0.2, output: 0.5, cached: 0.05, reasoning: 0.5 },
    "x-ai/grok-4.20-beta": { input: 2, output: 6, cached: 0.2, reasoning: 6 },
    "x-ai/grok-4.3": { input: 1.25, output: 2.5, cached: 0.2, reasoning: 2.5 },
    "x-ai/grok-4.5": { input: 2, output: 6, cached: 0.5, reasoning: 6 },
    "x-ai/grok-4.6": { input: 2, output: 6, cached: 0.5, reasoning: 6 },
    "x-ai/grok-build-0.1": { input: 1.0, output: 2.0, cached: 0.2, reasoning: 2.0 },
    "xiaomi/mimo-v2-flash": { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    "xiaomi/mimo-v2-omni": { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    "xiaomi/mimo-v2-pro": { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    "xiaomi/mimo-v2.5": { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    "xiaomi/mimo-v2.5-pro": { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    "z-ai/glm-4.5-air": { input: 0.13, output: 0.85, cached: 0.025, reasoning: 0.85 },
    "z-ai/glm-4.6": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-4.6v": { input: 0.3, output: 0.9, reasoning: 0.9 },
    "z-ai/glm-4.7": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-5": { input: 1.0, output: 3.2, cached: 0.2, reasoning: 3.2 },
    "z-ai/glm-5-turbo": { input: 1.2, output: 4.0, cached: 0.24, reasoning: 4.0 },
    "z-ai/glm-5.1": { input: 1.05, output: 3.5, cached: 0.525, reasoning: 3.5 },
    "z-ai/glm-5.2": { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
  },
  // Bynara (bynara) — router.bynara.id pay-as-you-go rates (USD per 1M tokens,
  // from their pricing page, $1 = Rp17.873). "free"-suffixed aliases are billed
  // low, not $0 (e.g. Ling 3.0 Flash fin Free = $0.01/$0.02). Grok 4.5 Free is
  // not listed on the pricing page — uses the Grok 4.5 rate. Keys must match
  // the live /v1/model ids (2026-09-10 capture).
  bynara: {
    "agnes-2.0-flash":     { input: 0.03, output: 0.11 },
    "agnes-2.5-flash":     { input: 0.06, output: 0.28 },
    "grok-4.5-free":       { input: 0.40, output: 0.64 },
    "laguna-s-2.1":        { input: 0.00, output: 0.00 },
    "ling-3.0-flash-fin-free":        { input: 0.01, output: 0.02 },
    "mistral-large":       { input: 0.15, output: 0.45 },
    "mistral-medium-3-5":  { input: 0.30, output: 1.51 },
    "nemotron-3.5-lightning-free":    { input: 0.00, output: 0.00 },
    "stepfun-3.7-flash":   { input: 0.04, output: 0.23 },
    "tencent-hy3-free":    { input: 0.03, output: 0.11 },
  },
  // TokenHarbor (tokenharbor) — AI model gateway. User price table (input·output
  // per 1M tokens); pinned reasoning tier for reasoning models.
  tokenharbor: {
    "claude-opus-5":   { input: 5, output: 25, cached: 0.5, reasoning: 25 },
    "claude-fable-5":  { input: 10, output: 50, cached: 1.0, reasoning: 50 },
    "gpt-5.6-sol":     { input: 5, output: 30, cached: 0.5, reasoning: 30 },
    "kimi-k3":         { input: 3, output: 15, cached: 0.3, reasoning: 15 },
    "qwen3.8-max":     { input: 2, output: 6, cached: 0.25, reasoning: 6 },
    "gpt-5.6-terra":   { input: 2, output: 12, cached: 0.2, reasoning: 12 },
    "grok-4.5":        { input: 2, output: 6, cached: 0.2, reasoning: 6 },
    "claude-sonnet-5": { input: 2, output: 10, cached: 0.2, reasoning: 10 },
    "glm-5.2":         { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
    "gemini-3.6-flash": { input: 1.5, output: 7.5, cached: 0.15, reasoning: 7.5 },
  },
  // Helyx AI (helyxai) — helyxai.space unified gateway price table ($/1M tokens).
  // Free plan: 100K tokens/day, resets every 24h.
  helyxai: {
    "llama-3.1-8b-instruct": { input: 0.10, output: 0.25 },
    "gemma-4-31B-it":        { input: 0.20, output: 0.50 },
    "DeepSeek-V4-Flash":     { input: 0.14, output: 0.28 },
    "Qwen3-32B":             { input: 0.10, output: 0.30 },
    "gpt-5.6-luna":          { input: 0.10, output: 0.60 },
    "gemini-3.1-flash-lite": { input: 0.25, output: 1.50 },
    "GLM-5.2":               { input: 1.40, output: 4.40 },
    "Mistral-4":             { input: 0.25, output: 1.00 },
    "DeepSeek-V4-Pro":       { input: 0.43, output: 0.87 },
    "gpt-oss-120b":          { input: 0.10, output: 0.50 },
    "MiniMax-M3":            { input: 0.30, output: 1.20 },
    "Kimi-K3":               { input: 4.00, output: 14.00 },
  },
  // Meta AI (meta-ai) — api.meta.ai Muse Spark family. Standard vs Contributor
  // tier: 1.2/1.1 standard at $1.25·$4.25 per 1M, the "-contributor" variant at
  // $0.10·$0.20 (data-sharing; ~60 req/min, ~250K tokens/day cap). Shared
  // cached-input $0.15/1M. Reasoning price = output (codebase convention for
  // reasoning models).
  "meta-ai": {
    "muse-spark-1.2":             { input: 1.25, output: 4.25, cached: 0.15, reasoning: 4.25 },
    "muse-spark-1.2-contributor": { input: 0.10, output: 0.20, cached: 0.15, reasoning: 0.20 },
    "muse-spark-1.1":             { input: 1.25, output: 4.25, cached: 0.15, reasoning: 4.25 },
  },
  // ── 2026-08 OmniRoute enterprise + frontier import (rates $/1M tokens) ──────
  // Sources per model inline; unlisted models stay in NO_PUBLIC_RATE (gate test).
  ai21: {
    // OpenRouter / ArtificialAnalysis / FlexAI — AI21 Studio rates.
    "jamba-large-1.7": { input: 2.00, output: 8.00 },
    // Jamba Mini family rate (pricepertoken / cloudprice; jamba-mini-2 → jamba-mini-2-2026-01).
    "jamba-mini-2":    { input: 0.20, output: 0.40 },
  },
  "arcee-ai": {
    // OpenRouter: trinity-mini 0.05/0.15; trinity-large-thinking 0.22/0.85.
    // trinity-large-preview: no published rate — Large-class rate as proxy.
    "trinity-mini":           { input: 0.05,  output: 0.15 },
    "trinity-large-thinking": { input: 0.22,  output: 0.85 },
    "trinity-large-preview":  { input: 0.22,  output: 0.85 },
  },
  inception: {
    // OpenRouter (Inception official endpoint).
    "mercury-2": { input: 0.25, output: 0.75 },
  },
  liquid: {
    // Liquid's models are free below $10M revenue (official); hosted API ~$0.00–0.03/M
    // (pricepertoken). Top of that range as both directions.
    "liquid-lfm-40b": { input: 0.03, output: 0.03 },
  },
  maritalk: {
    // maritaca.ai/en/pricing (BRL → USD at their own published rate US$1 ≈ R$5.14).
    "sabia-4":        { input: 0.97, output: 3.89 },
    "sabia-4-thinking": { input: 0.97, output: 7.78 },
    "sabiazinho-4":   { input: 0.19, output: 0.78 },
  },
  "meta-llama": {
    // Market rates for the exact models (OpenRouter live listings); Meta's own
    // llama.com compat surface does not publish a static per-token table.
    "Llama-4-Maverick-17B-128E-Instruct-FP8": { input: 0.20, output: 0.80 },
    "Llama-4-Scout-17B-16E-Instruct-FP8":    { input: 0.10, output: 0.30 },
    "Llama-3.3-70B-Instruct":                { input: 0.10, output: 0.32 },
  },
  morph: {
    // morphllm.com (GLM-5.2 $1.10/$4.10, Qwen 3.5 $0.50/$3.50, MiniMax M3 $0.60/$2.40,
    // DeepSeek V4 Flash $0.139/$0.278) + OpenRouter (morph-v3-large/fast).
    "morph-v3-large":    { input: 0.90,   output: 1.90 },
    "morph-v3-fast":     { input: 0.80,   output: 1.20 },
    "morph-glm52-744b":  { input: 1.10,   output: 4.10 },
    "morph-qwen35-397b": { input: 0.50,   output: 3.50 },
    "morph-qwen36-27b":  { input: 0.289,  output: 0.90 },
    "morph-minimax3-428b": { input: 0.60, output: 2.40 },
    "morph-dsv4flash":   { input: 0.139,  output: 0.278 },
  },
  "nous-research": {
    // OpenRouter (Nous Portal heavily-discounted rates).
    "Hermes-4-405B": { input: 1.00, output: 3.00 },
    "Hermes-4-70B":  { input: 0.13, output: 0.40 },
  },
  oci: {
    // getmaxim.ai/bifrost OCI rate (llama-3.3-70b symmetric $0.72/M).
    "meta.llama-3.3-70b-instruct": { input: 0.72, output: 0.72 },
  },
  ovhcloud: {
    // models.dev / mastra (OVH AI Endpoints catalog).
    "Meta-Llama-3_3-70B-Instruct":          { input: 0.74, output: 0.74 },
    "Mistral-Small-3.2-24B-Instruct-2506":  { input: 0.10, output: 0.31 },
  },
  reka: {
    // docs.reka.ai/pricing (official).
    "reka-flash-3":   { input: 0.10, output: 0.20 },
    "reka-flash":     { input: 0.80, output: 2.00 },
    "reka-edge-2603": { input: 0.10, output: 0.10 },
  },
  scaleway: {
    // models.dev Scaleway serverless catalog (current live models).
    "qwen3-235b-a22b-instruct-2507":   { input: 0.75, output: 2.25 },
    "qwen3.5-397b-a17b":              { input: 0.60, output: 3.60 },
    "llama-3.3-70b-instruct":         { input: 0.90, output: 0.90 },
    "mistral-small-3.2-24b-instruct-2506": { input: 0.15, output: 0.35 },
    "gpt-oss-120b":                  { input: 0.15, output: 0.60 },
    "glm-5.2":                       { input: 1.80, output: 5.50 },
  },
  upstage: {
    // Upstage first-party (ArtificialAnalysis): Solar Pro 3 $0.15/$0.60 (cache $0.02),
    // Solar Mini $0.15/$0.15.
    "solar-pro3": { input: 0.15, output: 0.60, cached: 0.02 },
    "solar-mini": { input: 0.15, output: 0.15 },
  },
  watsonx: {
    // IBM watsonx pay-per-token (ibm.com/docs — supported foundation models):
    // llama-3-3-70b $0.0007526/1K = $0.7526/M, symmetric.
    "meta-llama/llama-3-3-70b-instruct": { input: 0.7526, output: 0.7526 },
  },
  writer: {
    // dev.writer.com / writer.com official: Palmyra X5 $0.60/$6.00, X4 $2.50/$10.00.
    "palmyra-x5": { input: 0.60, output: 6.00 },
    "palmyra-x4": { input: 2.50, output: 10.00 },
  },
  // ── 2026-08 OmniRoute gateways + inference-hosts import (models.dev rates, $/1M) ──
  "requesty": {
    "claude-sonnet-4-5@eu": { input: 3.3, output: 16.5, cached: 0.3, cache_creation: 4.125 },
    "claude-opus-4-7": { input: 5, output: 25, cached: 0.5, cache_creation: 6.25 },
    "gpt-5.1@eu": { input: 1.375, output: 11, cached: 0.1375 },
    "gpt-4.1-nano@eu": { input: 0.11, output: 0.44, cached: 0.0275 },
    "gemini-2.5-flash@eu": { input: 0.3, output: 2.5, cached: 0.075, cache_creation: 0.55 },
    "kimi-k3": { input: 2.25, output: 11.25, cached: 0.225 },
  },
  "fastrouter": {
    "z-ai/glm-5": { input: 0.95, output: 3.15 },
    "z-ai/glm-5.1": { input: 1.05, output: 3.5 },
    "deepseek/deepseek-v4-pro": { input: 1.74, output: 3.48 },
    "google/gemini-3-pro-image-preview": { input: 2, output: 12 },
    "google/gemini-3.1-pro-preview": { input: 2, output: 12 },
    "google/gemma-4-31b-it": { input: 0.13, output: 0.38 },
  },
  "meganova-ai": {
    "XiaomiMiMo/MiMo-V2-Flash": { input: 0.1, output: 0.3 },
    "MiniMaxAI/MiniMax-M2.1": { input: 0.28, output: 1.2 },
    "MiniMaxAI/MiniMax-M2.5": { input: 0.3, output: 1.2 },
    "moonshotai/Kimi-K2.5": { input: 0.45, output: 2.8 },
    "moonshotai/Kimi-K2-Thinking": { input: 0.6, output: 2.6 },
    "deepseek-ai/DeepSeek-V3.2": { input: 0.26, output: 0.38 },
  },
  "mixlayer": {
    "qwen/qwen3.5-35b-a3b": { input: 0.25, output: 1.3 },
    "qwen/qwen3.5-397b-a17b": { input: 0.6, output: 3.6 },
    "qwen/qwen3.5-9b": { input: 0.1, output: 0.4 },
    "qwen/qwen3.5-27b": { input: 0.3, output: 2.4 },
    "qwen/qwen3.5-122b-a10b": { input: 0.4, output: 3.2 },
  },
  "auriko": {
    "minimax-m2-7": { input: 0.3, output: 1.2, cache_creation: 0.375 },
    "claude-opus-4-7": { input: 5, output: 25, cached: 0.5, cache_creation: 6.25 },
    "deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.0028 },
    "gemini-3.1-pro-preview": { input: 2, output: 12, cached: 0.2 },
    "deepseek-v4-pro": { input: 0.435, output: 0.87, cached: 0.003625 },
    "claude-sonnet-4-6": { input: 3, output: 15, cached: 0.3, cache_creation: 3.75 },
  },
  "qiniu": {
    "mimo-v2-flash": { input: 0.1, output: 0.3, cached: 0.01 },
    "xiaomi/mimo-v2-flash": { input: 0.1, output: 0.3, cached: 0.01 },
  },
  // OrcaRouter — live model-card rates (USD / 1M tokens) from
  // https://www.orcarouter.ai/api/public/models/<id> (2026-08-19). Free-tier
  // ids (quota_type:1 / *-free / orcarouter/free) bill $0.
  "orcarouter": {
    "orcarouter/auto": { input: 0, output: 0 },
    "orcarouter/free": { input: 0, output: 0 },
    "orcarouter/fusion": { input: 0, output: 0 },
    "orcarouter/fusion-flash": { input: 0, output: 0 },
    "orcarouter/fusion-mini": { input: 0, output: 0 },
    "openai/gpt-5.5": { input: 5, output: 30, cached: 0.5 },
    "grok/grok-4.3": { input: 1.25, output: 2.5, cached: 0.2 },
    "deepseek/deepseek-v4-pro": { input: 0.442, output: 0.884, cached: 0.06 },
    "deepseek/deepseek-v4-pro-free": { input: 0, output: 0 },
    "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.028 },
    "deepseek/deepseek-v4-flash-free": { input: 0, output: 0 },
    "deepseek/deepseek-reasoner": { input: 0.147, output: 0.295, cached: 0.028 },
    "minimax/minimax-m2.7": { input: 0.3, output: 1.2, cached: 0.06, cache_creation: 0.375 },
    "qwen/qwen3.8-27b-free": { input: 0, output: 0 },
    "qwen/qwen3.8-27b": { input: 0, output: 0 },
    "qwen/qwen3.7-max": { input: 1.25, output: 3.75, cached: 0.25, cache_creation: 1.563 },
    "qwen/qwen3.7-plus": { input: 0.4, output: 1.2 },
    "qwen/qwen3.7-flash": { input: 0.05, output: 0.4 },
    "qwen/qwen3.6-flash": { input: 0.05, output: 0.4 },
    "qwen/qwen3.6-plus": { input: 0.4, output: 1.2 },
    "qwen/qwen3.5-flash": { input: 0.05, output: 0.4 },
    "qwen/qwen3.5-plus": { input: 0.4, output: 1.2 },
    "qwen/qwen3.5-27b": { input: 0.086, output: 0.688 },
    "tencent/hy3-free": { input: 0, output: 0 },
  },
  "crof": {
    "deepseek-v4-pro": { input: 0.35, output: 0.8, cached: 0.003 },
    "deepseek-v4-pro-lightning": { input: 0.8, output: 1.6, cached: 0.02 },
    "deepseek-v4-flash": { input: 0.12, output: 0.21, cached: 0.003 },
    "deepseek-v4-flash-0731": { input: 0.12, output: 0.21, cached: 0.003 },
    "deepseek-v3.2": { input: 0.18, output: 0.35, cached: 0.04 },
    "kimi-k2.6": { input: 0.5, output: 1.99, cached: 0.05 },
    "kimi-k2.7-code": { input: 0.55, output: 2.25, cached: 0.05 },
    "kimi-k3": { input: 2, output: 8, cached: 0.25 },
    "kimi-k3-eco": { input: 1, output: 4, cached: 0.1 },
    "kimi-k2.5-lightning": { input: 1, output: 3, cached: 0.2 },
    "kimi-k2.5": { input: 0.35, output: 1.7, cached: 0.07 },
    "glm-5.1": { input: 0.45, output: 2.15, cached: 0.08, cache_creation: 0 },
    "glm-5.2": { input: 0.5, output: 2.2, cached: 0.08 },
    "glm-4.7": { input: 0.25, output: 1.1, cached: 0.05, cache_creation: 0 },
    "glm-4.7-flash": { input: 0.04, output: 0.3, cached: 0.008, cache_creation: 0 },
    "mimo-v2.5-pro": { input: 0.4, output: 0.8, cached: 0.003 },
    "gemma-4-31b-it": { input: 0.1, output: 0.3, cached: 0.02 },
    "minimax-m2.5": { input: 0.11, output: 0.95, cached: 0.02, cache_creation: 0.375 },
    "qwen3.6-27b": { input: 0.2, output: 1.5, cached: 0.04 },
    "qwen3.5-397b-a17b": { input: 0.35, output: 1.75, cached: 0.07 },
    "qwen3.5-9b": { input: 0.04, output: 0.15, cached: 0.008 },
  },
  "synthetic": {
    "hf:openai/gpt-oss-120b": { input: 0.1, output: 0.1, cached: 0.1 },
    "hf:zai-org/GLM-5.2": { input: 1.4, output: 4.4, cached: 1.4 },
    "hf:moonshotai/Kimi-K2.7-Code": { input: 0.95, output: 4, cached: 0.95 },
    "hf:Qwen/Qwen3.6-27B": { input: 0.45, output: 3.6, cached: 0.45 },
    "hf:MiniMaxAI/MiniMax-M3": { input: 0.6, output: 1.2, cached: 0.6 },
    "hf:zai-org/GLM-4.7-Flash": { input: 0.1, output: 0.5, cached: 0.1 },
    "hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4": { input: 0.3, output: 1, cached: 0.3 },
  },
  "kilo-gateway": {
    "kilo-auto/frontier": { input: 5, output: 25, cached: 0.5, cache_creation: 6.25 },
    "kilo-auto/balanced": { input: 0.325, output: 1.95, cached: 0.0325, cache_creation: 0.40625 },
    "kilo-auto/free": { input: 0, output: 0, cached: 0, cache_creation: 0 },
    "nvidia/nemotron-3-super-120b-a12b:free": { input: 0, output: 0 },
    "arcee-ai/trinity-large-preview:free": { input: 0, output: 0 },
  },
  "wafer": {
    "GLM-5.1": { input: 1, output: 3.2, cached: 0.1, cache_creation: 0 },
  },
  "opencode-zen": {
    "gemini-3-pro": { input: 2, output: 12, cached: 0.2 },
    "claude-opus-4-7": { input: 5, output: 25, cached: 0.5, cache_creation: 6.25 },
    "glm-4.6": { input: 0.6, output: 2.2, cached: 0.1 },
    "ling-3.0-flash-free": { input: 0, output: 0, cached: 0 },
    "laguna-s-2.1-free": { input: 0, output: 0, cached: 0 },
    "nemotron-3.5-lightning-free": { input: 0, output: 0, cached: 0 },
    "x-preview-f-free": { input: 0, output: 0, cached: 0 },
  },
  // OpenCode Go (opencode-go) — $10/mo subscription. Rates from
  // https://opencode.ai/docs/go/ usage table (USD per 1M tokens; DeepSeek
  // off-peak). Overrides canonical MODEL_PRICING where the Go lane charges
  // differently (e.g. gpt-5.6-luna $0.20·$1.20 vs Codex $8·$32).
  "opencode-go": {
    "glm-5.3":              { input: 1.40,  output: 4.40,  cached: 0.26,  reasoning: 4.40 },
    "kimi-k3":              { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00 },
    "longcat-2.0":          { input: 0.30,  output: 1.20,  cached: 0.006, reasoning: 1.20 },
    "deepseek-v4.1-flash":  { input: 0.15,  output: 0.60,  cached: 0.003, reasoning: 0.60 },
    "hy4-preview":          { input: 0.834, output: 2.501, cached: 0.042, reasoning: 2.501 },
    "hy3":                  { input: 0.14,  output: 0.58,  cached: 0.035, reasoning: 0.58 },
    "qwen3.8-max":          { input: 2.00,  output: 6.00,  cached: 0.25,  reasoning: 6.00 },
    "qwen3.8-flash":        { input: 0.15,  output: 0.47,  cached: 0.016, reasoning: 0.47 },
    "grok-4.6":             { input: 2.00,  output: 6.00,  cached: 0.50,  reasoning: 6.00 },
    "gpt-5.6-luna":         { input: 0.20,  output: 1.20,  cached: 0.02,  reasoning: 1.20 },
  },
  "kenari": {
    "claude-opus-4-7": { input: 0, output: 0 },
    "nemotron-3-super-120b-a12b:free": { input: 0, output: 0 },
    "glm-4-7-flash:free": { input: 0, output: 0 },
    "nemotron-3-nano-30b-a3b": { input: 0, output: 0 },
    "kimi-k3": { input: 0, output: 0 },
    "gpt-5-6-luna": { input: 0, output: 0 },
  },
  "poolside": {
    "poolside/laguna-xs-2.1": { input: 0, output: 0, cached: 0, cache_creation: 0 },
    "poolside/laguna-s-2.1": { input: 0, output: 0, cached: 0, cache_creation: 0 },
  },
  "baseten": {
    "MiniMaxAI/MiniMax-M2.5": { input: 0.3, output: 1.2 },
    "nvidia/Nemotron-120B-A12B": { input: 0.3, output: 0.75, cached: 0.06 },
    "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B": { input: 0.6, output: 2.4, cached: 0.12 },
    "moonshotai/Kimi-K2.5": { input: 0.6, output: 3, cached: 0.12 },
    "moonshotai/Kimi-K2.7-Code": { input: 0.95, output: 4, cached: 0.16 },
    "moonshotai/Kimi-K3": { input: 3, output: 15 },
  },
  "friendliai": {
    "MiniMaxAI/MiniMax-M2.5": { input: 0.3, output: 1.2, cached: 0.06 },
    "google/gemma-4-31B-it": { input: 0.14, output: 0.4 },
    "deepseek-ai/DeepSeek-V3.2": { input: 0.5, output: 1.5, cached: 0.25 },
    "zai-org/GLM-5.1": { input: 1.4, output: 4.4, cached: 0.26 },
    "zai-org/GLM-5.2": { input: 1.4, output: 4.4, cached: 0.26 },
  },
  "wandb": {
    "MiniMaxAI/MiniMax-M3": { input: 0.23, output: 0.96, cached: 0.05 },
    "MiniMaxAI/MiniMax-M2.5": { input: 0.3, output: 1.2, cached: 0.3 },
    "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B": { input: 0.75, output: 2.75, cached: 0.15 },
    "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8": { input: 0.2, output: 0.8, cached: 0.2 },
    "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B": { input: 0.1, output: 0.25, cached: 0.05 },
    "google/gemma-4-31B-it": { input: 0.1, output: 0.34, cached: 0.1 },
  },
  "modelscope": {
    "ZhipuAI/GLM-4.5": { input: 0, output: 0 },
    "ZhipuAI/GLM-4.6": { input: 0, output: 0 },
    "Qwen/Qwen3-235B-A22B-Instruct-2507": { input: 0, output: 0 },
    "Qwen/Qwen3-Coder-30B-A3B-Instruct": { input: 0, output: 0 },
    "Qwen/Qwen3-30B-A3B-Thinking-2507": { input: 0, output: 0 },
    "Qwen/Qwen3-30B-A3B-Instruct-2507": { input: 0, output: 0 },
  },
  "digitalocean": {
    "openai-gpt-5.2-pro": { input: 21, output: 168 },
    "openai-gpt-5.6-luna": { input: 0.2, output: 1.2, cached: 0.02 },
    "gte-large-en-v1.5": { input: 0.09, output: 0 },
    "anthropic-claude-4.6-sonnet": { input: 3, output: 15, cached: 0.3, cache_creation: 3.75 },
    "openai-o3": { input: 2, output: 8, cached: 0.5 },
    "anthropic-claude-opus-5": { input: 5, output: 25, cached: 0.5, cache_creation: 6.25 },
  },
  // Routeway free tier — `:free` suffix models are free (rate-limited) by design.
  "routeway": {
    "llama-3.3-70b-instruct:free": { input: 0, output: 0 },
    "nemotron-3-nano-30b-a3b:free": { input: 0, output: 0 },
    "nemotron-nano-9b-v2:free": { input: 0, output: 0 },
    "step-3.7-flash:free": { input: 0, output: 0 },
    "step-3.5-flash:free": { input: 0, output: 0 },
    "laguna-m.1:free": { input: 0, output: 0 },
    "laguna-xs.2:free": { input: 0, output: 0 },
    "llama-3.2-3b-instruct:free": { input: 0, output: 0 },
  },

  // xKiro — live catalog rates (per-1M USD, 2026-09-06 snapshot). reasoning
  // mirrors output per the codebase convention; cache_read from the API.
  xkiro: {
    "anthropic/claude-fable-5": { input: 9, output: 45, cached: 0.9, reasoning: 45 },
    "anthropic/claude-fable-5-1": { input: 10, output: 50, cached: 0.25, reasoning: 50 },
    "anthropic/claude-haiku-4.5": { input: 0.9, output: 4.5, cached: 0.09, reasoning: 4.5 },
    "anthropic/claude-opus-4.6": { input: 4.5, output: 22.5, cached: 0.45, reasoning: 22.5 },
    "anthropic/claude-opus-4.7": { input: 4.5, output: 22.5, cached: 0.45, reasoning: 22.5 },
    "anthropic/claude-opus-4.8": { input: 4.5, output: 22.5, cached: 0.45, reasoning: 22.5 },
    "anthropic/claude-opus-5": { input: 4.5, output: 22.5, cached: 0.45, reasoning: 22.5 },
    "anthropic/claude-sonnet-4.6": { input: 2.7, output: 13.5, cached: 0.27, reasoning: 13.5 },
    "anthropic/claude-sonnet-5": { input: 1.8, output: 9, cached: 0.18, reasoning: 9 },
    "deepseek/deepseek-chat-v3.1": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "deepseek/deepseek-v3.2": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "deepseek/deepseek-v4-flash": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "deepseek/deepseek-v4-flash-0731": { input: 0.091, output: 0.182, cached: 0.0182, reasoning: 0.182 },
    "deepseek/deepseek-v4-flash-vision-exp": { input: 0.143, output: 0.429, cached: 0.00455, reasoning: 0.429 },
    "deepseek/deepseek-v4-pro": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "deepseek/deepseek-v4-pro-0813": { input: 0.28275, output: 0.5655, cached: 0.00234, reasoning: 0.5655 },
    "google/gemini-2.5-flash": { input: 0.195, output: 1.625, cached: 0, reasoning: 1.625 },
    "google/gemini-2.5-pro": { input: 0.8125, output: 6.5, cached: 0, reasoning: 6.5 },
    "google/gemini-3-flash": { input: 0.325, output: 1.95, cached: 0, reasoning: 1.95 },
    "google/gemini-3.1-pro": { input: 1.3, output: 7.8, cached: 0, reasoning: 7.8 },
    "google/gemini-3.5-flash": { input: 0.975, output: 5.85, cached: 0, reasoning: 5.85 },
    "google/gemini-3.6-flash": { input: 0.975, output: 4.875, cached: 0, reasoning: 4.875 },
    "google/gemini-3.7-flash": { input: 0.24375, output: 1.21875, cached: 0, reasoning: 1.21875 },
    "google/gemini-3.8-flash": { input: 0.4875, output: 2.4375, cached: 0, reasoning: 2.4375 },
    "meta/muse-spark-1.2-contributor": { input: 0.065, output: 0.13, cached: 0.0013, reasoning: 0.13 },
    "minimax/minimax-m2:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "minimax/minimax-m2.1-highspeed:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "minimax/minimax-m2.1:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "minimax/minimax-m2.5": { input: 0.27, output: 1.08, cached: 0.027, reasoning: 1.08 },
    "minimax/minimax-m2.5-highspeed:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "minimax/minimax-m2.5:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "minimax/minimax-m2.7": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "minimax/minimax-m2.7-highspeed:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "minimax/minimax-m2.7:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "minimax/minimax-m3": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "minimax/minimax-m3:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistralai/codestral-2508": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistralai/devstral-medium": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistralai/ministral-14b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistralai/ministral-3b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistralai/ministral-8b": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistralai/mistral-large-2512": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistralai/mistral-medium-3.5": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "mistralai/mistral-small-2603": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "moonshotai/kimi-k2.5": { input: 0.285, output: 1.425, cached: 0, reasoning: 1.425 },
    "moonshotai/kimi-k2.6": { input: 0.475, output: 2, cached: 0, reasoning: 2 },
    "moonshotai/kimi-k2.7-code": { input: 0.455, output: 2.275, cached: 0, reasoning: 2.275 },
    "moonshotai/kimi-k3": { input: 1.95, output: 9.75, cached: 0, reasoning: 9.75 },
    "nvidia/llama-3.3-nemotron-super-49b": { input: 0.1, output: 0.32, cached: 0, reasoning: 0.32 },
    "nvidia/nemotron-3-nano": { input: 0.05, output: 0.2, cached: 0.0165, reasoning: 0.2 },
    "nvidia/nemotron-3-nano-omni": { input: 0.05, output: 0.2, cached: 0.03, reasoning: 0.2 },
    "nvidia/nemotron-3-super": { input: 0.08, output: 0.45, cached: 0.0264, reasoning: 0.45 },
    "nvidia/nemotron-3-ultra": { input: 0.5, output: 2.2, cached: 0.165, reasoning: 2.2 },
    "openai/gpt-5.3-codex-spark": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "openai/gpt-5.4": { input: 2.25, output: 13.5, cached: 0.225, reasoning: 13.5 },
    "openai/gpt-5.4-mini": { input: 0.675, output: 4.05, cached: 0.0675, reasoning: 4.05 },
    "openai/gpt-5.5": { input: 4.5, output: 27, cached: 0.45, reasoning: 27 },
    "openai/gpt-5.6-luna": { input: 0.1, output: 0.6, cached: 0.05, reasoning: 0.6 },
    "openai/gpt-5.6-sol": { input: 4.5, output: 27, cached: 0.45, reasoning: 27 },
    "openai/gpt-5.6-terra": { input: 1, output: 6, cached: 0.125, reasoning: 6 },
    "openai/gpt-6-astra": { input: 10, output: 50, cached: 1, reasoning: 50 },
    "qwen/qwen-plus-2025-07-28:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3-coder-plus:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3-max:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3-omni-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3-vl-plus:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.5-397b-a17b:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.5-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.5-omni-flash:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.5-omni-plus:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.5-plus": { input: 0.3, output: 1.8, cached: 0, reasoning: 1.8 },
    "qwen/qwen3.5-plus:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.6-27b:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.6-35b-a3b:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.6-max-preview:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.6-plus": { input: 0.325, output: 1.95, cached: 0, reasoning: 1.95 },
    "qwen/qwen3.6-plus:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.7-max": { input: 1.475, output: 4.425, cached: 0.295, reasoning: 4.425 },
    "qwen/qwen3.7-max:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.7-plus": { input: 0.32, output: 1.28, cached: 0.064, reasoning: 1.28 },
    "qwen/qwen3.7-plus:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "qwen/qwen3.8-max": { input: 2, output: 6, cached: 0.25, reasoning: 6 },
    "qwen/qwen3.8-max:free": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "sensenova/sensenova-6.7-flash-lite": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "sensenova/sensenova-6.8-flash-lite": { input: 0, output: 0, cached: 0, reasoning: 0 },
    "tencent/hy3": { input: 0.08151, output: 0.32604, cached: 0.020378, reasoning: 0.32604 },
    "tencent/hy4-preview": { input: 0.5421, output: 1.62565, cached: 0, reasoning: 1.62565 },
    "x-ai/grok-4.5": { input: 1, output: 3, cached: 0, reasoning: 3 },
    "x-ai/grok-4.6": { input: 1, output: 3, cached: 0, reasoning: 3 },
    "x-ai/grok-build-0.1": { input: 0.5, output: 1, cached: 0, reasoning: 1 },
    "xiaomi/mimo-v2.5": { input: 0.091, output: 0.182, cached: 0.00715, reasoning: 0.182 },
    "xiaomi/mimo-v2.5-pro": { input: 0.28275, output: 0.5655, cached: 0.00234, reasoning: 0.5655 },
    "z-ai/glm-4.5": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-4.5-air": { input: 0.2, output: 1.1, cached: 0.03, reasoning: 1.1 },
    "z-ai/glm-4.5-airx": { input: 1.1, output: 4.5, cached: 0.22, reasoning: 4.5 },
    "z-ai/glm-4.5-flash": { input: 0.2, output: 1.1, cached: 0, reasoning: 1.1 },
    "z-ai/glm-4.5-x": { input: 2.2, output: 8.9, cached: 0.45, reasoning: 8.9 },
    "z-ai/glm-4.5v": { input: 0.6, output: 1.8, cached: 0.11, reasoning: 1.8 },
    "z-ai/glm-4.6": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-4.6v": { input: 0.3, output: 0.9, cached: 0.05, reasoning: 0.9 },
    "z-ai/glm-4.6v-flash": { input: 0.04, output: 0.4, cached: 0, reasoning: 0.4 },
    "z-ai/glm-4.6v-flashx": { input: 0.04, output: 0.4, cached: 0.004, reasoning: 0.4 },
    "z-ai/glm-4.7": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-4.7-flash": { input: 0.07, output: 0.4, cached: 0, reasoning: 0.4 },
    "z-ai/glm-4.7-flashx": { input: 0.07, output: 0.4, cached: 0.01, reasoning: 0.4 },
    "z-ai/glm-5": { input: 1, output: 3.2, cached: 0.2, reasoning: 3.2 },
    "z-ai/glm-5-turbo": { input: 1.2, output: 4, cached: 0.24, reasoning: 4 },
    "z-ai/glm-5.1": { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
    "z-ai/glm-5.2": { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
    "z-ai/glm-5.3": { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
    "z-ai/glm-5.3-flash": { input: 0.15, output: 0.5, cached: 0.03, reasoning: 0.5 },
    "z-ai/glm-5v-turbo": { input: 1.2, output: 4, cached: 0.24, reasoning: 4 },
  },
};

/**
 * Pattern-based pricing fallback — matched when no exact model entry found.
 * Patterns use simple glob: "*" matches any substring.
 * First match wins — order matters.
 */
export const PATTERN_PRICING = [
  // --- Codex variants ---
  { pattern: "*-codex-xhigh",   pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: "*-codex-high",    pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-max",     pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-mini-*",  pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-mini",    pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-low",     pricing: { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00,  cache_creation: 4.00  } },
  { pattern: "*-codex-none",    pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "*-codex-spark",   pricing: { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  } },
  { pattern: "codex-*",         pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "*-codex",         pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },

  // --- Claude ---
  { pattern: "claude-opus-*",   pricing: { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  } },
  { pattern: "claude-sonnet-*", pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },
  { pattern: "claude-haiku-*",  pricing: { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  } },
  { pattern: "claude-*",        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },

  // --- Gemini (specific first, generic last) ---
  { pattern: "gemini-*-flash-lite", pricing: { input: 0.15, output: 1.25, cached: 0.015, reasoning: 1.875, cache_creation: 0.15 } },
  { pattern: "gemini-*-flash",  pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*-pro",    pricing: { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  } },
  { pattern: "gemini-3-*",      pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },
  { pattern: "gemini-2.5-*",    pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*",        pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },

  // --- GPT (specific first, generic last) ---
  { pattern: "gpt-5.3-*",       pricing: { input: 6.00,  output: 24.00, cached: 3.00,  reasoning: 36.00,  cache_creation: 6.00  } },
  { pattern: "gpt-5.2-*",       pricing: { input: 5.00,  output: 20.00, cached: 2.50,  reasoning: 30.00,  cache_creation: 5.00  } },
  { pattern: "gpt-5.1-*",       pricing: { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00,  cache_creation: 4.00  } },
  { pattern: "gpt-5-*",         pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "gpt-5*",          pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "gpt-4o-*",        pricing: { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90,   cache_creation: 0.15  } },
  { pattern: "gpt-4o",          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: "gpt-4*",          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },

  // --- o1 / o-series ---
  { pattern: "o1-*",            pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "o1",              pricing: { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00,  cache_creation: 15.00 } },
  { pattern: "o3-*",            pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  // Bare "o3" id (openai/o3) — the o3-* pattern needs a dash and never matched it.
  { pattern: "o3",              pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: "o4-*",            pricing: { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  } },

  // --- Qwen ---
  { pattern: "qwen3-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Kimi ---
  { pattern: "kimi-*-thinking",  pricing: { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  } },
  { pattern: "kimi-k2*",        pricing: { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  } },
  { pattern: "kimi-*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },

  // --- DeepSeek ---
  { pattern: "deepseek-*reasoner*", pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },
  { pattern: "deepseek-r*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-v*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-*",      pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },

  // --- GLM ---
  { pattern: "glm-5*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "glm-4*",          pricing: { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  } },
  { pattern: "glm-*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- MiniMax ---
  { pattern: "MiniMax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "minimax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Grok ---
  // Canonical pricing (pre-200k): grok-4.6 $2/$6, grok-4.5 $2/$6, grok-4.3 $1.25/$2.5
  // Long-context pricing (≥200k): 2x for all tokens. MODEL_PRICING + xai PROVIDER_PRICING
  // pin exact rates; these patterns are last-resort fallbacks for unknown grok-*.
  { pattern: "grok-4.6*",       pricing: { input: 2.00,  output: 6.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 2.00  } },
  { pattern: "grok-4.5*",       pricing: { input: 2.00,  output: 6.00,  cached: 0.30,  reasoning: 6.00,   cache_creation: 2.00  } },
  { pattern: "grok-code-*",     pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "grok-*",          pricing: { input: 2.00,  output: 6.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 2.00  } },
];

/**
 * Match a model ID against a glob pattern (* = wildcard). Case-insensitive:
 * registry ids mix casing (e.g. "MiniMax-M2.5" vs "minimax-m2.5").
 */
export function matchPattern(pattern, model) {
  const regex = new RegExp("^" + pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return regex.test(model);
}

/**
 * Resolve pricing for a model using the 3-step fallback chain:
 *   1. PROVIDER_PRICING[provider][model]
 *   2. MODEL_PRICING[model]
 *   3. PATTERN_PRICING (glob match)
 *
 * @param {string} provider
 * @param {string} model
 * @returns {object|null}
 */
export function getPricingForModel(provider, model) {
  if (!model) return null;
  // Providers arrive as registry ids at runtime (usageRepo, chatCore) but as
  // aliases from UI call sites (StatsBar). Normalize alias → id so both keys
  // hit the same table.
  provider = resolveProviderAlias(provider);

  // 1. Provider-specific override
  if (provider && PROVIDER_PRICING[provider]?.[model]) {
    return PROVIDER_PRICING[provider][model];
  }

  // 2. Canonical model pricing (strip vendor prefix if needed: "deepseek/deepseek-chat" → "deepseek-chat")
  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  if (MODEL_PRICING[baseModel]) return MODEL_PRICING[baseModel];
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  // 3. Pattern match
  for (const { pattern, pricing } of PATTERN_PRICING) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return pricing;
    }
  }

  return null;
}

/**
 * Get all provider pricing (for UI / API).
 * Returns PROVIDER_PRICING — consumers should fall back to MODEL_PRICING for unlisted models.
 */
export function getDefaultPricing() {
  return PROVIDER_PRICING;
}

/**
 * Format cost for display
 * @param {number} cost
 * @returns {string}
 */
export function formatCost(cost) {
  if (cost === null || cost === undefined || isNaN(cost)) return "$0.00";
  return `$${cost.toFixed(2)}`;
}

/**
 * Calculate cost from tokens and pricing
 * @param {object} tokens
 * @param {object} pricing
 * @returns {number} cost in dollars
 */
export function calculateCostFromTokens(tokens, pricing) {
  if (!tokens || !pricing) return 0;

  let cost = 0;

  const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
  const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
  // prompt_tokens is cache-inclusive (see canonicalizeUsage): cached + cache_creation
  // are subsets, so subtract both to avoid charging them at the full input rate.
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens - cacheCreationTokens);

  cost += nonCachedInput * (pricing.input / 1000000);

  if (cachedTokens > 0) {
    cost += cachedTokens * ((pricing.cached || pricing.input) / 1000000);
  }

  const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
  cost += outputTokens * (pricing.output / 1000000);

  const reasoningTokens = tokens.reasoning_tokens || 0;
  if (reasoningTokens > 0) {
    cost += reasoningTokens * ((pricing.reasoning || pricing.output) / 1000000);
  }

  if (cacheCreationTokens > 0) {
    cost += cacheCreationTokens * ((pricing.cache_creation || pricing.input) / 1000000);
  }

  return cost;
}
