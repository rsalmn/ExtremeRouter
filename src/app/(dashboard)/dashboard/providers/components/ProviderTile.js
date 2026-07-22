"use client";

import Link from "next/link";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { Badge, Toggle, Tooltip } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX } from "@/shared/constants/providers";
import { getProviderIconPath } from "@/shared/utils/providerIcon";

/**
 * Rich provider tile — replaces ProviderCardV2 in the redesigned Providers page.
 *
 * Shows more detail at a glance than the old compact row:
 *   - Larger icon (size-10 tinted chip)
 *   - Name + NEW badge + connection count
 *   - Status badges (Connected / Error / Disabled / Ready / Coming Soon)
 *   - Bottom action bar: quick-test (if connected), settings link, toggle
 *
 * Pattern follows ComboCard (Card padding="none", top Link area, bottom
 * border-t action bar) and the Quota provider cards (icon box, status pills,
 * h-8 icon buttons wrapped in Tooltip).
 *
 * The entire top area is a Link to the detail page. The action bar buttons
 * stopPropagation so toggle/test don't navigate.
 */
export default function ProviderTile({
  providerId,
  provider,
  stats,
  onToggle,
  onTest,
  isNoAuth = false,
  comingSoon = false,
  isNew = false,
  testing = false,
}) {
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
  const { connected, error, errorCode, allDisabled } = stats;
  const iconPath = getProviderIconPath(providerId, provider.apiType);
  const hasConnections = stats.total > 0;
  const showToggle = hasConnections && onToggle && !comingSoon;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-panel border border-border-subtle bg-panel shadow-[var(--shadow-soft)] transition-all hover:border-primary/35 hover:bg-panel-elev hover:shadow-[var(--shadow-warm)]",
        comingSoon && "opacity-70",
      )}
    >
      {/* ── Top: clickable link area ── */}
      <Link
        href={`/dashboard/providers/${providerId}`}
        className="flex min-w-0 flex-col gap-2 px-3 pb-2 pt-3"
      >
        {/* Icon + name row */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: `${provider.color?.length > 7 ? provider.color.slice(0, 7) : provider.color}15`,
            }}
          >
            <ProviderIcon
              src={iconPath}
              alt={provider.name}
              size={32}
              className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
              fallbackText={provider.textIcon || provider.id?.slice(0, 2).toUpperCase()}
              fallbackColor={provider.color}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-text-main">
              <span className="truncate">{provider.name}</span>
              {isNew && (
                <span className="inline-flex shrink-0 items-center rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-bold text-primary ring-1 ring-primary/20">
                  NEW
                </span>
              )}
            </h3>
            {hasConnections ? (
              <p className="mt-0.5 text-[11px] text-text-muted">
                {connected > 0 ? `${connected} active` : `${stats.total} connection${stats.total > 1 ? "s" : ""}`}
              </p>
            ) : isNoAuth ? (
              <p className="mt-0.5 text-[11px] text-text-muted">No key needed</p>
            ) : (
              <p className="mt-0.5 text-[11px] text-text-muted">Not connected</p>
            )}
          </div>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-1.5">
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

          {comingSoon && (
            <Badge variant="warning" size="sm">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">schedule</span>
                Soon
              </span>
            </Badge>
          )}

          {isCompatible && (
            <Badge variant="default" size="sm">
              {provider.apiType === "responses" ? "Responses" : "Chat"}
            </Badge>
          )}
          {isAnthropicCompatible && <Badge variant="default" size="sm">Messages</Badge>}
        </div>
      </Link>

      {/* ── Bottom: action bar ── */}
      <div className="flex items-center gap-1 border-t border-border-subtle px-3 py-2">
        {/* Quick test (only when connected) */}
        {hasConnections && onTest && (
          <Tooltip text={testing ? "Testing..." : "Test provider"}>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTest(providerId);
              }}
              disabled={testing}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-primary disabled:opacity-50"
              aria-label="Test provider"
            >
              <span className={cn("material-symbols-outlined text-[16px]", testing && "animate-spin")}>
                {testing ? "progress_activity" : "bolt"}
              </span>
            </button>
          </Tooltip>
        )}

        {/* Settings link */}
        <Tooltip text="Configure">
          <Link
            href={`/dashboard/providers/${providerId}`}
            onClick={(e) => e.stopPropagation()}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-primary"
            aria-label="Configure provider"
          >
            <span className="material-symbols-outlined text-[16px]">settings</span>
          </Link>
        </Tooltip>

        {/* Spacer pushes toggle right */}
        <div className="flex-1" />

        {/* Toggle (only if has connections) */}
        {showToggle && (
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle(!allDisabled ? false : true);
            }}
            className="opacity-80 sm:opacity-50 sm:group-hover:opacity-100"
          >
            <Toggle size="sm" checked={!allDisabled} onChange={() => {}} />
          </div>
        )}
      </div>
    </div>
  );
}
