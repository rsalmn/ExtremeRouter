"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button, CardSkeleton, PageHeader, Modal, EmptyState } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
} from "@/shared/constants/providers";
import { useNotificationStore } from "@/store/notificationStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { useNewBadge } from "@/shared/hooks/useNewBadge";

import ProviderTile from "./components/ProviderTile";
import ProviderKpis from "./components/ProviderKpis";
import ProviderToolbar from "./components/ProviderToolbar";
import ProviderTestResults from "./components/ProviderTestResults";
import AddCompatibleModal from "./components/AddCompatibleModal";
import {
  makeGetProviderStats,
  makeMatchSearch,
  makeSortByPriority,
  resolveStatsAuthType,
} from "./components/helpers";

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const { isNew: isNewProvider, markSeen: markProviderSeen } = useNewBadge("providers");

  // Unified filter + sort (replaces the old 6 section-collapse flags)
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("priority");

  // Modals
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] = useState(false);

  // Test
  const [testingMode, setTestingMode] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const testingRef = useRef(false); // race-condition guard

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

  const handleToggleProvider = useCallback((providerId, authType, newActive) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const matches = (c) => c.provider === providerId && authTypes.includes(c.authType);
    setConnections((prev) => {
      const toUpdate = prev.filter(matches);
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
      fetchConnections();
    } catch {
      setTestResults({ error: "Test request failed" });
      notify.error("Provider test failed");
    } finally {
      setTestingMode(null);
      testingRef.current = false;
    }
  }, [notify, fetchConnections]);

  // ── Build unified provider list (all categories merged into one flat array)
  //
  // Each entry is normalized to a common shape tagged with `category` for
  // filtering. This replaces the old 5 separate section arrays.

  const allEntries = useMemo(() => {
    const entries = [];

    // Custom (OpenAI/Anthropic compatible) from providerNodes
    for (const node of providerNodes) {
      const id = node.id;
      const name = node.name || (node.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible");
      if (!matchSearch(name, id)) continue;
      entries.push({
        id,
        name,
        color: node.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: node.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: node.apiType,
        category: "custom",
        priority: 999,
        authTypes: "apikey",
        stats: getProviderStats(id, "apikey"),
        isNew: isNewProvider(id),
        isNoAuth: false,
        comingSoon: false,
      });
    }

    // OAuth providers
    for (const [key, info] of Object.entries(OAUTH_PROVIDERS)) {
      if (info.hidden) continue;
      if (!matchSearch(info.name, info.id, info.alias)) continue;
      const at = resolveStatsAuthType(info, "oauth");
      entries.push({
        id: key,
        name: info.name,
        color: info.color,
        textIcon: info.textIcon,
        category: "oauth",
        priority: info.priority ?? 100,
        authTypes: at,
        stats: getProviderStats(key, at),
        isNew: isNewProvider(key),
        isNoAuth: false,
        comingSoon: !!info.comingSoon,
      });
    }

    // Free providers (no-auth + free-tier)
    for (const [key, info] of Object.entries(FREE_PROVIDERS)) {
      if (info.hidden) continue;
      if (!matchSearch(info.name, info.id, info.alias)) continue;
      const freeAuthTypes = key === "kiro" ? ["oauth", "apikey", "api_key"] : "oauth";
      entries.push({
        id: key,
        name: info.name,
        color: info.color,
        textIcon: info.textIcon,
        category: "free",
        priority: info.priority ?? 200,
        authTypes: freeAuthTypes,
        stats: getProviderStats(key, freeAuthTypes),
        isNew: isNewProvider(key),
        isNoAuth: !!info.noAuth,
        comingSoon: !!info.comingSoon,
      });
    }

    for (const [key, info] of Object.entries(FREE_TIER_PROVIDERS)) {
      if (info.hidden) continue;
      if (!matchSearch(info.name, info.id, info.alias)) continue;
      entries.push({
        id: key,
        name: info.name,
        color: info.color,
        textIcon: info.textIcon,
        category: "free",
        priority: info.priority ?? 210,
        authTypes: "apikey",
        stats: getProviderStats(key, "apikey"),
        isNew: isNewProvider(key),
        isNoAuth: !!info.noAuth,
        comingSoon: !!info.comingSoon,
      });
    }

    // API Key providers (LLM only)
    for (const [key, info] of Object.entries(APIKEY_PROVIDERS)) {
      if (info.hidden) continue;
      if (!(info.serviceKinds ?? ["llm"]).includes("llm")) continue;
      if (!matchSearch(info.name, info.id, info.alias)) continue;
      entries.push({
        id: key,
        name: info.name,
        color: info.color,
        textIcon: info.textIcon,
        category: "apikey",
        priority: info.priority ?? 300,
        authTypes: "apikey",
        stats: getProviderStats(key, "apikey"),
        isNew: isNewProvider(key),
        isNoAuth: !!info.noAuth,
        comingSoon: !!info.comingSoon,
      });
    }

    // Cookie providers
    for (const [key, info] of Object.entries(WEB_COOKIE_PROVIDERS)) {
      if (info.hidden) continue;
      if (!matchSearch(info.name, info.id, info.alias)) continue;
      entries.push({
        id: key,
        name: info.name,
        color: info.color,
        textIcon: info.textIcon,
        category: "cookie",
        priority: info.priority ?? 400,
        authTypes: "cookie",
        stats: getProviderStats(key, "cookie"),
        isNew: isNewProvider(key),
        isNoAuth: !!info.noAuth,
        comingSoon: !!info.comingSoon,
      });
    }

    return entries;
  }, [providerNodes, connections, searchQuery, isNewProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPI counts ─────────────────────────────────────────────────────────────

  const kpiCounts = useMemo(() => {
    let connected = 0;
    let errors = 0;
    let ready = 0;
    for (const e of allEntries) {
      if (e.stats.connected > 0) connected++;
      if (e.stats.error > 0) errors++;
      if (e.isNoAuth && e.stats.connected === 0 && e.stats.error === 0) ready++;
      if (!e.isNoAuth && e.stats.connected === 0 && e.stats.error === 0 && e.stats.total === 0) ready++;
    }
    return {
      total: allEntries.length,
      connected,
      errors,
      ready,
    };
  }, [allEntries]);

  // ── Filter counts (for chip badges) ─────────────────────────────────────────

  const filterCounts = useMemo(() => {
    const c = { all: allEntries.length, connected: 0, errors: 0, oauth: 0, apikey: 0, free: 0, cookie: 0, custom: 0 };
    for (const e of allEntries) {
      if (e.stats.connected > 0) c.connected++;
      if (e.stats.error > 0) c.errors++;
      c[e.category]++;
    }
    return c;
  }, [allEntries]);

  // ── Apply filter + sort ─────────────────────────────────────────────────────

  const visibleEntries = useMemo(() => {
    let list = allEntries;

    // Category / status filter
    if (filter !== "all") {
      if (filter === "connected") {
        list = list.filter((e) => e.stats.connected > 0);
      } else if (filter === "errors") {
        list = list.filter((e) => e.stats.error > 0);
      } else {
        list = list.filter((e) => e.category === filter);
      }
    }

    // Sort
    const sorted = [...list];
    if (sortBy === "name") {
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (sortBy === "connections") {
      // Connected first (desc), then by total (desc), then alphabetical
      sorted.sort((a, b) => {
        const ac = a.stats.connected > 0 ? 0 : 1;
        const bc = b.stats.connected > 0 ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return (b.stats.total || 0) - (a.stats.total || 0) || (a.name || "").localeCompare(b.name || "");
      });
    } else {
      // priority (default): connected-first, then by registry priority, then alpha
      sorted.sort((a, b) => {
        const ac = a.stats.total > 0 ? 0 : 1;
        const bc = b.stats.total > 0 ? 0 : 1;
        if (ac !== bc) return ac - bc;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return (a.name || "").localeCompare(b.name || "");
      });
    }

    return sorted;
  }, [allEntries, filter, sortBy]);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const showSearchEmpty = isSearching && visibleEntries.length === 0;
  const showNoProviders = !isSearching && allEntries.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-5">
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

      {/* KPI row */}
      <ProviderKpis
        counts={kpiCounts}
        activeFilter={filter}
        onFilter={setFilter}
      />

      {/* Global Test All — inline button, shown when there are connections */}
      {kpiCounts.connected > 0 && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            icon={testingMode === "all" ? "progress_activity" : "bolt"}
            onClick={() => handleBatchTest("all")}
            disabled={!!testingMode}
            className={testingMode === "all" ? "animate-pulse" : ""}
          >
            {testingMode === "all" ? "Testing All..." : "Test All Providers"}
          </Button>
        </div>
      )}

      {/* Filter + sort toolbar */}
      {!showNoProviders && (
        <ProviderToolbar
          filter={filter}
          onFilter={setFilter}
          sortBy={sortBy}
          onSort={setSortBy}
          counts={filterCounts}
          total={allEntries.length}
          isSearching={isSearching}
        />
      )}

      {/* Empty states */}
      {showSearchEmpty && (
        <EmptyState
          icon="search_off"
          title={`No providers match "${searchQuery}"`}
          description="Try a different search term or clear the filters."
        />
      )}

      {showNoProviders && (
        <EmptyState
          icon="cloud_off"
          title="No providers yet"
          description="Add your first provider to start routing requests."
        />
      )}

      {/* Provider grid */}
      {visibleEntries.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleEntries.map((entry) => (
            <ProviderTile
              key={entry.id}
              providerId={entry.id}
              provider={entry}
              stats={entry.stats}
              isNoAuth={entry.isNoAuth}
              comingSoon={entry.comingSoon}
              isNew={entry.isNew}
              testing={testingMode === entry.id}
              onToggle={(active) => handleToggleProvider(entry.id, entry.authTypes, active)}
              onTest={(pid) => handleBatchTest("provider", pid)}
            />
          ))}
        </div>
      )}

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
