"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import DonateModal from "./DonateModal";

const navGroups = [
  {
    label: "Gateway",
    items: [
      { href: "/dashboard/overview", label: "Overview", icon: "dashboard" },
      { href: "/dashboard/playground", label: "Playground", icon: "science" },
      { href: "/dashboard/endpoint", label: "Endpoint", icon: "api" },
      { href: "/dashboard/providers", label: "Providers", icon: "dns" },
      { href: "/dashboard/combos", label: "Combos", icon: "layers" },
      { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
    ],
  },
  {
    label: "Observe",
    items: [
      { href: "/dashboard/usage", label: "Activity", icon: "bar_chart" },
      { href: "/dashboard/health", label: "Health", icon: "monitor_heart" },
      { href: "/dashboard/quota", label: "Quota", icon: "data_usage" },
      { href: "/dashboard/swarm", label: "Swarm", icon: "hub" },
      { href: "/dashboard/console-log", label: "Console", icon: "terminal" },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
      { href: "/dashboard/translator", label: "Translator", icon: "translate" },
      { href: "/dashboard/mitm", label: "MITM Proxy", icon: "security" },
      { href: "/dashboard/media-providers/image", label: "Media", icon: "perm_media" },
    ],
  },
  {
    label: "Configure",
    items: [
      { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
      { href: "/dashboard/skills", label: "Skills", icon: "extension" },
      { href: "/dashboard/profile", label: "Settings", icon: "settings" },
    ],
  },
];

export default function Sidebar({ onClose }) {
  // usePathname() returns the current route and updates on every client-side
  // navigation (App Router), so `active` below is always derived from the live URL.
  const pathname = usePathname();
  const [supportOpen, setSupportOpen] = useState(false);

  const isActive = (href) => {
    if (!pathname) return false;
    // Exact match always wins (covers /dashboard root → Endpoint).
    if (pathname === href) return true;
    // Segment-boundary match: "/dashboard/providers" matches "/dashboard/providers/clinepass"
    // but NOT "/dashboard/providers-new" or unrelated routes.
    if (href === "/dashboard/endpoint") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border-subtle bg-sidebar backdrop-blur-xl">
      <div className="border-b border-border-subtle p-4">
        <Link href="/dashboard" onClick={onClose} className="group flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-brand bg-primary text-white shadow-[var(--shadow-warm)]">
            <span className="material-symbols-outlined text-[20px]">hub</span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-text-main">ExtremeRouter</div>
            <div className="text-xs text-text-muted">Gateway Console · v{APP_CONFIG.version}</div>
          </div>
        </Link>
      </div>

      <div className="p-3">
        <Link
          href="/dashboard/providers"
          onClick={onClose}
          className="flex h-9 items-center gap-2 rounded-brand border border-border bg-surface-2 px-3 text-xs text-text-muted transition-colors hover:border-primary/40 hover:text-text-main"
        >
          <span className="material-symbols-outlined text-[16px]">search</span>
          Search providers, models, keys…
        </Link>
      </div>

      <nav className="custom-scrollbar flex-1 overflow-y-auto px-3 pb-4">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-5">
            <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-subtle">{group.label}</div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "group flex h-9 items-center gap-3 rounded-brand px-3 text-sm transition-colors",
                      active
                        ? "bg-primary/15 text-text-main ring-1 ring-primary/20"
                        : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                    )}
                  >
                    <span className={cn("material-symbols-outlined text-[18px]", active && "text-primary fill-1")}>{item.icon}</span>
                    <span className="truncate font-medium">{item.label}</span>
                    {active && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border-subtle p-3">
        <button
          type="button"
          onClick={() => setSupportOpen(true)}
          className="mb-2 flex h-9 w-full items-center gap-3 rounded-brand px-3 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main"
        >
          <span className="material-symbols-outlined text-[18px]">volunteer_activism</span>
          <span className="font-medium">Support</span>
        </button>
        <div className="rounded-brand border border-border-subtle bg-surface-2 p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-text-main">
            <span className="size-2 rounded-full bg-success" />
            Local Gateway
          </div>
          <div className="font-mono text-[11px] text-text-muted">localhost:20128/v1</div>
        </div>
      </div>

      <DonateModal isOpen={supportOpen} onClose={() => setSupportOpen(false)} />
    </aside>
  );
}

Sidebar.propTypes = { onClose: PropTypes.func };
