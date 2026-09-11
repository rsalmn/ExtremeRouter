import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";

// Chat-only lane (/zen/go/v1/chat/completions) — no per-model targetFormat.
// SourceFormat-matched transport stays on this default so a Claude client is
// never routed to /messages for a model that lacks it.
const CHAT_MODELS = [
  "glm-5.3",
  "glm-5.2",
  "glm-5.2-high",
  "glm-5.2-max",
  "glm-5.1",
  "kimi-k3",
  // OpenCode Go docs' endpoint table currently says kimi-k2.7, but its
  // config example and the live API use kimi-k2.7-code.
  "kimi-k2.7-code",
  "kimi-k2.6",
  "longcat-2.0",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "deepseek-v4-pro-low",
  "deepseek-v4-pro-medium",
  "deepseek-v4-pro-high",
  "deepseek-v4-pro-max",
  "deepseek-v4-flash",
  "mimo-v2.5",
  "mimo-v2.5-high",
  "mimo-v2.5-max",
  "mimo-v2.5-pro",
  "hy4-preview",
  "hy3",
];

// Anthropic messages lane (/zen/go/v1/messages) — targetFormat claude.
const MESSAGES_MODELS = [
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.8-max",
  "qwen3.8-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
];

// Responses-only lane (/zen/go/v1/responses) — Muse Spark + Responses-API
// upstreams (Grok, GPT Luna).
const RESPONSES_MODELS = [
  "muse-spark-1.2-contributor",
  "muse-spark-1.3-contributor",
  "grok-4.6",
  "gpt-5.6-luna",
];

describe("OpenCode Go official model catalog", () => {
  it("matches the documented OpenCode Go model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((model) => model.id);

    expect(ids).toEqual([...CHAT_MODELS, ...MESSAGES_MODELS, ...RESPONSES_MODELS]);
  });

  it("marks Responses-only models (muse-spark, grok-4.6, gpt-5.6-luna)", () => {
    for (const model of RESPONSES_MODELS) {
      expect(getModelTargetFormat("opencode-go", model)).toBe("openai-responses");
      expect(getModelTargetFormat("ocg", model)).toBe("openai-responses");
    }
  });

  it("marks documented Qwen and MiniMax models as Anthropic messages format", () => {
    for (const model of MESSAGES_MODELS) {
      expect(getModelTargetFormat("opencode-go", model)).toBe("claude");
    }
  });

  it("keeps chat-only models on OpenAI-compatible format (no targetFormat)", () => {
    for (const model of CHAT_MODELS) {
      expect(getModelTargetFormat("opencode-go", model)).toBeNull();
    }
  });
});

describe("OpenCode Go endpoint routing", () => {
  it("routes Qwen and MiniMax models to the messages endpoint with x-api-key auth", () => {
    const executor = new OpenCodeGoExecutor();

    for (const model of MESSAGES_MODELS) {
      expect(executor.buildUrl(model)).toBe("https://opencode.ai/zen/go/v1/messages");
      const headers = executor.buildHeaders({ apiKey: "sk-test" }, false);
      expect(headers["x-api-key"]).toBe("sk-test");
      expect(headers["anthropic-version"]).toBeDefined();
      expect(headers.Authorization).toBeUndefined();
    }
  });

  it("routes chat-only models to chat/completions with bearer auth", () => {
    const executor = new OpenCodeGoExecutor();

    for (const model of CHAT_MODELS) {
      expect(executor.buildUrl(model)).toBe("https://opencode.ai/zen/go/v1/chat/completions");
      const headers = executor.buildHeaders({ apiKey: "sk-test" }, false);
      expect(headers.Authorization).toBe("Bearer sk-test");
      expect(headers["x-api-key"]).toBeUndefined();
      expect(headers["anthropic-version"]).toBeUndefined();
    }
  });

  it("routes Responses-only models to /responses (muse-spark, grok-4.6, gpt-5.6-luna)", () => {
    const executor = new OpenCodeGoExecutor();

    for (const model of RESPONSES_MODELS) {
      expect(executor.buildUrl(model)).toBe("https://opencode.ai/zen/go/v1/responses");
    }
    // Thinking suffix does not derail routing.
    expect(executor.buildUrl("grok-4.6(high)")).toBe("https://opencode.ai/zen/go/v1/responses");
    expect(executor.buildUrl("gpt-5.6-luna(max)")).toBe("https://opencode.ai/zen/go/v1/responses");
  });
});
