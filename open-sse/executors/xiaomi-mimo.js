import { DefaultExecutor } from "./default.js";
import {
  getMimoAccountCookie,
  invalidateMimoAccountCookieCache,
  MIMO_API_BASE,
  MIMO_CHAT_UA,
  MIMO_CHAT_SOURCE_HEADER,
  MIMO_CLIENT_VERSION,
} from "../shared/mimoAccount.js";

const PREVIEW_MODELS = new Set(["mimo-x-pro-preview", "mimo-x-flash-preview"]);
const COOKIE_KEY = "__mimoAccountCookie";

function bareModel(model) {
  const s = String(model || "");
  const i = s.indexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

export class XiaomiMimoExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-mimo");
  }

  static isPreviewModel(model) {
    return PREVIEW_MODELS.has(bareModel(model));
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (XiaomiMimoExecutor.isPreviewModel(model)) {
      return `${MIMO_API_BASE}/api/route/chat/completions`;
    }
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  buildHeaders(credentials, stream = true, model, opencodeIdentity, urlIndex) {
    if (XiaomiMimoExecutor.isPreviewModel(model) && credentials?.[COOKIE_KEY]) {
      return {
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
        "User-Agent": MIMO_CHAT_UA,
        "X-Mimo-Source": MIMO_CHAT_SOURCE_HEADER,
        "X-Client-Version": MIMO_CLIENT_VERSION,
        Cookie: credentials[COOKIE_KEY],
      };
    }
    return super.buildHeaders(credentials, stream, model, opencodeIdentity, urlIndex);
  }

  transformRequest(model, body, stream, credentials) {
    const out = super.transformRequest(model, body, stream, credentials);
    if (XiaomiMimoExecutor.isPreviewModel(model)) {
      if (out.thinking == null) out.thinking = { type: "enabled" };
      if (out.temperature == null) out.temperature = 1.0;
      if (out.top_p == null) out.top_p = 0.95;
      if (!out.max_tokens) out.max_tokens = 4096;
    }

    return out;
  }

  async execute(args) {
    const { model, credentials, proxyOptions = null } = args;
    if (!XiaomiMimoExecutor.isPreviewModel(model)) return super.execute(args);

    const cookie = await getMimoAccountCookie(credentials?.providerSpecificData, proxyOptions);
    if (!cookie) {
      throw new Error(
        "Xiaomi MiMo account session unavailable. Sign in to MiMo Desktop once so its passToken is present, then retry.",
      );
    }
    credentials[COOKIE_KEY] = cookie;
    const result = await super.execute(args);

    // A cached session can expire early — drop it and retry once with a fresh one.
    if (result?.response?.status === 401) {
      invalidateMimoAccountCookieCache();
      const fresh = await getMimoAccountCookie(credentials?.providerSpecificData, proxyOptions).catch(() => null);
      if (fresh) {
        credentials[COOKIE_KEY] = fresh;
        return super.execute(args);
      }
    }
    return result;
  }
}

export const __test__ = { PREVIEW_MODELS, bareModel, COOKIE_KEY };

export default XiaomiMimoExecutor;
