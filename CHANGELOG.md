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