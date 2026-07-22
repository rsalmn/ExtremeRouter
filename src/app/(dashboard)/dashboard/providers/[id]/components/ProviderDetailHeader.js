"use client";

import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

/**
 * Branded header for the provider detail page — replaces the old plain icon
 * box. Larger icon (size-14 tinted chip, matching the Providers list tile
 * style), name + category/connection/model summary line, external links, and
 * deprecation/info banners.
 *
 * Extracted from page.js lines 1238-1324. Behavioral logic unchanged.
 */
export default function ProviderDetailHeader({
  providerInfo,
  providerId,
  connections,
  modelCount,
  headerIconPath,
  headerImgError,
  setHeaderImgError,
}) {
  const externalUrl =
    providerInfo.notice?.apiKeyUrl ||
    providerInfo.notice?.signupUrl ||
    providerInfo.website;

  // Category badge label derived from authModes/authType.
  const categoryLabel = providerInfo.authModes
    ? providerInfo.authModes.includes("oauth") && providerInfo.authModes.includes("apikey")
      ? "OAuth + API Key"
      : providerInfo.authModes[0] === "oauth"
        ? "OAuth"
        : providerInfo.authModes[0] === "cookie"
          ? "Cookie"
          : "API Key"
    : providerInfo.authType === "oauth"
      ? "OAuth"
      : providerInfo.authType === "cookie"
        ? "Cookie"
        : "API Key";

  // Summary chips: category · N connections · N models
  const summaryParts = [categoryLabel];
  if (connections.length > 0) {
    summaryParts.push(`${connections.length} connection${connections.length === 1 ? "" : "s"}`);
  }
  if (modelCount > 0) {
    summaryParts.push(`${modelCount} model${modelCount === 1 ? "" : "s"}`);
  }

  const color = providerInfo.color || "#6366f1";

  return (
    <div className="min-w-0">
      <Link
        href="/dashboard/providers"
        className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-primary"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        Back to Providers
      </Link>

      {/* Branded icon + name row */}
      <div className="mt-4 flex min-w-0 items-center gap-4">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${color}15` }}
        >
          {headerImgError ? (
            <span
              className="text-base font-bold"
              style={{ color }}
            >
              {providerInfo.textIcon || providerInfo.id?.slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <Image
              src={headerIconPath}
              alt={providerInfo.name}
              width={48}
              height={48}
              className="max-h-12 max-w-12 rounded-lg object-contain"
              sizes="48px"
              onError={() => setHeaderImgError(true)}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-text-main">
              {providerInfo.name}
            </h1>
            {externalUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-sm">open_in_new</span>
                {providerInfo.notice?.apiKeyUrl ? "Get API Key" : "Sign up"}
              </a>
            )}
            {providerId === "moonshot" && (
              <a
                href="https://www.kimi.com/activities/viral-referral/share?scenario=invite&from=share_poster&invitation_code=BPGXZR"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20 transition-colors hover:bg-primary/20"
              >
                <span className="material-symbols-outlined text-sm">celebration</span>
                Get KIMI K3 For Free
              </a>
            )}
          </div>
          {/* Summary line: category · connections · models */}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            {summaryParts.map((part, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                {i > 0 && <span className="text-text-muted/40">·</span>}
                {part}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Deprecation banner */}
      {providerInfo.deprecated && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
          <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-yellow-500">
            warning
          </span>
          <p className="text-xs leading-relaxed text-red-600 dark:text-yellow-400">
            {providerInfo.deprecationNotice}
          </p>
        </div>
      )}

      {/* Info notice banner */}
      {providerInfo.notice?.text && !providerInfo.deprecated && (
        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 sm:flex-row sm:items-center">
          <span className="material-symbols-outlined shrink-0 text-[16px] text-info">info</span>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-info">
            {providerInfo.notice.text}
          </p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
            >
              Get API Key →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
