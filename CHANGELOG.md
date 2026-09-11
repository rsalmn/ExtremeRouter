# v0.8.9 (2026-09-11)

## Features
- **Single-executable distribution (Node SEA)** — ExtremeRouter now ships as one self-contained binary per platform (`ExtremeRouter-windows-x64.exe`, `-linux-x64`, `-macos-arm64`), omniroute-style: no Node install, no Docker. The Next standalone build is traced into the CLI payload, stitched with the SEA bootstrap into one blob, and `postject` injects it into official Node 24 dist binaries. Quad-mode executable: serve the gateway, `--version`, `--extract` (runtime dir), and runner mode for child-process spawns; the payload auto-extracts once per version into DATA_DIR, manifest-gated and idempotent. Built by `exe-publish.yml` from a SINGLE ubuntu runner (cross-inject — per-OS builds proved fragile), with a linux serve smoke, a dedicated macOS re-sign job, and release uploads on tags. Mach-O targets require `--macho-segment-name NODE_SEA` (without it the kernel SIGKILLs the injected binary even after a valid ad-hoc re-sign); node-dist downloads are gzip-validated with bounded retries and Windows-safe tar invocation. Docker Hub publish fixed alongside: the >100-char short description was rejected with HTTP 400 (truncated + defensively capped). [`85eb9e3`, `efa7c39`, `52fd05f`, `a45023f`]
- **Capability drift audit (read-only)** — `npm run audit:capabilities` flags drift between the hand-written capability tables and outside sources of truth, for HUMAN review; nothing is auto-applied. Offline mode compares against models.dev (runtime snapshot or TTL-cached raw fetch) and tags every finding `LOW_CONFIDENCE_SOURCE` — models.dev is intentionally the weaker source, and providers it does not list are normal INFO, not errors. Live mode fetches the 27 registry `modelsFetcher` gateways (per-provider `AUDIT_CAPS_<ID>_KEY` env keys, keyless providers skipped never failed) with real severities: `MISMATCH` (10% numeric tolerance = the runtime sync rule; boolean strict), `STALE_KEY` (hand-written id retired/renamed), `MISSING_ENTRY` (live concrete context_window but runtime resolves to the DEFAULT floor). Findings carry `capabilities.js:LINE` pointers; a weekly advisory CI job publishes the report as artifact + annotations. [`989f46c`]

## Fixes
- **Cascade external streaming contract** — combo members in a `stream:true` client request no longer receive a raw `application/json` body ("The model returned no content" while the provider attempt and canonicalAttempt were both `success`). Cascade stages remain internally non-streaming (required to parse CONFIDENCE), but the finalized answer is now adapted to an OpenAI SSE stream at the external boundary — content, reasoning, tool_calls, finish_reason, usage preserved, exactly one `[DONE]`. [`c8b403b`]
- **Bynara capability/pricing drift (real production incident)** — the static mirror pinned `glm-5.3-flash-free` at 128K context while live reports 1M; large Swarm-panel prompts starved `resolveOutputBudget` (availableContext ≤ 0) and wrote `max_tokens: 0` on the wire, which Bynara rejects → empty-stream `provider_error`. Corrected to 1000000; `glm-5.3-free` (no entry, reasoning silently disabled by the DEFAULT floor) added; dead keys `ling-3.0-flash-free` → `ling-3.0-flash-fin-free` and `nemotron-3-ultra` → `nemotron-3.5-lightning-free` (real live ids — the old overrides never applied); pricing keys renamed in sync. [`f0f91ed`]
- **Combos page: provider icons + capability badges for every member shape** — member lookups were exact-string against the static catalog's `alias/model` keys, so bare names (`glm-5.3-flash-free`), lane-aliased refs (`cbai/hy3`, `cl/z-ai/glm-5.3-flash`, nested `xkiro/deepseek/deepseek-v4-pro`) and dynamic-provider models (bynara/tokenharbor) rendered with no icon and no badges. Resolution moved server-side (`POST /api/models/refs` + pure `refsResolve` using the same alias/precedence logic as the runtime); icons now render in collapsed chips, the expanded list, and edit-modal rows. [`19daed3`]

## Security
- **Runtime dependency audit cleared** — Next.js ≤16.3.2 CRITICAL unauthenticated RCE on windows-hosted servers (GHSA-p293-qw3h-jr36) and Image Optimization AVIF RCE (GHSA-2xp9-vwfh-vxw4) → next 16.3.4; sharp <0.35.4 HIGH libheif chain → 0.35.4; baseline-browser-mapping <2.11.0 DoS → 2.11.21. `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities; build and full suite re-verified green on the upgraded core. NOTE: v0.8.8 Docker images / executables predate this bump. [`68125cb`]

## Tests
- New suites: cascade external stream contract (8), model refs resolver covering all reported member shapes + drift guards (9), bynara live-capture drift-guard pins (contextWindow 1M, glm-5.3-free reasoning, live-id mirror resolution). Full suite green (4,036 tests).

---

# v0.8.8 (2026-09-07)

## Features
- **New Provider: xKiro** (`xkiro`, api-key) — 112-model catalog generated from the LIVE `/v1/models` snapshot (GPT, Claude, Gemini, GLM, Kimi, DeepSeek, Qwen, MiniMax, Mistral families behind one `sk-xt-` key). Per-model live pricing (per-1M USD, reasoning mirrors output), vendor-prefixed ids end-to-end, capability/effort mapping measured from `reasoning_efforts` (graded scales, `minimal`-as-off for Gemini 3.6 Flash, explicit `none` for GLM-5.2), faithful remap of two-position switch shapes (`off/on` → none/low, `adaptive/disabled` → none/medium), and vision passthrough (images to non-vision models are degraded gracefully upstream instead of failing).
- **xKiro Quota Tracker** — `/v1/usage` handler (free endpoint, same chat key): 5h/7d spend windows with exact fixed-point USD parsing and ISO reset times, the daily free-token allowance as an independent budget resetting at 00:00 UTC, and the prepaid wallet as an unlimited-style row. Pay-as-you-go accounts render the wallet as the only limit; 401/network failures degrade to actionable messages.
- **Codex GPT-6.0 Astra** (`gpt-6-astra`) — vision + thinking + search, 272k context / 128k output, codex-scoped `*gpt-6*` thinking pattern and a generic `*gpt-6*` capability pattern for future 6.x ids.
- **OpenCode Go Muse Spark lane** — `muse-spark-1.3-contributor` + `muse-spark-1.2-contributor` registered responses-only (`/zen/go/v1/responses`); Responses→chat streaming tool calls keyed by item_id so parallel tool calls never merge into index 0; standardized tool coercions (call_id clamping, fail-soft argument/output coercion, bare object schemas filled) shared between the translator and the executor; collision-proof overlong call_id truncation (deterministic hash suffix) and unique same-millisecond fallback ids.
- **Qoder refresh** — catalog updated to the live 2026-09 model list (`lite`, `qmodel_38max`/Qwen3.8-Max, `qfmodel`/Qwen3.8-Flash, `gmodel`/GLM-5.3, `gfmodel`/GLM-5.3-Flash, Kimi-K3; dead `qmodel_preview`/`gm51model` removed), `PROVIDER_CAPABILITIES['qoder']` maps the opaque internal ids to their real models' context windows and limits, and the executor now preserves image blocks (http/data-URI passthrough, Claude-style source conversion) instead of flattening them away. Docker build uses CN mirrors for apk and npm.
- **CodeBuddy catalog refresh** — `hy4-preview`, `hy4-preview-x`, `glm-5.3`, `glm-5.3-flash`, `kimi-k3-1` added with capability windows and effort sets; dead `glm-5.0`/`glm-4.7` (API 11102) removed on the CodeBuddy gateway; hy4 pricing (subscription) + GLM-5.3/K3 effort tiers in `PATTERN_THINKING`.
- **Claude Fable 5.1** — added to the Claude catalog (1M context, permanently adaptive thinking); the spoofed Claude Code version centralized as a single `CLAUDE_CLI_VERSION` constant feeding both the request User-Agent and the billing `cc_version` (2.1.258, bumped for new-model access); permanently adaptive models send `output_config.effort` without the redundant thinking switch.
- **Gemini 3.8 Flash tiers** — `*gemini-3.8*` capabilities, antigravity registry tiers, MITM synonyms and tiered routing; Antigravity IDE fingerprint bumped to 2.11.0.
- **Video generation expansion** — xAI `grok-imagine-video-1.5` text-to-video through the async submit/poll adapter pipeline; Bynara `agnes-video-v2.0` T2V.
- **Provider-agnostic media-result URL layer** — shared media-result store with process-global singleton semantics so cross-route media reads work; authenticated/public artifact handling behind the existing SSRF-safe downloader.
- **Forensic observability for empty responses** — empty streams now persist a complete canonical evidence chain (per-event counters, transport/terminal evidence) so `empty_output` incidents are diagnosable from the request detail alone.

## Fixes
- **Antigravity false `empty_output` chain (3 defects, forensically proven)** — the Gemini SSE wrapper (`{"response":{...}}`) is now unwrapped before stream observation and content accumulation; `functionCall` parts are recorded as tool-call evidence (a tool-call-only response can no longer classify as empty); and the output ceiling is model-aware (Gemini 3.x advertise 65536 output tokens — the blanket 16384 clamp truncated every `-high` thinking run with `finishReason=MAX_TOKENS` before the answer landed).
- **Diagnosable all-failed envelope** — when a combo exhausts every candidate, the 503 error now carries the last canonical classification (e.g. `last candidate ag/gemini-3.8-flash-high: incomplete/no_successful_terminal (finish_reason=max_tokens)`) instead of the useless raw status `"200"` that clients rendered as a fake "captcha/empty response" banner.
- **`[DONE]` sentinel at translate-mode EOF** — OpenAI-format clients now always receive the `data: [DONE]` terminator; strict clients previously treated a complete stream as truncated and re-issued the request (observed as rapid duplicate POSTs).
- **`openai` vs `openai-responses` reasoning wire formats separated** — the Responses direction emits `reasoning: { effort }` and never `reasoning_effort`, fixing the Muse Spark HTTP 400 (`unknown parameter reasoning_effort`); level clamping stays capability-driven and `ultra` ranks above `max`.
- **OpenCode Muse Spark** — all Muse Spark models (not just 1.2) route to `/zen/v1/responses` with vision declared; inline images preserved in the Kiro MITM OpenAI direction.
- **9router v0.5.69 sync** — Claude adaptive requests normalize `auto` effort to `high` (Anthropic 400 fix); SSRF guard on the cowork-MCP probe (remote callers cannot force internal fetches, local self-hosted MCP keeps working); Google anti-abuse spacing for antigravity/gemini-cli background token refreshes and projectId onboarding retries (env-tunable); anthropic-compatible nodes fronting Anthropic now send the `context-management` beta set (improved over upstream: first-party Claude keeps the full cached fingerprint instead of replacing it).
- **Video/Runway/Bynara** — Runway T2V aligned with the verified gen4.5 contract; Bynara T2V host corrected to `router.bynara.id` (live probe).
- **Combo forensics** — attempt persistence serialized so evidence can never overtake an earlier candidate; redaction hardening on persisted request details.

## Community
- **@helmiau** — [#32](https://github.com/rsalmn/ExtremeRouter/pull/32): fixed the DB import crash by binding `invalidateSettingsCache`/`invalidateConnectionsCache` locally; [#33](https://github.com/rsalmn/ExtremeRouter/pull/33): refreshed provider SVG icons and favicon assets; [#36](https://github.com/rsalmn/ExtremeRouter/pull/36): pointed the headroom image at the correct repository; [#37](https://github.com/rsalmn/ExtremeRouter/pull/37): replaced the sidebar hub icon with the ExtremeRouter favicon. Terima kasih! 🙏

## Tests
- 10 new suites: xKiro provider + usage handler (29 tests), Responses parallel-tool-calls and downstream SSE contract (final-body + [DONE] + combo ownership), Gemini tool-call evidence and wrapped-event observability, opencode-go Muse Spark responses, claude header forwarding beta flags, cowork-MCP SSRF guard, model consistency gate extensions (xkiro/astra/codebuddy/qoder), and the GPT-6.0 Astra capability pins. Full suite green (281 files / 4,011 tests).

# v0.8.7 (2026-08-31)

## Features
- **Canonical Attempt architecture** — every ChatResult now carries a `canonicalAttempt` evidence hold (logical success, usable output, transport/finish/terminal evidence, observational stream state) unified across streaming, forced-SSE and non-streaming paths. `classifyCanonicalAttempt` derives a deterministic outcome class (success / transport_failure / provider_failure / empty_output / incomplete / cancelled) from the finalized evidence only.
- **Canonical policy engine** — `canonicalPolicy` derives one authoritative `{fallbackEligible, retryable, stopProgression, health}` decision per attempt, replacing scattered status-based re-derivation. Health execution is isolated from fallback decisions (health side-effect stays, its return no longer drives fallback).
- **Combo consumes canonical retry/fallback policy** — candidate progression and same-account retry in `handleComboChat` and the single-model account loop now read the finalized policy: non-retryable client errors (400/405/406/413/415/422) and client abort stop; 401/403/404/provider_error/malformed/429/5xx/empty-output fall back to the next candidate with no new same-account retry loop. Fusion/Swarm/Cascade gate on `candidateServed` (logical success) unchanged.
- **Dynamic model capability catalog** — background sync from models.dev with ETag caching, `validatedAt` freshness (304 Not Modified extends freshness instead of restarting the clock), and one vote per provider in modality majority. Wired through `/api/models/catalog-sync`, the catalog worker, and a frozen provenance contract (sourceType/confidence/known semantics).
- **contextWindow/maxOutput audit + canonical token budget** — canonical `resolveOutputBudget` with hard/soft constraint separation and provider output ceilings (`providerOutputLimits`); `max_output_tokens > max_completion_tokens > max_tokens` precedence unified across every translator path.
- **New OAuth Provider: ZCode (zcode.z.ai)** — device-style browser OAuth; chat routed through Anthropic legs with auth-error fallback; credentials sent as `x-api-key` + `Authorization: Bearer`; Start Plan captcha wall surfaced as an actionable error.
- **New Provider: Alibaba Token Plan (alitp-intl)** — ported with golden URL/header snapshots.
- **Zed usage handler** — connected Zed accounts now appear on `/dashboard/quota` with plan label, edit predictions, and billing-cycle reset.
- **Kiro gateway-first** — `runtime.us-east-1.kiro.dev` attempted first, with 401/403/404 fallback to the AWS host.
- **Antigravity quota consolidation** — quota display reduced to 4 resource families (Claude Sonnet 4.6 Thinking, Claude Opus 4.6 Thinking, GPT-OSS 120B Medium, Gemini Family).
- **Bynara moved to the free tab** with live model capability catalog sync.
- **Gemini 3.7 Flash tiered models** (port from 9router) with plain wire model IDs.
- **xAI Grok 4.5/4.6 catalog + quota tracker improvements**.
- **OpenCode Muse Spark routing** — muse-spark models route via `/zen/v1/responses` (Responses executor path); request-scoped session/request identity removes executor singleton state.
- **Provider capability hardening** — provider-scoped limits, unverified-capability marker, output ceiling; tokenrouter qwen reasoning clamped to low/medium.
- **Streaming request details** — start non-terminal (`streaming`) and finalize from the canonical outcome; SSE emission counter hardened.
- **Usage API-key hashing + opt-in observability** — gateway keys hashed at rest (migration 006), opt-in sampling, unified status constants (migration 007).
- **Circuit breaker toggle** on the Profile page.
- **Real brand icons** — 35 letter-avatar placeholders replaced with real provider logos.
- **Console-log redesign** — structured live log viewer with level filters, component tags, search highlight, pause/resume, scroll pinning, wrap/timestamp toggles, copy/download, and ANSI-code stripping.

## Fixes
- **limits audit (3 confirmed bugs)** — 7 registries declaring limits as `contextLength`/`maxOutputTokens` had them silently dropped (kiro/windsurf/aihorde/bazaarlink/hyperagent/theoldllm/mimocode); `translateRequest` honored the lowest-precedence token budget instead of `max_output_tokens > max_completion_tokens > max_tokens`; openai-to-cursor/commandcode re-clamped capability-less models against the 200K floor. All corrected; canonical name wins when a model declares both spellings.
- **ZCode start-plan auth** — authenticate with the OAuth JWT, not the coding key; send credential as `x-api-key` + `Authorization: Bearer`; surface the captcha wall as an actionable error instead of a silent 400.
- **Provider statuses** — orcarouter 404, bynara 400, and hcnsec 429 resolved; UI model strings routed by canonical alias rather than `uiAlias`.
- **Antigravity 404** — `gemini-3.7-flash-high` quota detail now resolves the plain wire model ID for the CodeAssist API.
- **projectId onboardUser** — skipped for the `daily-cloudcode-pa` endpoint and the antigravity provider.
- **Token refresh** — added cline/clinepass handlers using a JSON refresh body.
- **Claude cache** — breakpoints re-anchored on passthrough responses.
- **Streaming** — undeclared `openAIResponsesTerminalSent` replaced; redundant `streamDoneSent` removed; malformed forced-SSE now persists a canonical failure instead of being dropped.
- **Translator** — output tokens clamped by model capabilities with alias field mapping.

## Tests
- 54 new suites covering the canonical-attempt/policy/retry boundary (canonical-attempt, canonical-classification, canonical-policy, canonical-retry-gate, retry-eligibility-boundary, combo-policy-retry-fallback, candidate-served, combo-canonical-success, chat-result-1b/1c), the token-budget resolver integration, the model catalog sync/normalize, streaming lifecycle + emission counter, open-code Muse/identity, ZCode OAuth + import route, Zed usage, usage key-hash/status, limits audit, Antigravity quota families/wire-model, Bynara, Grok, Kiro fallback, Alibaba Token Plan, circuit-breaker toggle, capability-provider limits, and the console-log parser. Full suite green.

# v0.8.6 (2026-08-17)

## Features
- **Registry expanded to 304 providers** — completed the OmniRoute import: frontier API-key providers, API-key gateways/inference, 9 local runtimes (lm-studio, vllm, lemonade, llamafile, llama-cpp, triton, docker-model-runner, xinference, oobabooga), and 5 audio providers (soniox, gladia, rev-ai, speechmatics, fishaudio) with real per-token pricing.
- **6 new web-cookie executor ports** — hailuo-web (MiniMax signed chat), gemini-business (enterprise StreamGenerate), inner-ai (gateway catalog), conol-web (agent-session chat), notion-web (Notion AI transcripts via TLS fetch), hyperagent (thread-based agent chat) — each with services and full unit suites.
- **Live model discovery wiring** — `/api/providers/[id]/models` now refreshes catalogs for the ported cookie providers: inner-ai (live `/ai_models`), conol-web + notion-web (live discovery with seed fallback), hailuo-web / gemini-business / hyperagent (bundled catalog + warning since no discovery API exists upstream).
- **Smart Routing combo strategy** — task-aware routing (tool-calling vs research) with persisted telemetry (reason, selected pool, excluded cookies), history page with pagination + filters, and A/B Lab comparing predicted vs actual results.
- **Combo Lab** — what-if strategy comparison using historical request data.
- **Combo Simulator** — pre-save preview of calls/cost/capability/latency/budget before saving a combo.
- **Unified capability catalog** — `deriveComboCapabilities`, combo caps surfaced in `/api/models`, aggregate capability badge.
- **Provider Health Heatmap** — per-provider success/latency, breaker state, and connection cooldown in one dashboard view.
- **Glass Mode** — third UI theme (dark-based frosted), alongside light and dark.
- **New Providers** — Freebuff (authToken browser_token flow + FreeBuffExecutor), Fireworks AI (reasoning, vision, pricing), Z.ai (browser-backed replacement for chatglm-cn), Tencent AI Studio (aistudio.tencent.ai), Bynara (model caps + pay-as-you-go pricing), plus a batch of free gateways (theoldllm, aihorde, mimocode, g4f*, bazaarlink, dahl, dgrid, hackclub, llm7, uncloseai) and GLM-5.3 effort tiers + CodeBuddy CN hy3 swap.
- **Generic cookie auto-capture** — one-click session capture for all webCookie providers; felo-web converted to cookie provider with dual-auth + CDP launch from a running Brave.
- **Combo context in request details** — observability now records which combo/strategy served each request.
- **Perf** — server-side key-gated `/v1/models` cache, virtualized ModelSelectModal (1352 models), compact client caps payload via `toClientCaps`, shared `listWindow` helpers.
- **Docs** — README rewritten in three languages (EN/ID/ZH) with accurate feature inventory; npm CLI README likewise translated.

## Fixes
- **Client aborts** — AbortError/499 now treated as cancellations, not upstream failures; skipped in health samples and mapped to 499 in TTS/embedding/image/STT cores.
- **Swarm telemetry** — repaired live SSE pipeline and preserved worker slot data.
- **Smart-routing history API** — errors surfaced as JSON instead of empty bodies.
- **Combos** — edit modal shows effective strategy; template apply validates strategy roles server-side; simulator budget risk matches runtime leaf sum; hydration fix in ComboCard models header.
- **Headroom** — proxy log fd closed exactly once (EBADF crash on proxy exit); status probe via `/livez`.
- **Provider alias collisions** — resolved trae/mimo/ix/venice lookups.
- **Antigravity** — ported PR #3208 request-size optimizations, kept canary endpoint.
- **Perplexity-web** — extract answers from workflow_block; **zai-web** dismisses chat.z.ai upgrade modals; **projectid** recognizes alternative onboardUser response shapes.
- **Playground** — fixed compare-mode duplicates, per-model thinking levels, compare session persistence; aligned combo thinking classification with runtime.
- **Models** — dedupe AI_MODELS by provider/model (gemini LLM+STT refs), normalize alias→id lookups, correct capabilities/pricing per models.dev, wire GLM-5.2 `reasoning_effort`, add CI consistency gate.

## Tests
- 7 new suites: hailuo-web, gemini-business, inner-ai, conol-web, notion-web, hyperagent executors, STT async-batch + fishaudio TTS, provider-models web-cookie discovery wiring (~4,300 lines). Full suite 2597 passing (1 pre-existing live network test excluded).

# v0.8.5 (2026-08-13)

## Features
- **New Provider: Helyx AI** (`helyxai`) — one OpenAI-compatible endpoint (https://helyxai.space/v1) for 50+ models. 12 seeded chat models (DeepSeek-V4 Flash/Pro, GPT-5.6 Luna, Gemini 3.1 Flash Lite, GLM 5.2, Qwen3 32B, MiniMax M3, Mistral 4, Gemma 4 31B, GPT OSS 120B, Kimi K3, Llama 3.1 8B), `flux-1` image + `kling-video` video generation via per-kind endpoints, free tier (100K tokens/day, resets every 24h), passthrough for the full roster, price table + logo asset.
- **Codex GPT-5.6 Max/Ultra Reasoning Overrides (cx/ only)** — gpt-5.6-sol/terra/luna + `-review` registry entries with provider-scoped capability windows (Sol 372k, Terra/Luna 272k); thinking levels gain `ultra` (Luna capped at max) with safe effort normalization across wire formats.
- **Qoder PAT Authentication (end-to-end)** — personal access tokens alongside the OAuth device flow: job-token exchange, TTL-cached credential resolution with in-flight dedup, clean 401s, quota support, and PAT validation route.
- **Combo Capability Adapter** — requests needing hard input modalities (vision/pdf/audio/video) are auto-routed to a combo member that covers them; when none does, a known-capable fallback model (`oc/mimo-v2.5-free` by default) is prepended. Tri-state per-combo override, flows through per-key ACL, budget, and admission.
- **grok-4.5 Thinking Levels** — low/medium/high levels + 500k context window in capabilities, the thinking-levels picker, and the xai registry entry.
- **Headroom Effective Payload Savings** — byte-level before/after savings (body/tools/history) persisted via a lifetime aggregate and surfaced on the Overview dashboard with compressed-request counts.
- **v1/models Combo Thinking** — effective combo thinking config advertised as `capabilities {thinking, agentic}` so capability-gated clients (e.g. zcode) can detect combo thinking.
- **Auto-provision Default Key** — enabling `requireApiKey` for the first time creates a "Default Key" automatically when no keys exist; the raw key is returned once (never persisted) and surfaced via the existing created-key modal.
- **authModes defaulting** — freeTier/apikey providers without explicit authModes now default to apikey-capable, so the dashboard counts api-key connections consistently.

## Fixes
- **Codex tool-call truncation** — the codex executor now forwards the client's `max_output_tokens` and injects a model-aware default when absent, so heavy-reasoning gpt-5.6-luna/terra outputs are no longer truncated mid-tool-call by the backend's small default cap (previously surfaced as Codex CLI `InputValidationError: Bash was called with input that could not be parsed as JSON`). Defensive fallback retries once without the field for legacy backends that 400 on it.
- **Responses→Chat duplicate tool-call arguments** — `response.output_item.done` no longer re-emits already-streamed `function_call_arguments` (new `argsStreamed` flag); `_ingestFullItem` prefers the terminal snapshot. Fixes corrupted tool-call JSON for Chat clients routed to codex models.
- **Zed completions 500** — `CompletionBody.provider` now serializes snake_case (`open_ai`, `x_ai`) matching the upstream serde; PascalCase caused "An internal server error occurred" for every model.
- **Zed raw 500 body surfaced** — `parseError` keeps the raw upstream body so undebuggable 500s stay diagnosable.
- **opencode stream_options mismatch** — `stream_options` stripped on non-streaming requests (upstream 400 `stream_options should be set along with stream = true`).
- **Combo engine** — non-chat strategies (fusion/swarm/cascade) in `handleComboChat` now 400 loudly instead of silently degrading to fallback; gemini/antigravity tool parts flattened into prose for panel/worker models; fusion judge + single-survivor re-run bounded by `panelHardTimeoutMs`; aggregate output budget enforced (clamp fix); combo call-cap gated by `budgets.enabled` (budget-off combos unlimited again); combo rate-limit charge capped at burst; capacity admission gate dropped; default burst raised 10 → 25 → 65 (env-overridable via `EXTREMEROUTER_RATE_LIMIT_BURST`).
- **TokenHarbor connection test** — `testApiKeyConnection` + validate route now probe `GET /v1/models` with Bearer (401/403 = bad key); added SVG provider icon.

## Tests
- 12 new suites: responses-streaming-audit, codex-gpt56-reasoning, codex-max-output-tokens, combo-budget-clamp, combo-capability-adapter, combo-fusion, default-key-provision, grok-45-thinking, headroom-savings, helyxai-provider, qoder-pat, v1-models-combo-thinking (~1,380 lines). Golden snapshots updated for the args-dedup fix and the new Helyx AI registry entries.

# v0.8.4 (2026-08-10)

## Features
- **Self-Hosted Media Nodes**: run your own STT / TTS / embedding nodes and register them in the gateway.
- **New Provider: Meta AI**: Muse Spark models via api.meta.ai — dual openai+claude transports, contributor-tier pricing.
- **New Provider: WorkBuddy + CodeBuddy International**: OAuth providers.
- **New Provider: TokenHarbor**: API-key gateway provider.
- **Zed Hosted AI Rework**: live model catalog (GET /models, cached 1h) replaces the static 17-model list; completion envelope sends per-upstream native request bodies (Claude / Gemini / OpenAI Responses / xAI); short-lived LLM token minted via /client/llm_tokens (50-min cache, auto-refresh on 401 / expiry headers); user token read from refreshToken to match the local credential layout.
- **New Provider: Kimi Desktop**: OAuth auto-import from the desktop session, full desktop model list (k2.5 / k2.6 / k2 / thinking / search / k3), quota tracking + thinking levels, live quota via membership RPC.
- **Thinking Tiers**: deepseek-v4 gains native low/high/max tiers (+ `thinkingMaxEffort`); laguna-s-2.1, step-3.7, and kimi-k3 gain thinking levels; combo requests apply the correct thinking shape per provider (OpenAI effort style for deepseek).
- **Combo Budget**: per-combo max-cost budget with on/off toggle; budget wired through cascade, swarm, and TTS media combos.
- **UI**: sidebar regroup (Homepage added, Media Providers moved under Gateway), Media Providers hub page, provider icons for kimi-desktop / novita / inferx.

## Fixes
- **Capability Corrections**: context / maxOutput for kimi-k3, laguna-s-2.1, step-3.7.
- **Claude Settings**: tolerant JSONC read for POST / DELETE resets.
- **Security**: bump dompurify / nanoid / vitest to patched versions.
- **CI**: pack CLI tarball into repo root (not parent), pin postcss override for node:22-alpine npm 10, lowercase GHCR image name for buildx cache refs.

# v0.8.3 (2026-08-07)

## Features
- **Cline**: stream-only API, x-client-type header, official model catalog.
- **Model ACL**: per-key model allowlist enforced on all API handlers.
- **Ollama Quota**: quota tracker + proactive background token refresh.
- **Zed**: auto-import credentials from Windows Credential Manager; match upstream loadCodeAssist headers; refresh usage model list.
- **TokenRouter**: accurate per-model pricing + thinking config.
- **Combo Budget**: per-combo max-cost control with highlight badge; default cap raised to 100 USD.

## Fixes
- **antigravity**: break import cycle between registry and appConstants; match upstream loadCodeAssist headers.
- **Circuit Breaker**: report real cooldown on rateLimited.
- **Project ID**: negative cache stops re-onboarding on every request.
- **Translator**: errorSent guard on terminal frames + dedupe sanitizer.
- **Deps**: bump undici and ip-address to resolve high-severity audit findings.

# v0.8.2 (2026-08-05)

## Features
- **New Provider: Pro API**: Gemini CLI Pro subscription provider, supports Gemini 3, Qwen, GPT-5.3, Claude Sonnet 4.6/Opus 4.6.
- **New Provider: Novita AI**: API-key provider with 9 models (GLM 5.1, Qwen3.5 397B, Kimi K2.5, DeepSeek V3.2/R1, MiniMax M2.5, GLM 5 Air, Hermes 4). Passthrough mode.
- **New Provider: GLM Custom**: free-tier user agent GLM proxy.

## Fixes
- **Provider Registry**: drive CapabilityValues defaults from capabilities object, fix `requiresValidateUrl` propagation so OpenRouter-style providers align with keygen modal.
- **Login Flow**: fix endless login loop.
- **Pool Cache**: reduce cache duration for `pool:last-selection` to 5s.
- **Combos**: fix custom strategies missing `members`, add priority auto-assignment for newly detected providers.
- **Security**: redact password in error log.

# v0.8.0 (2026-07-29)

## Features
- **New Provider: Agnes AI (Web)**: cookie-based provider with custom SSE executor translating AgentStart/MessageDelta/AgentEnd events.
- **New Provider: Agnes AI (API)**: OpenAI-compatible API key provider with vision, reasoning, and image generation.
- **New Provider: ExtremeRouter (Exclusive)**: qwen2api proxy with dual endpoint fallback. No API key required.
- **New Provider: StepFun**: 3 API formats (OpenAI + Responses + Anthropic), image gen/edit, reasoning effort.
- **New Provider: WordPress Studio Code**: OAuth provider with keychain auto-import from Studio Code.
- **1min.ai 3-Field Auth Modal**: JWT + TeamId + Cookies with dedicated import route.
- **CLI Tool: Grok Build**: step-by-step setup guide.
- **Health System Overhaul**: Health-threshold routing influence (shed degraded providers), cached aggregates, health degraded notifications via SSE.
- **Swarm Engine Fixes**: 3 critical + 3 high + 7 medium fixes (discarded output, audit misalignment, HTTP-fail quorum, telemetry dedup, slot allocation, synthesis tracking, parseStrategy recovery, gatekeeper escalation).
- **Security Hardening**: Host:localhost auth spoofing fix, OAuth refresh timeouts, breaker probe leak fix, sanitizeHtml SSR fix, MaxListeners leak fix.
- **Infrastructure**: Shared parseEventStream helper, structured logger, useToolConfig hook + ToolCardShell.

## Critical Fixes
- **Circular dependency TDZ error**: combo.js → healthMonitor.js → alertService.js circular import chain caused "Cannot access B before initialization" in CLI build. Fixed with lazy import.
- **deepseek-web + zed.js usage tracking**: hardcoded `usage: {0,0,0}` caused quota/cost tracking to silently drop records.
- **Health degraded notifications never fired**: dispatchAlert only delivered to webhooks, not dashboard SSE stream.
- **Health sampling skipped on terminal failures**: thrown exceptions, no-credentials, all-rate-limited paths never recorded samples.
- **Swarm single-worker output discarded**: worker text was never included in manager directive.
- **Swarm staff audit prompt misalignment**: positional indexing broke when workers failed.
- **Swarm HTTP-failed workers counted as success**: 500/429/503 counted toward quorum.

## Fixes
- **qwen-cloud stream_options 400**: DashScope rejects stream_options — added quirks.dropStreamOptions.
- **Qwen Cloud authType fix**: DB migration 003 normalizes authType from cookie to apikey.
- **1min.ai modelId fix**: modelsFetcher now extracts `modelId` field, not display name.
- **Provider test results reflected in Health**: `recordHealthSample` called from testSingleConnection.
- **Error response shape consistency**: streamingHandler, unavailableResponse, combo fallback now include type+code.
- **parseStrategy recovery regex**: replaced with brace-depth scanner respecting string context.
- **Worker subtask matching**: uses reference matching instead of id matching for duplicate IDs.
- **Golden snapshot normalization**: X-Msh-Device-Model normalized to `<platform>` for CI compatibility.
- **npm audit fix**: updated sharp, postcss, dompurify (monaco-editor).

# v0.7.9 (2026-07-29)

## Features
- **New Provider: Agnes AI (Web)**: cookie-based provider for Agnes agentic AI assistant. Custom executor translates SSE event stream (AgentStart → MessageDelta → AgentEnd) into OpenAI chat.completion.chunk. Supports multi-turn context, profile badge with credit balance.
- **New Provider: Agnes AI (API)**: official API key access to Agnes models via apihub.agnes-ai.com. OpenAI-compatible with vision, reasoning, and image generation support. No custom executor needed.
- **New Provider: ExtremeRouter (Exclusive)**: exclusive provider powered by qwen2api proxy for Qwen models (3.6/3.7/3.8). No API key required. Dual endpoint with automatic fallback (Netlify → custom domain).
- **New Provider: StepFun**: API key provider with 3 API formats (OpenAI Chat + Responses + Anthropic Messages). Supports streaming, reasoning effort, vision, video, function calling, and image generation/editing.
- **New Provider: WordPress Studio Code**: OAuth provider that imports credentials from Studio Code's `~/.studio/shared.json`. Dual transport (Anthropic + OpenAI) for Claude and GPT models via WordPress.com AI proxy. Auto-import from keychain.
- **CLI Tool: Grok Build**: step-by-step setup guide for xAI Grok Build CLI in `/dashboard/cli-tools`.
- **1min.ai (Web) 3-Field Auth Modal**: replaced single JWT input with a custom modal accepting 3 separate fields (JWT, TeamId, Cookies). User-provided teamId fixes the original validation bug where the JWT payload uuid (user UUID) was used instead of the team UUID.
- **1min.ai Model Discovery Fix**: modelsFetcher now correctly extracts `modelId` field (not display name) from the 1min.ai models API response.

## Fixes
- **Critical: deepseek-web + zed.js usage tracking**: hardcoded `usage: {0,0,0}` in non-stream paths caused quota/cost tracking to silently drop records. Fixed with `estimateInputTokens`/`estimateOutputTokens`.
- **Critical: Capability gate bypass**: empty `managerModel` (Auto config) skipped validation, allowing web cookie `panel[0]` to become Manager. Fixed: `validateComboRoles` now resolves empty roles to `panel[0]`.
- **Critical: Swarm single-worker output discarded**: worker text was never included in manager directive — manager hallucinated from scratch. Fixed: actual worker text included.
- **Critical: Swarm staff audit prompt misalignment**: positional indexing broke when any worker failed, misidentifying which worker produced which output. Fixed: uses id-matched `st.output` field.
- **Critical: Swarm HTTP-failed workers counted as success**: 500/429/503 Response objects counted toward quorum in telemetry path. Fixed: checks `res.ok` before counting.
- **Critical: Health degraded notifications never fired**: `dispatchAlert` only delivered to webhooks, not the dashboard SSE stream. Fixed: emits `health:degraded` event on SSE so NotificationBell picks it up.
- **Critical: Health sampling skipped on terminal failures**: thrown exceptions, no-credentials, all-rate-limited paths never recorded failure samples. Fixed: all terminal exit paths now record samples.
- **High: Priority collisions** (zed 55→56, qwen-cloud 165→164).
- **High: Zed token refresh missing from REFRESH_HANDLERS**.
- **High: Swarm telemetry per-worker events deduplicated**: key ignored worker index, only last worker visible. Fixed: includes worker index in dedup key.
- **High: Swarm synthesis marked complete before stream finished**: telemetry showed "done" while user still receiving tokens. Fixed: wraps stream body with completion detector.
- **High: Qwen Cloud stream_options 400**: DashScope rejects `stream_options`. Added `quirks.dropStreamOptions` to registry + DefaultExecutor guard.
- **High: Host:localhost auth spoofing bypass**: removed fallback for non-dev environments.
- **High: OAuth refresh timeouts**: all token-refresh `fetch()` calls now bounded by 15s timeout.
- **High: Circuit breaker probe slot leak**: non-retryable errors (400/401/403) in half-open state leaked probe slot. Fixed: explicit `releaseBreakerProbe`.
- **High: Health metrics don't influence routing**: combo model filtering now skips providers with <50% success rate (min 10 samples).
- **Medium: Swarm telemetry vs non-telemetry divergence**: aligned empty-output filtering, parallelized JSON parsing.
- **Medium: parseStrategy recovery regex broke on braces in string values**: replaced with brace-depth scanner respecting string context.
- **Medium: Worker subtask matching by duplicate id**: uses reference matching instead of id matching.
- **Medium: Gatekeeper failure escalation**: tracks consecutive failures per provider, warns after 3.
- **Medium: Health system improvements**: cached aggregates (M1), timer cancellation on disable (M2), raised listener cap (M3), provider display name resolution from registry (M4), timeline empty buckets show null instead of 0ms (M5).
- **Medium: Provider test results now reflected in Health dashboard**: `recordHealthSample` called from `testSingleConnection`.
- **Medium: Error response shape consistency**: streamingHandler, unavailableResponse, combo fallback now include `type` + `code`.
- **Medium: Token refresh `_refreshFetch` wrapper**: bounded fetch wrapper fixed from broken in-function scoping.
- **Fix: sanitizeHtml SSR crash**: `DOMPurify.addHook()` called at module load crashed in SSR (no `window`). Guarded with `isBrowser` check.
- **Fix: MaxListenersExceededWarning**: raised limit to 40, fixed sqljsAdapter `.on` → `.once` to prevent HMR leak.
- **Fix: Dead duplicate vertex/vertex-partner validate case removed.**
- **Fix: `buildStaffAuditPrompt` unused second parameter removed.**
- **Fix: Telemetry `markRunComplete` / `markStageDone` / `markRunError` idempotency guards added.**

## Infrastructure
- **Shared `parseEventStream` helper**: added to `open-sse/utils/sse.js` for gradual SSE parser deduplication across executors.
- **Structured logger**: `src/lib/logger.js` wraps console.* with level filtering + tag context.
- **`useToolConfig` hook + `<ToolCardShell>`**: shared state management for CLI ToolCards (available for incremental migration).
- **Global `unhandledRejection` / `uncaughtException` handler**: prevents gateway crash on unhandled promises.

# v0.7.8 (2026-07-27)

## Fixes
- **Qwen Cloud authType fix**: existing `qwen-cloud` connections created before the v0.7.7 merge may have `authType: "cookie"` stored in the DB column (from ambiguous auth resolution in older versions). The registry now definitively declares `authType: "apikey"`. DB migration 003 normalizes the stored authType so the UI shows "API Key" instead of "Cookie Value" with the correct key icon. (Migration 002 could not be edited in-place because the version-gated runner skips already-applied migrations.)

# v0.7.7 (2026-07-26)

## Features
- **Provider Capability Layer**: per-provider `capabilities` field (`toolUse`, `fileAccess`, `streaming`, `multiTurn`) that prevents web cookie providers from serving control roles (Manager/Staff/Audit/Judge) in swarm and fusion strategies. Auto-derived from category (webCookie → limited). UI enforcement with warning badges + ModelSelectModal filtering. Runtime defensive validation with panel[0] fallback resolution. O(1) memoized capability lookup.
- **New Provider: 1min.ai (API)**: official API-key variant of 1min.ai. Custom `API-KEY` header, native SSE streaming via `/api/chat-with-ai?isStreaming=true`. 12 seed models (Claude, GPT, DeepSeek, Qwen, GLM, Grok).
- **New Provider: Marathon (GoKite AI)**: adaptive inference infrastructure with 4 completion windows (now/soon/later/anytime). Now mode = synchronous streaming; delayed modes = async poll loop with heartbeat SSE keep-alive. Per-connection window selector (MarathonWindowSelector). Up to 65% cost savings for delayed modes. 5 flagship models.
- **New Provider: Zed Hosted AI**: OAuth provider with 2-layer auth flow (user credentials → LLM token minting). Auto-refresh LLM token (1h lifetime) on expiry. JSONL streaming translation (multi-provider event extraction: OpenAI/Claude/Gemini/x-ai). Full MITM support for Zed Editor (`cloud.zed.dev`). Auto-import from keychain (Linux secret-tool, macOS Keychain, Windows). 17 models.
- **Improved Provider: Qwen Cloud (Merged)**: merged `qwen-cloud` + `qwen-cloud-token-plan` into a single provider with 3 API formats (OpenAI Chat + OpenAI Responses + Anthropic Messages). Cross-transport fallback enabled. 16 merged models with `contextWindow` + `maxOutput` metadata. `reasoningInject` + `thinkingConfig` for DeepSeek/Kimi. New official logo (purple gradient). DB migration 002 to rename existing connections.
- **MITM: Zed Editor**: full MITM handler for `cloud.zed.dev` — intercept `/completions`, unwrap CompletionBody envelope, wrap response as Zed JSONL. Registered in `/dashboard/mitm` with 11 mappable models.
- **CLI Tool: Grok Build**: entry for xAI Grok Build CLI in `/dashboard/cli-tools` with step-by-step setup guide (XAI_API_KEY + XAI_BASE_URL + XAI_MODEL).

## Fixes
- **Critical: deepseek-web usage tracking**: hardcoded `usage: {0,0,0}` in non-stream path caused quota/cost tracking to silently drop records. Fixed with `estimateInputTokens`/`estimateOutputTokens`.
- **Critical: zed.js usage tracking**: same bug as deepseek-web — hardcoded zeros in `transformJsonlToJSON`. Fixed with estimation from request body + assembled content.
- **Critical: Capability gate bypass**: empty `managerModel` (Auto config) skipped validation, allowing web cookie `panel[0]` to become Manager. Fixed: `validateComboRoles` now resolves empty roles to `panel[0]` before validating.
- **High: Priority collision zed vs trae**: both providers used priority 55. Fixed: zed → 56.
- **High: Priority collision qwen-cloud vs moonshot**: both providers used priority 165. Fixed: qwen-cloud → 164.
- **High: Zed token refresh missing**: `REFRESH_HANDLERS` in `tokenRefresh.js` had no zed entry — health checks/connection tests failed to refresh. Fixed: added `refreshZedLlmToken` + `case "zed"` in `formatProviderCredentials`.
- **Medium: Marathon executor audit (8 fixes)**: finish_reason ternary no-op, dead config `features.completionWindow`, unverified `validateUrl`, missing 401/403 handling in now mode, invalid `finish_reason: "error"`, dead `errorMsg` variable, requestBody.model inconsistency, dead validateUrl.
- **Medium: Capability Layer perf**: O(n) `REGISTRY.find()` per call → pre-built `PROVIDER_CAPS_CACHE` Map (O(1) lookup).
- **Build: REGISTRY import**: `import { REGISTRY }` (named) crashed because registry uses `export default`. Fixed to default import.

# v0.7.6 (2026-07-25)

## Features
- **Dollar Savings Tracker**: hero card di Overview menampilkan total $ Saved (lifetime) dengan per-mechanism breakdown (RTK/Headroom/Pxpipe/Cache/Caveman/Ponytail) + "With vs Without ExtremeRouter" comparison.
- **Provider Performance Leaderboard**: sortable table di Overview dengan ranking per-provider: Requests, Tokens, TTFT, P95 Latency, Success Rate, Cost. Period selector (24h/7d/30d). Custom provider names resolved dari providerNodes.
- **SSE Live Dashboard**: unified `/api/dashboard/stream` SSE endpoint (stats + breaker + health). Real-time KPI updates via `useDashboardStream` hook dengan auto-reconnect.
- **In-App Notification System**: bell icon di header dengan unread badge, dropdown feed, localStorage history persistence. Push notifications untuk provider down/recovered/health degraded/rate limited.
- **Cross-Transport Fallback**: OpenAI endpoint timeout/5xx → auto-retry Anthropic endpoint (body re-translated). Fresh AbortController per attempt. Applied ke GLM, hcnsec, Bynara, InxoraStudio, CommandCode, Infron, AgentRouter.
- **New Provider: Bynara**: multi-model router (OpenAI + Anthropic + Responses + Image gen/edits).
- **New Provider: InxoraStudio Labs (API)**: OpenAI + Anthropic multi-endpoint.
- **New Provider: InxoraStudio Labs (Web)**: JWT web chat executor (3-step flow), profile badge, auto model discovery.
- **New Provider: Infron AI**: 457+ models, OpenAI + Anthropic, quota tracker (credit balance).
- **New Provider: AgentRouter**: GLM/GPT/Claude, OpenAI + Anthropic, custom pricing model discovery.
- **Updated Provider: Command Code**: migrated dari custom `/alpha/generate` ke standard OpenAI/Anthropic provider API, live model discovery (47 models).
- **Quota Tracker: Grok Web (Subscription)**: SSO cookie rate-limits (Fast/Thinking/Heavy tiers).
- **Quota Tracker: Infron AI**: credit balance via `/v1/balance`.

## Fixes
- **Kiro `REQUEST_BODY_INVALID`**: normalize `(level)` suffix sebelum resolving synthetic variants. Map explicit levels ke native Kiro effort fields hanya untuk supported families (Claude 5 / GPT-5.6). `thinkingLevels.js` server-side gating.
- **Responses API accumulator**: shared `ResponsesAccumulator` untuk streaming + forced non-stream. Alias-safe tool reconstruction. `preferComplete` untuk snapshot merge. Exactly-once terminal semantics.
- **Responses `incomplete`/`cancelled`**: terminal events sekarang di-recognize di `responsesStreamHelpers.js`.
- **Antigravity "model turn" 400**: strip trailing `role:"model"` turns dari `contents[]` sebelum kirim ke Google Cloud Code.
- **Antigravity tier routing**: `gemini-3.6-flash-high/medium/low` dengan `upstreamModelId: "gemini-3.6-flash-tiered(high)"` + parser di `getModelUpstreamId`.
- **Cloud Code endpoint isolation**: gemini-cli→`cloudcode-pa`, antigravity→`daily-cloudcode-pa` via per-provider `CLOUD_CODE_API` map.
- **Circuit breaker `releaseBreakerProbe`**: `monitors`→`breakers` ReferenceError fix.
- **Combo `comboStickyLimit`**: wrong key `comboStickyLimit`→`comboStickyRoundRobinLimit`.
- **Combo `comboStrategies` lost-update**: deep-merge per combo-name + null delete-signal.
- **Cross-transport abort**: fresh AbortController untuk alternate attempt.
- **Cross-transport error logging**: alternate failure error tidak lagi di-swallow silently.
- **Responses output getter**: dedup alias-registered tools + iterate string-keyed items.
- **Notification spam**: `health_update` dan `usage_update` tidak lagi jadi notification.
- **Notification raw JSON**: `formatEventMessage` return `null` untuk unknown types.
- **Notification duplicate**: `lastProcessedTs` useRef guard + dedup.
- **NotificationBell setState-during-render**: `markAllRead` deferred via `requestAnimationFrame`.
- **NotificationBell key collision**: `idCounter` seeded dari `Date.now()` + max history id.
- **hcnsec model discovery**: tambah `"openai"` filter + authenticated suggested-models proxy.
- **WEB_COOKIE_PROVIDERS modelsFetcher**: page.js sekarang include webCookie providers di model discovery chain.
- **InxoraStudio profile badge**: `InxoraProfile` component + wiring di ConnectionsCard.

## Improvements
- **Dead code cleanup**: hapus 12 dead files (1,705 LOC) + dead `convertResponsesApiFormat` function.
- **Junk dependency removed**: `fs` (0.0.1-security placeholder package) dari dependencies.
- **Command Code executor**: hapus custom `CommandCodeExecutor`, pakai `DefaultExecutor` (OpenAI/Anthropic native).
- **Model discovery**: `suggested-models` route sekarang support `connectionId` untuk authenticated discovery.
- **Validate route**: hcnsec, InxoraStudio-web, inxorastudio (API) validate cases.

# v0.7.5 (2026-07-22)

## Features
- **Cline + ClinePass Quota Tracker**: both providers now report plan usage limits (5-hour / weekly / monthly) as percentUsed in the Quota Tracker dashboard. Shared `getClineUsage` handler with OAuth/API-key auth fallback.
- **Breaker-Aware Combo Pre-Filter**: combos now proactively skip models whose provider circuit breaker is OPEN before attempting them — saving a wasted credential-selection round-trip per broken model. New read-only `isBreakerBlocking()` check (does not consume the single HALF_OPEN probe slot) + `filterBreakerOpenModels()` helper. Falls back to the original model list if ALL are blocked (probe window may open during attempt).
- **Providers Page Redesign (list)**: full redesign — 5 collapsible sections replaced with a unified flat grid + filter chips (All / Connected / Errors / OAuth / API Key / Free / Cookie / Custom) + sort dropdown. New rich tiles (ProviderTile) with larger icons, connection counts, status badges, and an action bar (test + settings + toggle). KPI row (ProviderKpis) with interactive Errors tile. Toolbar (ProviderToolbar) with live count badges.
- **Provider Detail Page Redesign**: God Component (1831 lines) split into 4 extracted components: `ProviderDetailHeader` (branded header), `ConnectionsCard` (toolbar + rows + bulk proxy modal), `ModelsCard` (toolbar + grid), `CollapsibleSection` (reusable wrapper). page.js reduced to a lean orchestrator (~960 lines). Visual polish: branded header with category summary, collapsible sections (Health default-collapsed), responsive model grid (grid-cols-3), progress-bar-style one-by-one test summary, compact pill toolbars.

## Fixes — Combo Engine (28 bug fixes across 4 audit rounds)
- **C1 Critical — `body_global` race condition** (swarm.js): removed module-level mutable state; `body` threaded explicitly to all stage runners. Concurrent swarm requests no longer clobber each other's prompt (cross-request leak).
- **C2 Critical — `releaseBreakerProbe` ReferenceError** (circuitBreaker.js): `monitors`→`breakers` — half-open probe slot now releases correctly; breaker no longer stuck open forever.
- **C1+H2 Critical — orphaned comboStrategies on rename/delete** ([id]/route.js): `patchComboStrategies` now sends partial patches with `{ [key]: null }` delete-signals compatible with the deep-merge in updateSettings.
- **H1 — Wrong key `comboStickyLimit`** (chat.js): `comboStickyLimit`→`comboStickyRoundRobinLimit`. Round-robin fast-path now respects sticky limit config.
- **H2 — Lost-update race in `handleSetComboStrategy`** (settingsRepo.js + CombosPageInner.js): backend deep-merges `comboStrategies` at combo-name level; UI sends only the changed entry.
- **H3 — ComboFormModal stale create state**: reset local draft via `useEffect` watch on `isOpen` transition.
- **H4 — ComboFormModal closure-models bug**: 3 handlers now use functional updates `setModels(prev => ...)`.
- **H5 — PUT empty-string name bypass validation**: `if (body.name)` → `if (body.name !== undefined)` + non-empty check.
- **M1 — Non-array models crash**: `Array.isArray(models)` validation in POST + PUT.
- **M2 — Case-sensitive strategy compare**: `normalizeStrategy()` helper (trim+lowercase+whitelist).
- **M3 — Fusion single-survivor stream downgrade**: re-run with stream flag preserved when `body.stream === true`.
- **M4 — ComboCard null-guard**: `combo.models` normalized to `[]` defensively.
- **M5 — handleDelete silent failure**: error feedback via `alert()`.
- **M6 — Cross-strategy breaker pollution**: `skipBreaker` opt for panel calls; fusion/swarm failures no longer trip shared per-provider breaker.
- **#1 — Fusion single-answer re-run**: return existing panel response instead of re-invoking model.
- **#3 — `parseStrategy` truncated JSON**: lenient recovery salvages complete subtask objects via regex.
- **#5 — `workerCount` config ignored**: `workerCount` from UI now honored via `workerCap`.
- **L1-L9**: `getStrategyDistribution` whitelist, PUT response canonical shape, stale role-field cleanup, ModelSelectModal highlight, `VALID_NAME_REGEX` dedup, ComboFormModal fetch cleanup.

## Fixes — Code Review Feedback
- **GitHub `/responses` proactive routing** (github.js): `buildUrl()` + `execute()` route `targetFormat:"openai-responses"` models to `/responses` proactively.
- **xAI unused `U` import** (xai.js): dead code removed.
- **sanitize-html test** (sanitize-html.test.js): rewritten as idiomatic vitest with `it.each`/`expect` + standalone-script fallback.

## Improvements
- **Settings deep-merge** (settingsRepo.js): `comboStrategies` merged at combo-name level (not replaced), with `null` as the delete-signal.
- **Swarm `ALIAS_TO_ID` map** (combo.js): built from REGISTRY for breaker lookups without crossing the open-sse→src layer boundary.
- **Provider list unified entry array** (providers/page.js): ONE flat array with `category` tags replaces 5 separate section arrays.

# v0.7.4 (2026-07-19)

## Features
- **Forge Workspace provider**: new API-key provider (forge) with 33 models across 3 pricing tiers (free/pro/enterprise), live model discovery via modelsFetcher, dedicated pricing block, and SVG brand icon.
- **TokenRouter provider + Quota Tracker**: new API-key provider (tokenrouter) with a separate Management API key (mirrors TokenRouter's two-credential design). Quota card surfaces Wallet / Top-up / Voucher balances from the management endpoint. Handler returns a graceful `message` when no management key is configured (no more UI crash).
- **Huancheng Public API (hcnsec) provider**: new OpenAI-compatible regional API-key provider.
- **Qwen Cloud + Qwen Cloud Token Plan providers**: two new dedicated API-key providers for Alibaba Cloud's Bailian Qwen endpoints (pay-as-you-go + token-plan variants).
- **Alibaba + Alibaba CN providers**: regional Alibaba DashScope API-key providers (international + China mainland base URLs).
- **GitHub Copilot native /v1/messages routing**: Claude models routed directly to GitHub's `/messages` endpoint (targetFormat:"claude") with `anthropic-version:2023-06-01` header, bypassing Chat Completions quirks and `sanitizeMessagesForChatCompletions`. Result: native Anthropic-format responses for Claude Code, Cline, etc.
- **GitHub Copilot model catalog sync**: synced to OmniRoute fea1d54 (20 models, including the latest Claude 4.5/4.10 family).
- **opencode-go effort-tier aliases**: 9 new alias models (`glm-5.2-high/max`, `mimo-v2.5-high/max`, `deepseek-v4-pro-low/medium/high/max`) auto-rewriting model id + injecting `reasoning_effort` via a new EFFORT_TIERS table + `parseEffortLevel()` suffix parser (port of OmniRoute commit 1843b34).
- **Qwen3.8 Max Preview model**: added to Qwen Web (Subscription) catalog. Auto-enables thinking mode via `REQUIRED_THINKING_MODELS` set; SSE parser handles `thinking_summary` via `delta.extra.summary_thought.content[]`.

## Fixes
- **C1 Critical — Dashboard auth bypass**: `dashboardGuard.js` now uses method-based routing. Mutation routes (POST/PUT/PATCH/DELETE) **always** require a real JWT/CLI token even when `requireLogin=false`. Previously anyone with network access to the dashboard port could mutate state (create/delete providers, keys, settings) without authentication.
- **Cline/GLM 500 `stream_options` error**: `DefaultExecutor.transformRequest` now injects `stream_options: { include_usage: true }` on streaming requests so providers that require usage-on-stream don't 500. Signature expanded to `(model, body, stream, credentials)`.
- **HuggingChat provider dead (HTML 200 response)**: `zai-org/GLM-5.2` was retired by HF. Switched `DEFAULT_MODEL` to `omni` (HF's auto-router), always send `preprompt: ""`, switched `tlsFetch` → native `proxyAwareFetch` (no longer needs TLS impersonation), and added `isEncryptedCredentialBlob` guard.
- **xAI Quota Tracker empty card**: xAI removed both `/v1/billing?format=credits` and `/v1/user?include=subscription` (now 404) and migrated billing to a separate Management API on `management-api.x.ai` (requires a different key). Handler rewritten to return a clear `message` explaining where to find usage (`console.x.ai → Billing`) instead of leaving the card blank. No network calls — no more 404 spam.
- **ModelAccessModal crash (`Cannot read properties of null (reading 'length')`)**: `allowedModels` was `useState(null)` and only synced to an array inside `useEffect` (post-render), so the first render hit `.length` on null. Now uses lazy initializer `useState(() => [...])` so the first render already has a stable array.
- **TokenRouter quota `Cannot read properties of null (reading 'plan')`**: handler previously returned `null` when no management key was present; UI didn't guard. Fixed on both sides — handler returns an object with a `message` field (never null), and `ProviderLimits/index.js` uses `data ?? {}` for null-safe access.
- **Playground value/key TypeErrors (3 separate crashes)**: added `valueStr` coercion in ModelPicker, defensive coercion in `useModelCaps.getCaps`, and `model.value || model.name || model.id` extraction in the modal `onSelect` handler (modal passes the whole object, not a string).
- **Playground `[object Object]` model name after model swap**: extraction fix above also resolved the rendering bug.

## Improvements
- **SanitizeHtml utility** (`src/shared/utils/sanitizeHtml.js`): regex-based HTML sanitizer for markdown model output. Strips `<script>`/`<iframe>`/`<object>`/`<embed>`/`<form>`/`<style>`, neutralizes `on*` event handlers and `javascript:`/`data:` URLs. Defense-in-depth on top of `marked`'s AST (already constrained).
- **Playground MessageContent component**: renders assistant content as sanitized markdown, user/error as plain text. Code blocks get monospace styling + copy button.
- **AddApiKeyModal**: added TokenRouter management-key field UI (paired with chat API key).
- **Provider icon assets**: added forge, tokenrouter, qwen-cloud, qwen-cloud-token-plan, alibaba, alibaba-cn, hcnsec SVG icons + registered them in `providerIcon.js`'s `SVG_ICON_IDS`.
- **SanitizeHtml unit tests** (`tests/unit/sanitize-html.test.js`): regression coverage for the sanitizer.

# v0.7.2 (2026-07-18)

## Features
- **Token Saver Full Coverage**: "Tokens Saved" overview counter now includes all 6 saver mechanisms (previously only RTK + Headroom + Pxpipe). Semantic Cache HITs, Caveman, and Ponytail now contribute to the lifetime total.
- **Token Saver Breakdown UI**: the "Tokens Saved" KPI card on the Overview dashboard is now expandable, showing per-mechanism attribution (RTK / Headroom / Pxpipe / Cache / Caveman / Ponytail) as chips with icons + values, plus total semantic cache hits served.
- **Semantic Cache token accounting**: cache HITs now record the full avoided token cost (prompt + completion parsed from the cached body) into the lifetime counter + per-mechanism breakdown. Previously cache HITs contributed zero because the early return bypassed `saveUsageStats` entirely.
- **Caveman / Ponytail savings estimation**: output-side savers now report estimated savings via a per-(model+provider) moving-average baseline (window 50, warm-up ~10 requests). Savings split 50/50 when both are active.
- **Per-mechanism lifetime counters**: 6 separate DB counters (`tokensSavedLifetime.{rtk,headroom,pxpipe,cache,caveman,ponytail}`) + `semanticCacheHitsLifetime` for accurate attribution.
- **xAI OAuth quota tracking**: xAI now reports billing + subscription quota in the Quota Tracker dashboard (`features.usage` + `transport.usage` wiring, new `getXaiUsage` handler).
- **Kiro GPT-5.6 model catalog**: added 12 GPT-5.6 entries (Sol/Terra/Luna × base/thinking/agentic/thinking-agentic) with 272k context, 3 new MITM slots, `thinkingMaxEffort` for gpt-5.6-sol.
- **Kiro 402 credit exhaustion detection**: `parseError()` override distinguishes confirmed credit exhaustion (ServiceQuotaExceededException + MONTHLY_REQUEST_COUNT) from ambiguous 402s, with best-effort reset-time lookup via GetUsageLimits and 24h fallback cap.
- **Auto-rotate proxy strategy**: no-auth providers can rotate across all active proxy pools (round-robin/random) via `pickProxyPoolId`.
- **devin.svg provider icon asset**: added missing Devin brand icon.

## Fixes
- **Kiro ListAvailableModels 403 "bearer token invalid"**: `fetchKiroCatalogRaw` sent a bare bearer token without the auth-method disambiguating header that AWS CodeWhisperer requires. Now branches on `authMethod` (api_key → `tokentype: API_KEY`, external_idp → `TokenType: EXTERNAL_IDP`) matching the working chat executor. Retry gate expanded from 401-only to `401 || 403`.
- **Provider icon 404s (svg/png mismatch)**: 34 SVG-only providers (chatgpt-web, kimi-web, freebuff-web, openvecta, qwencloud, etc.) were requested as `.png` across 13 call sites, all 404ing.
- **Provider icon 404s (compatible UUID)**: `openai-compatible-chat-{UUID}.png` URLs could never match a static asset; now resolve to `oai-cc.png` / `oai-r.png` / `anthropic-m.png` via prefix detection.
- **ComboTemplatesTab comboStrategies overwrite**: applying a template wiped every other combo's strategy via shallow-merge PATCH (data loss). Now fetches current strategies and merges the new entry.
- **freebuff-web `total_tokens: 0`**: broke usage accounting on non-streaming responses. Now equals `prompt_tokens + completion_tokens`.
- **Devin validate probe (2 sites)**: accepted 5xx as a valid key. Now 2xx→valid, 401/403→invalid, else→unknown.
- **v0-vercel-web & freebuff-web "Hello" fallback**: sent a literal "Hello" upstream on empty messages (masked client bugs + unintended cost). Now returns 400.
- **thinkingUnified dead duplicate branch**: unreachable second `level` branch bypassed the M8 whitelist validation.
- **sseToJsonHandler standard branch dropped `savedTokens`**: pre-existing bug — savings never recorded on the standard SSE→JSON path.
- **usageRepo `meta` column overwrite**: pre-existing bug — `retryCount` was clobbered whenever `savedTokens` was set.
- **freebuff-profile unused import**: `updateProviderConnection` imported but never used (lint/build risk).
- **`.zcode/plans` artifact committed**: AI session planning file tracked in git; now gitignored.

## Improvements
- **Shared `providerIcon.js` helper**: single source of truth for icon resolution. Removes the byte-identical `SVG_ICON_IDS` duplication from 2 files and consolidates 14 hardcoded call sites (addresses "Reduce duplication" tech debt).
- **OverviewKpiCards label**: `"Via RTK + Headroom"` → `"All token savers"` (accurate — Pxpipe + 3 new savers now included).
- **TokenSaverStatus badges**: added missing Pxpipe + Semantic Cache badges.
- **`completionBaseline.js` + `outputSaver.js`**: reusable modules for output-side saver estimation, preventing logic duplication across 3 response handlers.

# v0.7.0 (2026-07-16)

## Features
- **Combos**: total redesign — 3 tabs (Overview/Combos/Templates), KPI row, search/filter, expandable cards with strategy visual indicators, drag-reorder models
- **v0.app**: full executor rewrite — new diff protocol parser replacing v0.dev SSE, profile + credit balance display
- **FreeBuff**: new cookie provider with NextAuth SSE executor, profile display, auto-refresh cookies
- **OpenVecta**: new API-key provider (OpenAI-compatible, 46k+ models via modelsFetcher)
- **Perplexity Agent**: new API-key provider — multi-model routing via Responses API (33+ models)
- **Moonshot AI**: new API-key provider — kimi-k3 with reasoning_effort "max" support
- **Featherless**: new API-key provider — 46,000+ HuggingFace models, live model discovery
- **QwenCloud**: new cookie provider — multi-step auth (cookie → secToken → accessToken → SSE chat), profile display
- **Pxpipe**: 5th token saver — multimodal prompt compression via in-process pxpipe-proxy library
- **Semantic Cache**: Jaccard similarity-based response cache with configurable threshold + per-key identity scoping
- **Retry**: exponential backoff + jitter + retry visualization chart in Usage page
- **Health Timeline**: SVG sparkline in provider detail (hourly success/error bars + latency line)
- **Cost Estimator**: real-time cost estimate in Playground stats bar
- **Thinking Level Picker**: per-model dropdown (auto/none/minimal/low/medium/high/xhigh/max) with suffix-based forced reasoning
- **Thought Level toggle**: per-provider global thinking override (uncommented + renamed)
- **New Badge**: "NEW" badge for unseen providers + sidebar nav items
- **Auto-rotate proxy**: no-auth providers can rotate across all active proxy pools (round-robin/random)
- **Webhook Alerts**: dedicated page with Discord/Telegram/Generic channels + event toggles
- **Web Saver UI**: Token Saver card redesign with pxpipe + semantic cache toggles
- **Vault Key Pool**: AES-256-GCM encrypted Xiaomi MiMo key pool (69 keys) with LRU rotation
- **Playground**: chat + compare mode with streaming
- **Overview dashboard**: KPI cards, token saver status, free providers grid
- **Combo Templates**: prebuilt combo library with one-click apply
- **TLS Impersonation**: wreq-js Chrome 124 fingerprint with circuit breaker
- **Ponytail**: dedicated regression tests for code compaction prompt system
- **RTK git-log filter**: JS-native compactor for git log output
- **Caveman**: upstream-aligned style rules for all 6 levels
- **Kimi K3 free button**: referral URL on Moonshot provider page
- **gpt-5.6-sol max thinking**: max reasoning_effort support for gpt-5.6-sol only
- **FreeBuff/v0 profiles**: avatar, name, email, session expiry display
- **FreeBuff/v0 auto-refresh**: capture Set-Cookie from upstream + update connection automatically

## Fixes
- **Security — Critical**: SSRF guards on proxy/relay URLs + prefetchRemoteImages; body size limits (10MB/4MB/2MB); rate limiting per API key/IP; semantic cache cross-user leak (per-key identity)
- **Security — High**: circuit breaker half-open probe cap + slot leak on abort; auth + ACL enforced regardless of requireApiKey; HealthTimeline interval leak; alerts stale closure + debounce; combos delete stale closure
- **Kimi/Step**: normalize reasoning_effort to backend enum (minimal→low, auto→omit)
- **Meta AI**: AttachmentInput GraphQL schema change (omit attachments field)
- **v0.app**: 3 critical + 4 medium audit fixes (AbortSignal, per-path text tracking, extractTextFromValue, dedupe finish, content-type check)
- **Thinking suffix**: strip (level) from upstream model in chatCore — pass original model to translator for applyThinking
- **MITM**: stale-lock recovery (validate PID, auto-delete orphan lock files)
- **Webhook**: camelCase/snake_case key mismatch (alerts silently dropped)
- **Headroom**: Kiro conversationState compression path added
- **Gemini-CLI**: thinking budget floor (min 1024) + validated toolConfig for tools
- **GitHub Copilot**: account identity labeling via /user fetch
- **RTK/find**: Windows backslash path detection + drive-letter support in autodetect
- **Codex**: capacity/rate_limit SSE patterns added to overloaded detector
- **Antigravity**: fingerprint aligned with IDE Desktop 2.1.1
- **Pricing**: added claude-opus-4.7/4.8, claude-sonnet-5, claude-fable-5, gpt-5.4/5.5/5.6 variants
- **Provider audit**: api-airforce missing from validate, mimo-free/devin/vertex test probes, openvecta validate, o1/o3/o4 + claude pattern tightening, zenmux-free icon, vault cooldown cap, reasoning_effort whitelist

---

# v0.6.9 (2026-07-14)

## Features
- Semantic Cache: Jaccard similarity-based response cache
- Retry: exponential backoff + jitter + retry visualization chart
- Health Timeline: SVG sparkline in provider detail
- Model Cost Estimator in Playground stats bar
- RTK git-log filter + Caveman upstream-aligned style rules
- Ponytail: dedicated regression tests

## Fixes
- Step/Kimi reasoning_effort normalization
- buildOutput missing from RTK registry
- PassthroughModelsSection dead import removed
- Meta AI AttachmentInput GraphQL schema change

---

# v0.6.7 (2026-07-10)

## Features
- New badge system for unseen providers + sidebar nav
- Per-model Thinking Level Picker with suffix-based forced reasoning
- ZenMux: live model fetcher + plan auto-detect from ctoken
- x.ai registry: grok-4.5, multi-agent, imagine models + thinkingConfig

## Fixes
- Thinking suffix leak: strip (level) from upstream model
- Webhook alerts: camelCase/snake_case bug (all real alerts silently dropped)

---

# v0.6.6 (2026-07-08)

## Features
- Overview dashboard page with KPI cards
- Token saved tracking pipeline (chatCore → usageRepo → _meta counter)
- Providers page total redesign (modular components)
- Usage page total redesign (Overview/Logs/Details tabs)
- 26 SVG provider icons

## Fixes
- Cline/ClinePass 401 auth flow
- TDZ errors (totalLatency + savedTokens)
- HuggingChat conversationId + DeepSeek PoW solver
- Select double-chevron fix

---

# v0.6.4 (2026-07-06)

## Features
- Kiro Claude Sonnet 5 support
- Providers page UX improvements
- OAuth providers (Windsurf, Trae, Cody)
- Usage page total redesign

---

# v0.6.2 (2026-07-05)

## Features
- Hierarchical Swarm combo strategy
- Reliability layer: Circuit Breaker, Health Monitor, Per-Key Model ACL
- 20 cookie providers (ported from OmniRoute)
- Devin CLI OAuth provider
- TLS impersonation via wreq-js (Chrome 124 fingerprint)
- ZenMux Free cookie provider
- api.airforce cookie provider (session→API-key exchange)
- Combo Template Library

## Fixes
- Cline 401 + ClinePass 401 auth detection
- Cookie providers authType mismatch

---

# v0.6.0 (2026-07-04)

## Features
- ExtremeRouter initial fork from 9router
- Devin CLI OAuth provider
- Per-provider thinking config (on/off/level)
- Hierarchical Swarm combo routing
- Circuit Breaker + Health Monitor + Per-Key ACL

## Fixes
- Cline/ClinePass authentication flow
- TDZ errors in streaming/non-streaming handlers

---

# v0.5.18 (2026-07-03)

## Features
- **Usage**: track cached tokens + correct input/output/cache cost (#2209) — hodtien
- **Codex**: show reset credit expiry details (#2290) — Rafli Ahmad Zulfikar
- **NVIDIA**: add new models and capabilities — decolua
- **ClinePass**: add provider support — sternelee

## Fixes
- **Usage**: dedupe streaming request-details log entries — Qin Li
- **Claude**: drop foreign thinking signatures in passthrough — decolua
- Prevent non-SSE stream pipe crash and cross-IdP account overwrites (#2244) — KunN-21
- **Kiro**: route IdC auth to regional CodeWhisperer surface (#2297) — Volodymyr Saakian
- **Kiro**: add Claude Sonnet 5 model support (#2264) — Edison42
- **Xiaomi-tokenplan**: region selector, key validation, multi-connection (#2251) — MiQieR
- **Translator**: strict Anthropic content block compliance (#2225) — Sahrul Ramadhan Hardiansyah
- **Kimchi**: strip reasoning_content echo to bound multi-turn input tokens — KunN-21
- **Kimchi**: bump User-Agent to kimchi/0.1.40 (#2256) — Ansh7473
- **Codebuddy-cn**: strip empty tool_calls arrays to preserve reasoning — zmf
- **Antigravity**: preserve Claude tool delta index (#2223) — Sutarto Jordan Chrisfivo
- **MITM**: generate root CA on server startup (#2228) — Sutarto Jordan Chrisfivo

# v0.5.15 (2026-06-29)

## Features
- Add Kimchi OAuth provider — Nant361
- Refine Qwen vision/video + thinking model patterns — decolua
- Opt-in Codex auto-ping quota keep-alive — Emirhan

## Fixes
- **Responses**: handle response.done terminal events (#2142) — rifuki
- **Headroom**: skip unsafe responses tool history (#2132) — Sutarto Jordan Chrisfivo
- **Translator**: map mid-conversation system message to user (claude→openai) — decolua
- **Gemini**: normalize contents to prevent 400 invalid_argument (#2192) — warelik
- **Gemini**: backfill thoughtSignature + suppress stream done sentinel — WARELIK
- **Alicode**: preserve cache_control for DashScope providers (#2069) — Rex
- **Antigravity**: strip deprecated/readOnly/writeOnly from tool schemas — iletai, Yudhistira-Official
- **CodeBuddy CN**: show bonus packs as one-time, not monthly-replenishing — whale9820
- **Kiro**: strip leaked <thinking> tags from content stream (#2158) — hamsa0x7
- **Tray**: make Windows context menu DPI-aware — Emirhan
- **Kilocode**: expose full gateway catalog in combo model picker — jellylarper
- **OpenCode**: fix Go GLM — decolua

# v0.5.12 (2026-06-26)

## Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## Docs
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## Features
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## Fixes
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event — prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## Features
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## Fixes
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## Features
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## Fixes
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL