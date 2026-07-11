"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { Card, Button, Badge, CardSkeleton, PageHeader, Modal, EmptyState } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { useNotificationStore } from "@/store/notificationStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { useNewBadge } from "@/shared/hooks/useNewBadge";

import ProviderCardV2 from "./components/ProviderCardV2";
import ProviderSection from "./components/ProviderSection";
import ProviderTestResults from "./components/ProviderTestResults";
import ProviderSummary from "./components/ProviderSummary";
import AddCompatibleModal from "./components/AddCompatibleModal";
import {
  makeGetProviderStats,
  makeMatchSearch,
  makeSortByPriority,
  resolveStatsAuthType,
  getConnectionErrorTag,
} from "./components/helpers";

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAllApikey, setShowAllApikey] = useState(false);
  const { isNew: isNewProvider, markSeen: markProviderSeen } = useNewBadge("providers");

  // Collapsible sections
  const [showCustom, setShowCustom] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [showOauth, setShowOauth] = useState(true);
  const [showFree, setShowFree] = useState(true);
  const [showApikey, setShowApikey] = useState(true);

  // Modals
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] = useState(false);

  // Test
  const [testingMode, setTestingMode] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const testingRef = useRef(false); // fix: race condition guard

  const notify = useNotificationStore();
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/providers");
      const data = await res.json();
      if (res.ok) setConnections(data.connections || []);
    } catch {}
  }, []);

  useEffect(() => {
    registerSearch("Search providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  useEffect(() => {
    (async () => {
      try {
        const [connRes, nodesRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/provider-nodes"),
        ]);
        const connData = await connRes.json();
        const nodesData = await nodesRes.json();
        if (connRes.ok) setConnections(connData.connections || []);
        if (nodesRes.ok) setProviderNodes(nodesData.nodes || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  // ── Helpers (recreated per render to capture latest connections) ────────────

  const isSearching = !!searchQuery.trim();
  const matchSearch = makeMatchSearch(searchQuery);
  const getProviderStats = makeGetProviderStats(connections);
  const sortByPriority = makeSortByPriority(getProviderStats);

  // ── Toggle provider ────────────────────────────────────────────────────────
  // fix: compute matches inside setConnections updater to avoid snapshot drift

  const handleToggleProvider = useCallback((providerId, authType, newActive) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const matches = (c) => c.provider === providerId && authTypes.includes(c.authType);
    setConnections((prev) => {
      const toUpdate = prev.filter(matches);
      // Fire PUT requests for the matched connections
      Promise.allSettled(
        toUpdate.map((c) =>
          fetch(`/api/providers/${c.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: newActive }),
          }),
        ),
      );
      return prev.map((c) => (matches(c) ? { ...c, isActive: newActive } : c));
    });
  }, []);

  // ── Batch test ─────────────────────────────────────────────────────────────
  // fix: ref guard for race condition, refetch connections after test

  const handleBatchTest = useCallback(async (mode, providerId = null) => {
    if (testingRef.current) return;
    testingRef.current = true;
    setTestingMode(mode === "provider" ? providerId : mode);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, providerId }),
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { passed, failed, total } = data.summary;
        if (failed === 0) notify.success(`All ${total} tests passed`);
        else notify.warning(`${passed}/${total} passed, ${failed} failed`);
      }
      // fix: refetch so card badges reflect fresh test status
      fetchConnections();
    } catch {
      setTestResults({ error: "Test request failed" });
      notify.error("Provider test failed");
    } finally {
      setTestingMode(null);
      testingRef.current = false;
    }
  }, [notify, fetchConnections]);

  // ── Provider entries (filtered + sorted) ───────────────────────────────────

  const compatibleProviders = providerNodes
    .filter((n) => n.type === "openai-compatible")
    .map((n) => ({ id: n.id, name: n.name || "OpenAI Compatible", color: "#10A37F", textIcon: "OC", apiType: n.apiType }))
    .filter((p) => matchSearch(p.name, p.id));

  const anthropicCompatibleProviders = providerNodes
    .filter((n) => n.type === "anthropic-compatible")
    .map((n) => ({ id: n.id, name: n.name || "Anthropic Compatible", color: "#D97757", textIcon: "AC" }))
    .filter((p) => matchSearch(p.name, p.id));

  const oauthEntries = sortByPriority(
    Object.entries(OAUTH_PROVIDERS).filter(([, i]) => !i.hidden && matchSearch(i.name, i.id, i.alias)),
    "oauth",
  );
  const freeEntries = Object.entries(FREE_PROVIDERS)
    .filter(([, i]) => !i.hidden && matchSearch(i.name, i.id, i.alias))
    .sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));
  const freeTierEntries = sortByPriority(
    Object.entries(FREE_TIER_PROVIDERS).filter(([, i]) => !i.hidden && matchSearch(i.name, i.id, i.alias)),
    "apikey",
  );
  const apikeyEntries = Object.entries(APIKEY_PROVIDERS)
    .filter(([, i]) => !i.hidden && (i.serviceKinds ?? ["llm"]).includes("llm") && matchSearch(i.name, i.id, i.alias))
    .sort(([ka, a], [kb, b]) => {
      const ca = getProviderStats(ka, "apikey").total > 0 ? 0 : 1;
      const cb = getProviderStats(kb, "apikey").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  const cookieEntries = Object.entries(WEB_COOKIE_PROVIDERS)
    .filter(([, i]) => !i.hidden && matchSearch(i.name, i.id, i.alias))
    .sort(([ka, a], [kb, b]) => {
      const ca = getProviderStats(ka, "cookie").total > 0 ? 0 : 1;
      const cb = getProviderStats(kb, "cookie").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  const isApikeySearching = isSearching;
  const visibleApikeyEntries = isApikeySearching || showAllApikey ? apikeyEntries : apikeyEntries.slice(0, 20);

  // ── Summary stats ──────────────────────────────────────────────────────────

  const totalProviders = oauthEntries.length + freeEntries.length + freeTierEntries.length + apikeyEntries.length + cookieEntries.length;
  const allProviderIds = [...oauthEntries, ...freeEntries, ...freeTierEntries, ...apikeyEntries, ...cookieEntries].map(([k]) => k);
  const connectedCount = allProviderIds.filter((id) => {
    const info = OAUTH_PROVIDERS[id] || APIKEY_PROVIDERS[id] || FREE_PROVIDERS[id] || FREE_TIER_PROVIDERS[id] || WEB_COOKIE_PROVIDERS[id];
    const at = resolveStatsAuthType(info, info?.authType || "apikey");
    return getProviderStats(id, at).connected > 0;
  }).length;
  const errorCount = allProviderIds.filter((id) => {
    const info = OAUTH_PROVIDERS[id] || APIKEY_PROVIDERS[id] || FREE_PROVIDERS[id] || FREE_TIER_PROVIDERS[id] || WEB_COOKIE_PROVIDERS[id];
    const at = resolveStatsAuthType(info, info?.authType || "apikey");
    return getProviderStats(id, at).error > 0;
  }).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const hasAnyResult =
    compatibleProviders.length > 0 || anthropicCompatibleProviders.length > 0 ||
    oauthEntries.length > 0 || freeEntries.length > 0 || freeTierEntries.length > 0 ||
    apikeyEntries.length > 0 || cookieEntries.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Providers"
        description="Connect, configure, and manage AI providers"
        icon="dns"
        actions={
          <>
            <Button size="sm" variant="outline" icon="add" onClick={() => setShowAddAnthropicCompatibleModal(true)}>Anthropic</Button>
            <Button size="sm" icon="add" onClick={() => setShowAddCompatibleModal(true)}>OpenAI</Button>
          </>
        }
      />

      {/* Summary band */}
      <ProviderSummary
        totalProviders={totalProviders}
        connectedProviders={connectedCount}
        errorCount={errorCount}
        onTestAll={() => handleBatchTest("all")}
        testingMode={testingMode}
      />

      {/* Search no-results */}
      {isSearching && !hasAnyResult && (
        <EmptyState
          icon="search_off"
          title={`No providers match "${searchQuery}"`}
          description="Try a different search term, or browse the sections below."
        />
      )}

      {/* Custom Providers */}
      <ProviderSection
        title="Custom Providers (OpenAI/Anthropic Compatible)"
        icon="extension"
        count={compatibleProviders.length + anthropicCompatibleProviders.length}
        isExpanded={showCustom}
        onToggle={() => setShowCustom((v) => !v)}
        isSearching={isSearching}
        hasContent={compatibleProviders.length > 0 || anthropicCompatibleProviders.length > 0}
        emptyTitle="No custom providers"
        emptyDescription="Add OpenAI or Anthropic compatible endpoints to get started."
      >
        <Button size="sm" icon="add" onClick={() => setShowAddAnthropicCompatibleModal(true)}>Add Anthropic</Button>
        <Button size="sm" variant="secondary" icon="add" onClick={() => setShowAddCompatibleModal(true)}>Add OpenAI</Button>
        {[...compatibleProviders, ...anthropicCompatibleProviders].map((info) => (
          <ProviderCardV2
            key={info.id}
            providerId={info.id}
            provider={info}
            stats={getProviderStats(info.id, "apikey")}
            isNew={isNewProvider(info.id)}
            onToggle={(active) => handleToggleProvider(info.id, "apikey", active)}
          />
        ))}
      </ProviderSection>

      {/* Cookies Provider */}
      <ProviderSection
        title="Cookies Provider"
        icon="cookie"
        count={cookieEntries.length}
        isExpanded={showCookies}
        onToggle={() => setShowCookies((v) => !v)}
        isSearching={isSearching}
        onTestAll={() => handleBatchTest("cookie")}
        testingMode={testingMode}
        testModeKey="cookie"
        hasContent={cookieEntries.length > 0}
      >
        {cookieEntries.map(([key, info]) => (
          <ProviderCardV2
            key={key}
            providerId={key}
            provider={info}
            stats={getProviderStats(key, "cookie")}
            isNoAuth={!!info.noAuth}
            isNew={isNewProvider(key)}
            onToggle={(active) => handleToggleProvider(key, "cookie", active)}
          />
        ))}
      </ProviderSection>

      {/* OAuth Providers */}
      <ProviderSection
        title="OAuth Providers"
        icon="lock"
        count={oauthEntries.length}
        isExpanded={showOauth}
        onToggle={() => setShowOauth((v) => !v)}
        isSearching={isSearching}
        onTestAll={() => handleBatchTest("oauth")}
        testingMode={testingMode}
        testModeKey="oauth"
        hasContent={oauthEntries.length > 0}
      >
        {oauthEntries.map(([key, info]) => {
          const at = resolveStatsAuthType(info, "oauth");
          return (
            <ProviderCardV2
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, at)}
              comingSoon={!!info.comingSoon}
              isNew={isNewProvider(key)}
              onToggle={(active) => handleToggleProvider(key, at, active)}
            />
          );
        })}
      </ProviderSection>

      {/* Free Tier Providers */}
      <ProviderSection
        title="Free Tier Providers"
        icon="redeem"
        count={freeEntries.length + freeTierEntries.length}
        isExpanded={showFree}
        onToggle={() => setShowFree((v) => !v)}
        isSearching={isSearching}
        onTestAll={() => handleBatchTest("free")}
        testingMode={testingMode}
        testModeKey="free"
        hasContent={freeEntries.length > 0 || freeTierEntries.length > 0}
      >
        {freeEntries.map(([key, info]) => {
          const freeAuthTypes = key === "kiro" ? ["oauth", "apikey", "api_key"] : "oauth";
          return (
            <ProviderCardV2
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, freeAuthTypes)}
              isNoAuth={!!info.noAuth}
              isNew={isNewProvider(key)}
              onToggle={(active) => handleToggleProvider(key, freeAuthTypes, active)}
            />
          );
        })}
        {freeTierEntries.map(([key, info]) => (
          <ProviderCardV2
            key={key}
            providerId={key}
            provider={info}
            stats={getProviderStats(key, "apikey")}
            isNew={isNewProvider(key)}
            onToggle={(active) => handleToggleProvider(key, "apikey", active)}
          />
        ))}
      </ProviderSection>

      {/* API Key Providers */}
      <ProviderSection
        title="API Key Providers"
        icon="key"
        count={apikeyEntries.length}
        isExpanded={showApikey}
        onToggle={() => setShowApikey((v) => !v)}
        isSearching={isSearching}
        onTestAll={() => handleBatchTest("apikey")}
        testingMode={testingMode}
        testModeKey="apikey"
        hasContent={apikeyEntries.length > 0}
      >
        {visibleApikeyEntries.map(([key, info]) => (
          <ProviderCardV2
            key={key}
            providerId={key}
            provider={info}
            stats={getProviderStats(key, "apikey")}
            isNew={isNewProvider(key)}
            onToggle={(active) => handleToggleProvider(key, "apikey", active)}
          />
        ))}
        {!isApikeySearching && !showAllApikey && apikeyEntries.length > 20 && (
          <button
            onClick={() => setShowAllApikey(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-brand border border-dashed border-primary/40 px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5"
          >
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
            Show all {apikeyEntries.length} providers
          </button>
        )}
      </ProviderSection>

      {/* Test Results Modal */}
      {testResults && (
        <Modal isOpen={!!testResults} onClose={() => setTestResults(null)} title="Provider Test Results" size="md">
          <ProviderTestResults results={testResults} />
        </Modal>
      )}

      {/* Add Compatible Modals */}
      <AddCompatibleModal
        variant="openai"
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => { setProviderNodes((prev) => [...prev, node]); setShowAddCompatibleModal(false); }}
      />
      <AddCompatibleModal
        variant="anthropic"
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => { setProviderNodes((prev) => [...prev, node]); setShowAddAnthropicCompatibleModal(false); }}
      />
    </div>
  );
}
