import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// BlackboxWebExecutor — web-cookie reverse of app.blackbox.ai's consumer chat.
//
// Auth: `next-auth.session-token` cookie from app.blackbox.ai.
// The executor also fetches `/api/auth/session` + `/api/check-subscription` per cookie
// (cached 5 min) because Blackbox requires the session + subscription objects inside the
// `/api/chat` request body. It generates a `validated` token (env override or random UUID)
// that Blackbox's frontend normally ships as `tk`.
//
// Response: Blackbox `/api/chat` returns plain text (not SSE). The executor wraps it as
// OpenAI chat.completion.chunk frames (stream) or one chat.completion JSON (non-stream).
//
// Plain text chat only — tool/function-calling is intentionally NOT supported.

const BLACKBOX_CHAT_API = PROVIDERS["blackbox-web"].baseUrl; // https://app.blackbox.ai/api/chat
const SESSION_URL = "https://app.blackbox.ai/api/auth/session";
const SUBSCRIPTION_URL = "https://app.blackbox.ai/api/check-subscription";
const BLACKBOX_DEFAULT_COOKIE = "next-auth.session-token";
const BLACKBOX_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const SESSION_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_SESSIONS = 100;
const SESSION_CACHE = new Map();

// Resolve the `validated` token for Blackbox `/api/chat` requests.
//
// Blackbox's web frontend ships a real validation token (exported as `tk` from its Next.js
// JS chunks). If the value sent in `transformedBody.validated` does not match that token,
// the upstream returns HTTP 403 even when the session cookie and subscription are valid.
// Resolution priority:
//   1. BLACKBOX_WEB_VALIDATED_TOKEN env var (operator-supplied, preferred)
//   2. Random UUID fallback (works only as long as Blackbox doesn't enforce a specific `tk`)
function resolveBlackboxValidatedToken() {
  const explicit = (process.env.BLACKBOX_WEB_VALIDATED_TOKEN || "").trim();
  if (explicit) return explicit;
  return crypto.randomUUID();
}

// Detect whether a Blackbox 403 body indicates the `validated` token is the problem
// (vs a missing cookie or expired subscription).
function isBlackboxValidatedTokenError(responseText) {
  const lower = (responseText || "").toLowerCase();
  return (
    lower.includes("invalid validated token") ||
    lower.includes("invalid validated") ||
    lower.includes("validation token") ||
    lower.includes("invalid token")
  );
}

// ─── Cookie parsing helpers (inlined from OmniRoute webCookieAuth) ───────────
// Strip a leading "Cookie:" / "bearer " prefix from whatever the user pasted.
function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";
  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

// Build the `Cookie` header value: forward a blob with pairs as-is, else wrap a bare value
// as `<defaultCookieName>=<value>`.
function normalizeBlackboxCookieHeader(apiKey) {
  const normalized = stripCookieInputPrefix(apiKey || "");
  if (!normalized) return "";
  if (normalized.includes("=")) return normalized;
  return `${BLACKBOX_DEFAULT_COOKIE}=${normalized}`;
}

// ─── Message parsing ─────────────────────────────────────────────────────────
function extractMessageText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "input_text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter((part) => part.trim().length > 0)
    .join("\n")
    .trim();
}

// Convert OpenAI messages into the Blackbox {id, role, content} shape. System/developer
// messages are folded into the first user message as a prefix.
function parseOpenAIMessages(messages, chatId) {
  const systemParts = [];
  const parsed = [];

  for (const message of messages) {
    const role = String(message.role || "user");
    const content = extractMessageText(message.content);
    if (!content) continue;

    if (role === "system" || role === "developer") {
      systemParts.push(content);
      continue;
    }
    if (role === "assistant" || role === "user") {
      parsed.push({
        id: role === "user" ? chatId : crypto.randomUUID(),
        role,
        content,
      });
    }
  }

  if (systemParts.length > 0) {
    const prefix = `System instructions:\n${systemParts.join("\n\n")}`;
    const firstUserIndex = parsed.findIndex((m) => m.role === "user");
    if (firstUserIndex >= 0) {
      parsed[firstUserIndex] = {
        ...parsed[firstUserIndex],
        content: `${prefix}\n\n${parsed[firstUserIndex].content}`,
      };
    } else {
      parsed.unshift({ id: chatId, role: "user", content: prefix });
    }
  }

  return parsed;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function errorResponse(status, message, code) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code: code || `HTTP_${status}` } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// Read a full plain-text body from a stream, honoring abort.
async function readTextResponse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    try { reader.releaseLock(); } catch { /* */ }
  }
}

// Wrap a complete plain-text response as OpenAI SSE (role + content + stop + [DONE]).
function buildStreamingResponse(responseText, model, id, created) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          sseChunk({
            id, object: "chat.completion.chunk", created, model, system_fingerprint: null,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
          })
        )
      );
      if (responseText) {
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: responseText }, finish_reason: null, logprobs: null }],
            })
          )
        );
      }
      controller.enqueue(
        encoder.encode(
          sseChunk({
            id, object: "chat.completion.chunk", created, model, system_fingerprint: null,
            choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
          })
        )
      );
      controller.enqueue(encoder.encode(SSE_DONE));
      controller.close();
    },
  });
}

function buildNonStreamingResponse(responseText, model, id, created) {
  const completionTokens = estimateTokens(responseText);
  return new Response(
    JSON.stringify({
      id, object: "chat.completion", created, model, system_fingerprint: null,
      choices: [{ index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop", logprobs: null }],
      usage: {
        prompt_tokens: completionTokens,
        completion_tokens: completionTokens,
        total_tokens: completionTokens * 2,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export class BlackboxWebExecutor extends BaseExecutor {
  constructor() {
    super("blackbox-web", PROVIDERS["blackbox-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};
    const messages = bodyObj.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array", "INVALID_REQUEST"),
        url: BLACKBOX_CHAT_API,
        headers: {},
        transformedBody: body,
      };
    }

    const chatId = crypto.randomUUID().slice(0, 7);
    const parsedMessages = parseOpenAIMessages(messages, chatId);
    if (parsedMessages.length === 0) {
      return {
        response: errorResponse(400, "Empty query after processing messages", "INVALID_REQUEST"),
        url: BLACKBOX_CHAT_API,
        headers: {},
        transformedBody: body,
      };
    }

    const cookieHeader = normalizeBlackboxCookieHeader(credentials?.apiKey || "");
    const baseHeaders = {
      Accept: "application/json",
      Cookie: cookieHeader,
      Origin: "https://app.blackbox.ai",
      "User-Agent": BLACKBOX_USER_AGENT,
    };

    // Fetch session + subscription — Blackbox requires these in the request body.
    // Cached per cookie to avoid redundant round-trips on every request.
    let sessionData = null;
    let subscriptionCache = null;
    let teamAccount = "";

    const cacheKey = cookieHeader;
    const cached = SESSION_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < SESSION_CACHE_TTL_MS) {
      sessionData = cached.sessionData;
      subscriptionCache = cached.subscriptionCache;
      teamAccount = cached.teamAccount;
      log?.debug?.("BLACKBOX-WEB", `Session cache hit (${teamAccount || "no email"})`);
    } else {
      try {
        const sessionRes = await proxyAwareFetch(
          SESSION_URL,
          { method: "GET", headers: { ...baseHeaders, Accept: "application/json" }, signal },
          proxyOptions
        );
        sessionData = sessionRes.ok ? await sessionRes.json().catch(() => null) : null;
        const email = sessionData?.user?.email;
        teamAccount = email || "";
        log?.debug?.("BLACKBOX-WEB", `Session email: ${email ?? "none"}`);

        if (email) {
          const subRes = await proxyAwareFetch(
            SUBSCRIPTION_URL,
            {
              method: "POST",
              headers: { ...baseHeaders, "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
              signal,
            },
            proxyOptions
          );
          const rawSub = subRes.ok ? await subRes.json().catch(() => null) : null;
          if (rawSub) {
            subscriptionCache = {
              status: rawSub.hasActiveSubscription ? "PREMIUM" : "FREE",
              customerId: rawSub.customerId ?? null,
              expiryTimestamp: rawSub.expiryTimestamp ?? null,
              lastChecked: Date.now(),
              isTrialSubscription: rawSub.isTrialSubscription ?? false,
              hasPaymentVerificationFailure: false,
              verificationFailureTimestamp: null,
              requiresAuthentication: false,
              isTeam: rawSub.isTeam ?? false,
              numSeats: rawSub.numSeats ?? 1,
              provider: rawSub.provider ?? null,
              previouslySubscribed: rawSub.previouslySubscribed ?? false,
              activeInsuffientCredits: rawSub.activeInsuffientCredits ?? false,
            };
            log?.debug?.("BLACKBOX-WEB", `Subscription: ${subscriptionCache.status}`);
          }
        }

        SESSION_CACHE.set(cacheKey, { sessionData, subscriptionCache, teamAccount, fetchedAt: Date.now() });
        while (SESSION_CACHE.size > MAX_SESSIONS) {
          const oldestKey = SESSION_CACHE.keys().next().value;
          if (oldestKey !== undefined) SESSION_CACHE.delete(oldestKey);
          else break;
        }
      } catch (diagErr) {
        log?.debug?.("BLACKBOX-WEB", `Session/subscription fetch failed (non-fatal): ${diagErr?.message || diagErr}`);
      }
    }

    const headers = {
      ...baseHeaders,
      Accept: "text/plain, */*",
      "Content-Type": "application/json",
      Referer: `https://app.blackbox.ai/chat/${chatId}`,
    };

    const transformedBody = {
      messages: parsedMessages,
      id: chatId,
      previewToken: null,
      userId: credentials?.providerSpecificData?.userId ?? null,
      codeModelMode: true,
      trendingAgentMode: {},
      isMicMode: false,
      userSystemPrompt: null,
      maxTokens: Number(bodyObj.max_tokens) || 1024,
      playgroundTopP: null,
      playgroundTemperature: null,
      isChromeExt: false,
      githubToken: "",
      clickedAnswer2: false,
      clickedAnswer3: false,
      clickedForceWebSearch: false,
      visitFromDelta: false,
      isMemoryEnabled: false,
      mobileClient: false,
      userSelectedModel: model || null,
      userSelectedAgent: "VscodeAgent",
      // Blackbox's `/api/chat` rejects mismatched validated tokens with 403; prefer an
      // operator-supplied BLACKBOX_WEB_VALIDATED_TOKEN over a random UUID.
      validated: resolveBlackboxValidatedToken(),
      imageGenerationMode: false,
      imageGenMode: "autoMode",
      webSearchModePrompt: false,
      deepSearchMode: false,
      promptSelection: "",
      domains: null,
      vscodeClient: false,
      codeInterpreterMode: false,
      customProfile: {
        name: "",
        occupation: "",
        traits: [],
        additionalInfo: "",
        enableNewChats: false,
      },
      webSearchModeOption: { autoMode: true, webMode: false, offlineMode: false },
      session: sessionData,
      isPremium: subscriptionCache
        ? subscriptionCache.status === "PREMIUM"
        : (credentials?.providerSpecificData?.isPremium ?? true),
      teamAccount,
      subscriptionCache,
      beastMode: false,
      reasoningMode: false,
      designerMode: false,
      workspaceId: "",
      asyncMode: false,
      integrations: {},
      isTaskPersistent: false,
      selectedElement: null,
    };

    let upstreamResponse;
    try {
      upstreamResponse = await proxyAwareFetch(
        BLACKBOX_CHAT_API,
        { method: "POST", headers, body: JSON.stringify(transformedBody), signal },
        proxyOptions
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log?.error?.("BLACKBOX-WEB", `Fetch failed: ${message}`);
      if (error?.name === "AbortError") throw error;
      return {
        response: errorResponse(502, `Blackbox Web connection failed: ${message}`, "FETCH_FAILED"),
        url: BLACKBOX_CHAT_API,
        headers,
        transformedBody,
      };
    }

    if (!upstreamResponse.ok) {
      const status = upstreamResponse.status;
      let message = `Blackbox Web returned HTTP ${status}`;
      const errorBody = await upstreamResponse.text().catch(() => "");
      if (status === 403 && isBlackboxValidatedTokenError(errorBody)) {
        message =
          "Blackbox Web rejected the request with an invalid `validated` token. " +
          "If you have a valid frontend token (the `tk` value from app.blackbox.ai's " +
          "Next.js bundle), set BLACKBOX_WEB_VALIDATED_TOKEN in your environment and restart.";
      } else if (status === 401 || status === 403) {
        message =
          "Blackbox Web auth failed — your app.blackbox.ai session cookie may be missing or expired.";
      } else if (status === 429) {
        message = "Blackbox Web rate limited the session. Wait a moment and retry.";
      }
      log?.warn?.("BLACKBOX-WEB", message);
      return {
        response: errorResponse(status, message, `HTTP_${status}`),
        url: BLACKBOX_CHAT_API,
        headers,
        transformedBody,
      };
    }

    if (!upstreamResponse.body) {
      return {
        response: errorResponse(502, "Blackbox Web returned an empty response body", "EMPTY_BODY"),
        url: BLACKBOX_CHAT_API,
        headers,
        transformedBody,
      };
    }

    const responseText = (await readTextResponse(upstreamResponse.body, signal)).trim();

    log?.debug?.("BLACKBOX-WEB", `Response (first 300 chars): ${responseText.slice(0, 300)}`);
    log?.debug?.("BLACKBOX-WEB", `userSelectedModel sent: ${transformedBody.userSelectedModel}`);
    log?.debug?.("BLACKBOX-WEB", `isPremium sent: ${transformedBody.isPremium}`);

    // Blackbox sometimes returns HTTP 200 with in-band error messages. Detect known patterns
    // and surface them as real errors.
    const lowerText = responseText.toLowerCase();
    const isSubscriptionError =
      /not upgraded|upgrade to a premium plan|upgrade.required/i.test(responseText) ||
      lowerText.includes("please upgrade");
    const isAuthError =
      /please login|login required|authentication required/i.test(responseText) && !isSubscriptionError;
    const isRateLimit = /rate limit|too many requests/i.test(responseText) && !isSubscriptionError;

    if (isSubscriptionError) {
      log?.warn?.("BLACKBOX-WEB", "Blackbox returned subscription error in response body");
      return {
        response: errorResponse(
          402,
          "Blackbox reports your account lacks a premium subscription. If you have a paid plan, re-paste your session cookie from app.blackbox.ai.",
          "BLACKBOX_SUBSCRIPTION_REQUIRED"
        ),
        url: BLACKBOX_CHAT_API,
        headers,
        transformedBody,
      };
    }
    if (isAuthError) {
      log?.warn?.("BLACKBOX-WEB", "Blackbox returned auth error in response body");
      return {
        response: errorResponse(
          401,
          "Blackbox session is not authenticated — re-paste next-auth.session-token from app.blackbox.ai",
          "BLACKBOX_AUTH_REQUIRED"
        ),
        url: BLACKBOX_CHAT_API,
        headers,
        transformedBody,
      };
    }
    if (isRateLimit) {
      log?.warn?.("BLACKBOX-WEB", "Blackbox returned rate-limit error in response body");
      return {
        response: errorResponse(
          429,
          "Blackbox Web rate limited the session. Wait a moment and retry.",
          "BLACKBOX_RATE_LIMIT"
        ),
        url: BLACKBOX_CHAT_API,
        headers,
        transformedBody,
      };
    }

    const id = `chatcmpl-blackbox-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    const finalResponse = stream
      ? new Response(buildStreamingResponse(responseText, model, id, created), {
          status: 200,
          headers: { ...SSE_HEADERS_NO_BUFFER },
        })
      : buildNonStreamingResponse(responseText, model, id, created);

    return { response: finalResponse, url: BLACKBOX_CHAT_API, headers, transformedBody };
  }
}

export default BlackboxWebExecutor;
