// Combo Template Library — prebuilt combo configurations that users can one-click apply.
//
// Each template references models in `providerAlias/modelId` format (the same format
// used by the combos API). The UI checks provider availability and grays out templates
// whose required providers aren't connected.
//
// To add a template: append to this array. No DB change needed.

export const COMBO_TEMPLATES = [
  {
    id: "always-on",
    name: "Always-On (5-Layer Fallback)",
    description:
      "Zero-downtime coding with 5 layers of fallback. Mix of subscription, cheap, and free tiers — if any model fails, the next picks up automatically.",
    icon: "shield",
    category: "reliability",
    strategy: "fallback",
    models: [
      "cc/claude-opus-4-7",          // subscription primary
      "cx/gpt-5.4",                   // second subscription
      "glm/glm-5.1",                  // cheap, resets daily
      "minimax/MiniMax-M2.7",         // cheapest
      "kr/claude-sonnet-4.5",         // free unlimited
    ],
    requiredProviders: ["claude", "codex", "glm", "minimax", "kiro"],
  },
];
