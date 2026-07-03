---
name: extreme-router-gateway-engine
description: |
  AI Gateway routing, provider management, and core engine expertise for ExtremeRouter.
  Use when working on request routing, provider fallback, token refresh, format translation,
  streaming, or when the user asks about "how does routing work", "add a new provider",
  "fix the fallback logic", "optimize token usage", or mentions providers, models, or API compatibility.
---

# AI Gateway Engine Expertise

You are an expert in AI Gateway architecture, provider routing, and API compatibility.

## Core Concepts

### Request Flow
```
Client Request → /v1/* endpoint
  → Route handler (src/app/api/v1/*)
  → Chat handler (src/sse/handlers/chat.js)
  → Core orchestrator (open-sse/handlers/chatCore.js)
  → Provider executor (open-sse/executors/*)
  → Upstream provider API
  → Response translation (open-sse/translator/*)
  → Client response (SSE stream or JSON)
```

### Key Components

#### 1. Route Handlers (src/app/api/v1/*)
- Receive client requests
- Validate API keys
- Delegate to chat handler
- Handle errors

#### 2. Chat Handler (src/sse/handlers/chat.js)
- Parse request body
- Resolve model/combo
- Select provider account
- Call core orchestrator
- Handle combo/fusion routing

#### 3. Core Orchestrator (open-sse/handlers/chatCore.js)
- Detect source format (OpenAI/Claude/Gemini/etc)
- Translate request to target format
- Select executor
- Execute request with retry/refresh
- Translate response back to client format
- Stream response to client
- Track usage

#### 4. Provider Executors (open-sse/executors/*)
- Build provider-specific headers
- Construct provider-specific URLs
- Handle provider-specific auth (OAuth, API key, device code)
- Parse provider-specific responses
- Handle provider-specific errors

#### 5. Format Translators (open-sse/translator/*)
- Convert between API formats
- Request translators: `openai-to-*`, `claude-to-*`, etc
- Response translators: `*-to-openai`, etc
- Concerns: shared translation logic (tool calls, usage, reasoning, etc)

## Provider Management

### Adding a New Provider

1. **Create executor** (`open-sse/executors/[provider].js`)
   - Extend `BaseExecutor`
   - Implement `buildHeaders(credentials, stream)`
   - Implement `buildUrl(model, stream, urlIndex, credentials)`
   - Implement `execute(request, credentials, options)`
   - Handle provider-specific auth refresh

2. **Register provider** (`open-sse/config/providers.js`)
   - Add provider config (baseUrl, headers, capabilities)
   - Define supported models
   - Set auth type (oauth/api_key/device_code)

3. **Create translators** (if needed)
   - Request translator: `open-sse/translator/request/openai-to-[provider].js`
   - Response translator: `open-sse/translator/response/[provider]-to-openai.js`
   - Register in `open-sse/translator/index.js`

4. **Add OAuth flow** (if OAuth provider)
   - Create OAuth handler in `src/app/api/oauth/[provider]/*`
   - Implement token refresh in `open-sse/services/tokenRefresh/providers.js`
   - Add to `src/lib/oauth/providers.js`

5. **Add provider registry** (`open-sse/providers/registry/[provider].js`)
   - Define provider metadata
   - List supported models
   - Set pricing/capabilities

### Provider Fallback Logic

When a request fails:
1. **Check error type** (401/403 → auth issue, 429 → rate limit, 5xx → server error)
2. **Try next account** (if multiple accounts for same provider)
3. **Try next model in combo** (if using combo routing)
4. **Return error** (if all fallbacks exhausted)

Key files:
- `open-sse/services/accountFallback.js` — account-level fallback
- `open-sse/services/combo.js` — combo/fusion routing

### Token Refresh Flow

When credentials expire:
1. Detect 401/403 response
2. Check if provider supports refresh
3. Call `refreshCredentials(credentials)`
4. Retry request with new credentials
5. Update stored credentials

Key files:
- `open-sse/services/tokenRefresh.js` — refresh orchestration
- `open-sse/services/tokenRefresh/providers.js` — provider-specific refresh logic

## Format Translation

### Supported Formats

**Source formats** (what clients send):
- `openai` — OpenAI Chat Completions
- `openai-responses` — OpenAI Responses API
- `claude` — Anthropic Messages API
- `gemini` — Google Gemini API
- `gemini-cli` — Gemini CLI format
- `antigravity` — Antigravity IDE format

**Target formats** (what providers accept):
- OpenAI Chat
- OpenAI Responses
- Claude Messages
- Gemini
- Gemini CLI
- Kiro (AWS CodeWhisperer)
- Cursor
- Ollama
- CommandCode

### Translation Architecture

```
Request Translation:
  Client Format → Detect → Translate → Provider Format

Response Translation:
  Provider Format → Translate → Client Format
```

**Translator Registry** (`open-sse/translator/index.js`):
- Maps (source, target) pairs to translator functions
- Auto-detects source format from request shape
- Selects appropriate translator

**Concerns** (`open-sse/translator/concerns/*`):
- Shared translation logic (tool calls, usage, reasoning, thinking, etc)
- Reused across multiple translators
- Keep translators DRY

### Adding a New Translator

1. **Create request translator** (`open-sse/translator/request/[source]-to-[target].js`)
   - Export `translate(body, options)` function
   - Convert messages, tools, parameters
   - Handle streaming vs non-streaming

2. **Create response translator** (`open-sse/translator/response/[target]-to-[source].js`)
   - Export `translate(chunk, options)` function
   - Convert SSE chunks or JSON response
   - Map finish reasons, usage, tool calls

3. **Register translators** (`open-sse/translator/index.js`)
   - Add to `REQUEST_TRANSLATORS` map
   - Add to `RESPONSE_TRANSLATORS` map

4. **Add concerns** (if new translation logic needed)
   - Create concern in `open-sse/translator/concerns/`
   - Import and use in translators

## Streaming

### SSE Stream Flow

```
Provider SSE Stream
  → Executor parses chunks
  → Response translator converts format
  → StreamController manages client connection
  → Client receives translated SSE stream
```

Key files:
- `open-sse/utils/streamHandler.js` — StreamController
- `open-sse/utils/stream.js` — stream utilities
- `open-sse/handlers/chatCore/streamingHandler.js` — streaming orchestration

### Stream Safety

- Handle client disconnect (abort controller)
- Flush pending data on stream end
- Send `[DONE]` marker for OpenAI format
- Translate finish reasons correctly
- Extract usage from final chunk

## Token Usage & Cost Tracking

### Usage Extraction

After request completes:
1. Extract usage from response (prompt_tokens, completion_tokens)
2. Calculate cost (using pricing config)
3. Save to usage database (`src/lib/db/repos/usageRepo.js`)
4. Update provider quota tracking

Key files:
- `open-sse/utils/usageTracking.js` — usage extraction
- `open-sse/providers/pricing.js` — pricing config
- `src/lib/db/repos/usageRepo.js` — usage persistence

### RTK Token Saver

RTK (Router Token Killer) compresses tool_result content to save tokens:
- `open-sse/rtk/caveman.js` — aggressive compression
- `open-sse/rtk/ponytail.js` — moderate compression
- `open-sse/rtk/headroom.js` — external service compression

Enabled per-request via `rtkEnabled` flag in `handleChatCore`.

## Provider Capabilities

### Model Capabilities

Each model has capabilities:
- Context window size
- Max output tokens
- Supported features (tools, vision, streaming, etc)
- Pricing (input/output cost per token)

Defined in:
- `open-sse/providers/capabilities.js` — capability lookup
- `open-sse/providers/models/` — model definitions
- `open-sse/providers/pricing.js` — pricing config

### Provider Health

Track provider health:
- Success rate
- Latency
- Error rates
- Rate limit status

Use for:
- Routing decisions (prefer healthy providers)
- Fallback triggers (switch on high error rate)
- Dashboard display (show provider status)

## Performance Optimization

### Caching

- Cache provider capabilities (avoid repeated lookups)
- Cache model pricing (avoid repeated DB reads)
- Cache OAuth tokens (avoid repeated refresh)

### Parallel Requests

- Use `Promise.all` for independent operations
- Prefetch remote images (parallel fetch)
- Parallel account selection (try multiple accounts)

### Streaming

- Start streaming immediately (don't buffer)
- Translate chunks incrementally
- Avoid blocking the event loop

## Debugging Tips

### Request Not Reaching Provider

1. Check API key validation (settings.requireApiKey)
2. Check model resolution (is model in combo?)
3. Check account selection (is account active?)
4. Check executor selection (is provider registered?)

### Provider Returns Error

1. Check credentials (are tokens valid?)
2. Check request format (is translation correct?)
3. Check provider status (is provider down?)
4. Check rate limits (is account rate-limited?)

### Response Not Reaching Client

1. Check stream controller (is connection alive?)
2. Check response translation (is format correct?)
3. Check error handling (is error being swallowed?)
4. Check client disconnect (did client abort?)

## Example: Adding a Provider

When adding a new provider, structure your response as:

```
## Provider Overview
[name, API type, auth method]

## Implementation Plan
1. Create executor
2. Register provider config
3. Create translators (if needed)
4. Add OAuth flow (if OAuth)
5. Add provider registry entry
6. Test with sample requests

## Executor Code
[open-sse/executors/[provider].js]

## Provider Config
[open-sse/config/providers.js addition]

## Translators (if needed)
[open-sse/translator/request/openai-to-[provider].js]
[open-sse/translator/response/[provider]-to-openai.js]

## OAuth Flow (if OAuth)
[src/app/api/oauth/[provider]/*]

## Testing
[sample requests to verify]
```
