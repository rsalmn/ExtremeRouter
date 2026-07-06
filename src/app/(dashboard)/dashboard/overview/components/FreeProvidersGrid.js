"use client";

import PropTypes from "prop-types";
import Link from "next/link";
import { EmptyState } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";

const SVG_ICON_IDS = new Set([
  "windsurf", "trae", "cody", "kimchi",
  "chatglm-cn", "blackbox-web", "puter", "adapta-web", "deepseek-web",
  "chatgpt-web", "doubao-web", "gemini-web", "copilot-web", "muse-spark-web",
  "duckduckgo-web", "venice-web", "t3-web", "lmarena", "veoaifree-web",
  "claude-web", "pollinations", "poe-web", "v0-vercel-web", "qwen-web",
  "kimi-web", "huggingchat",
]);

const fmt = (n) => {
  const num = Number(n || 0);
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
};

function getIconPath(providerId) {
  return `/providers/${providerId}.${SVG_ICON_IDS.has(providerId) ? "svg" : "png"}`;
}

export default function FreeProvidersGrid({ providers }) {
  if (!providers || providers.length === 0) {
    return (
      <EmptyState
        icon="redeem"
        title="No free providers used yet"
        description="Connect a free provider (Kiro, OpenCode, etc.) and start routing requests to see usage here."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {providers.map((p) => {
        const color = p.color || "#6b7280";
        const bg = color.length > 7 ? color : color + "15";
        return (
          <Link
            key={p.id}
            href={`/dashboard/providers/${p.id}`}
            className="group flex items-center gap-3 rounded-brand border border-border-subtle bg-panel px-3 py-2.5 shadow-[var(--shadow-soft)] transition-all hover:border-primary/35 hover:bg-panel-elev hover:shadow-[var(--shadow-warm)]"
          >
            <div
              className="size-8 shrink-0 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: bg }}
            >
              <ProviderIcon
                src={getIconPath(p.id)}
                alt={p.name}
                size={24}
                className="object-contain rounded max-w-[24px] max-h-[24px]"
                fallbackText={(p.name || p.id).slice(0, 2).toUpperCase()}
                fallbackColor={color}
              />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold text-text-main">{p.name}</h3>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                {p.requests > 0 ? (
                  <>
                    <span className="font-medium">{fmt(p.requests)} requests</span>
                    <span>·</span>
                    <span>{fmt(p.tokens)} tokens</span>
                  </>
                ) : p.connected ? (
                  <span className="flex items-center gap-1 text-success">
                    <span className="size-1.5 rounded-full bg-success" />
                    Connected
                  </span>
                ) : (
                  <span>No usage yet</span>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

FreeProvidersGrid.propTypes = {
  providers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      icon: PropTypes.string,
      color: PropTypes.string,
      requests: PropTypes.number,
      tokens: PropTypes.number,
    })
  ),
};
