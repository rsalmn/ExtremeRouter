"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import PropTypes from "prop-types";
import HeaderMenu from "@/shared/components/HeaderMenu";
import HeaderLanguage from "@/shared/components/HeaderLanguage";
import ThemeToggle from "@/shared/components/ThemeToggle";
import { useHeaderSearchStore } from "@/store/headerSearchStore";

const pageMap = [
  ["/dashboard/endpoint", { title: "Endpoint", description: "Gateway URL, tunnels, and API keys", icon: "api" }],
  ["/dashboard/providers", { title: "Providers", description: "Provider registry and account health", icon: "dns" }],
  ["/dashboard/combos", { title: "Combos", description: "Model routing strategies and fallback chains", icon: "layers" }],
  ["/dashboard/usage", { title: "Activity", description: "Requests, analytics, and request details", icon: "bar_chart" }],
  ["/dashboard/quota", { title: "Quota", description: "Capacity, resets, and account availability", icon: "data_usage" }],
  ["/dashboard/token-saver", { title: "Token Saver", description: "Compression policies for prompt and tool output", icon: "savings" }],
  ["/dashboard/cli-tools", { title: "CLI Tools", description: "Configure developer tools to use ExtremeRouter", icon: "terminal" }],
  ["/dashboard/proxy-pools", { title: "Proxy Pools", description: "Outbound proxy routing and health checks", icon: "lan" }],
  ["/dashboard/skills", { title: "Skills", description: "Reusable agent skills and install links", icon: "extension" }],
  ["/dashboard/profile", { title: "Settings", description: "Security, routing, network, and account settings", icon: "settings" }],
  ["/dashboard/translator", { title: "Translator", description: "Inspect format conversion between clients and providers", icon: "translate" }],
  ["/dashboard/console-log", { title: "Console", description: "Live server logs", icon: "monitor" }],
  ["/dashboard/mitm", { title: "MITM Proxy", description: "Intercept selected IDE traffic through the gateway", icon: "security" }],
  ["/dashboard/media-providers", { title: "Media Providers", description: "Image, audio, embedding, and web providers", icon: "perm_media" }],
];

function getPageInfo(pathname) {
  if (!pathname || pathname === "/dashboard") return pageMap[0][1];
  const hit = pageMap.find(([prefix]) => pathname.startsWith(prefix));
  if (hit) return hit[1];
  return { title: "ExtremeRouter", description: "Gateway Console", icon: "hub" };
}

export default function Header({ onMenuClick, showMenuButton = true }) {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("");
  const [loginMethod, setLoginMethod] = useState("");
  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);

  useEffect(() => {
    let cancelled = false;
    async function loadAuthStatus() {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setDisplayName(data?.displayName || data?.oidcName || data?.oidcEmail || "");
          setLoginMethod(data?.loginMethod || "");
        }
      } catch {
        if (!cancelled) {
          setDisplayName("");
          setLoginMethod("");
        }
      }
    }
    loadAuthStatus();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) window.location.assign("/login");
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  return (
    <header className="shrink-0 border-b border-border-subtle bg-bg/70 px-4 py-3 backdrop-blur-xl lg:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {showMenuButton && (
            <button onClick={onMenuClick} className="rounded p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main lg:hidden" aria-label="Open sidebar">
              <span className="material-symbols-outlined text-[20px]">menu</span>
            </button>
          )}
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-brand bg-primary/10 text-primary ring-1 ring-primary/15 sm:flex">
            <span className="material-symbols-outlined text-[18px]">{pageInfo.icon}</span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight text-text-main sm:text-base">{pageInfo.title}</h1>
            <p className="hidden truncate text-xs text-text-muted md:block">{pageInfo.description}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {displayName && loginMethod === "OIDC" && (
            <div className="hidden max-w-[220px] items-center rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-text-muted sm:flex">
              <span className="truncate">{displayName}</span>
              <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">OIDC</span>
            </div>
          )}
          <HeaderSearch />
          <ThemeToggle />
          <HeaderLanguage />
          <HeaderMenu onLogout={handleLogout} />
        </div>
      </div>
    </header>
  );
}

function HeaderSearch() {
  const visible = useHeaderSearchStore((s) => s.visible);
  const query = useHeaderSearchStore((s) => s.query);
  const placeholder = useHeaderSearchStore((s) => s.placeholder);
  const setQuery = useHeaderSearchStore((s) => s.setQuery);
  if (!visible) return null;

  return (
    <div className="relative hidden w-[220px] md:block">
      <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">search</span>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-brand border border-border bg-surface-2 pl-8 pr-7 text-xs text-text-main placeholder:text-text-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {query && (
        <button type="button" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-surface-3 hover:text-text-main" aria-label="Clear search">
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      )}
    </div>
  );
}

Header.propTypes = { onMenuClick: PropTypes.func, showMenuButton: PropTypes.bool };
