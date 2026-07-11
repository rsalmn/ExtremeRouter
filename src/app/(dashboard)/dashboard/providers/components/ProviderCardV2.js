"use client";

import Link from "next/link";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { Badge, Toggle } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX } from "@/shared/constants/providers";

// SVG_ICON_IDS — providers with vector SVG brand icons
const SVG_ICON_IDS = new Set([
  "windsurf", "trae", "cody", "kimchi",
  "chatglm-cn", "blackbox-web", "puter", "adapta-web", "deepseek-web",
  "chatgpt-web", "doubao-web", "gemini-web", "copilot-web", "muse-spark-web",
  "duckduckgo-web", "venice-web", "t3-web", "lmarena", "veoaifree-web",
  "claude-web", "pollinations", "poe-web", "v0-vercel-web", "qwen-web",
  "kimi-web", "huggingchat", "api-airforce",
]);

/**
 * Unified provider card — handles ALL provider variants:
 * OAuth, API Key, Cookie, Compatible (OpenAI/Anthropic), noAuth.
 * Replaces the old duplicated ProviderCard + ApiKeyProviderCard.
 */
export default function ProviderCardV2({
  providerId,
  provider,
  stats,
  onToggle,
  isNoAuth = false,
  comingSoon = false,
  isNew = false,
}) {
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
  const { connected, error, errorCode, errorTime, allDisabled } = stats;

  const getIconPath = () => {
    if (isCompatible) return provider.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return `/providers/${provider.id}.${SVG_ICON_IDS.has(provider.id) ? "svg" : "png"}`;
  };

  return (
    <div className="group relative flex items-center justify-between gap-3 rounded-brand border border-border-subtle bg-panel px-3 py-2.5 shadow-[var(--shadow-soft)] transition-all hover:border-primary/35 hover:bg-panel-elev hover:shadow-[var(--shadow-warm)]">
      <Link href={`/dashboard/providers/${providerId}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className="size-8 shrink-0 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${provider.color?.length > 7 ? provider.color : provider.color + "15"}` }}
        >
          <ProviderIcon
            src={getIconPath()}
            alt={provider.name}
            size={30}
            className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
            fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
            fallbackColor={provider.color}
          />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-text-main">
            {provider.name}
            {isNew && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-bold text-primary ring-1 ring-primary/20">NEW</span>
            )}
          </h3>
          <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
            {allDisabled ? (
              <Badge variant="default" size="sm">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">pause_circle</span>
                  Disabled
                </span>
              </Badge>
            ) : isNoAuth && connected === 0 && error === 0 ? (
              <Badge variant="success" size="sm" dot>Ready</Badge>
            ) : connected > 0 ? (
              <Badge variant="success" size="sm" dot>{connected} Connected</Badge>
            ) : null}
            {error > 0 && (
              <Badge variant="error" size="sm" dot>
                {errorCode ? `${error} Error (${errorCode})` : `${error} Error`}
              </Badge>
            )}
            {connected === 0 && error === 0 && !isNoAuth && stats.total === 0 && (
              <span className="text-text-muted">No connections</span>
            )}
            {comingSoon && (
              <Badge variant="warning" size="sm">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">schedule</span>
                  Coming Soon
                </span>
              </Badge>
            )}
            {isCompatible && (
              <Badge variant="default" size="sm">
                {provider.apiType === "responses" ? "Responses" : "Chat"}
              </Badge>
            )}
            {isAnthropicCompatible && (
              <Badge variant="default" size="sm">Messages</Badge>
            )}
            {errorTime && <span className="text-text-muted">{errorTime}</span>}
          </div>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {stats.total > 0 && onToggle && (
          <div
            className="opacity-60 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle(!allDisabled ? false : true);
            }}
          >
            <Toggle size="sm" checked={!allDisabled} onChange={() => {}} />
          </div>
        )}
      </div>
    </div>
  );
}

ProviderCardV2.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    total: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
    allDisabled: PropTypes.bool,
  }).isRequired,
  onToggle: PropTypes.func,
  isNoAuth: PropTypes.bool,
  comingSoon: PropTypes.bool,
};
