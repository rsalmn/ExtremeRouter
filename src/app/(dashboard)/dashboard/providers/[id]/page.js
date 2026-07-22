"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Button, Modal, CardSkeleton, OAuthModal, KiroOAuthWrapper, CursorAuthModal, IFlowCookieModal, GitLabAuthModal, EditConnectionModal, ConfirmModal } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS, THINKING_CONFIG } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { translate } from "@/i18n/runtime";
import { fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher";
import { getProviderIconPath } from "@/shared/utils/providerIcon";
import AddApiKeyModal from "./AddApiKeyModal";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";
import AddCustomModelModal from "./AddCustomModelModal";
import BulkImportCodexModal from "./BulkImportCodexModal";
import HealthTimeline from "./HealthTimeline";
import { useNewBadge } from "@/shared/hooks/useNewBadge";
// Extracted section components (redesign)
import ProviderDetailHeader from "./components/ProviderDetailHeader";
import CollapsibleSection from "./components/CollapsibleSection";
import ConnectionsCard from "./components/ConnectionsCard";
import ModelsCard from "./components/ModelsCard";

const ONE_BY_ONE_DELAY_MS = 1000;

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.id;
  const { getCaps } = useModelCaps();
  const { markSeen: markProviderSeen } = useNewBadge("providers");
  useEffect(() => { if (providerId) markProviderSeen(providerId); }, [providerId, markProviderSeen]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [providerNode, setProviderNode] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [addConnectionError, setAddConnectionError] = useState("");
  const [showBulkImportCodex, setShowBulkImportCodex] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [customModels, setCustomModels] = useState([]);
  const [headerImgError, setHeaderImgError] = useState(false);
  const [modelTestResults, setModelTestResults] = useState({});
  const [modelsTestError, setModelsTestError] = useState("");
  const [testingModelIds, setTestingModelIds] = useState(() => new Set());
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [testingAllModels, setTestingAllModels] = useState(false);
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState([]);
  const [bulkProxyPoolId, setBulkProxyPoolId] = useState("__none__");
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
  const [providerStrategy, setProviderStrategy] = useState(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("");
  const [thinkingMode, setThinkingMode] = useState("auto");
  const [autoPing, setAutoPing] = useState({ enabled: false, connections: {} });
  const [suggestedModels, setSuggestedModels] = useState([]);
  const [kiloFreeModels, setKiloFreeModels] = useState([]);
  const [disabledModelIds, setDisabledModelIds] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [showAgRiskModal, setShowAgRiskModal] = useState(false);
  const [oneByOneRunning, setOneByOneRunning] = useState(false);
  const [oneByOneStopping, setOneByOneStopping] = useState(false);
  const [oneByOneCurrentConnectionId, setOneByOneCurrentConnectionId] = useState(null);
  const [oneByOneResults, setOneByOneResults] = useState({});
  const [oneByOneSummary, setOneByOneSummary] = useState(null);
  const stopOneByOneRef = useRef(false);
  const [importingQoderModels, setImportingQoderModels] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

  const openOAuthConnection = () => {
    setShowOAuthModal(true);
  };

  const triggerOAuthConnection = () => {
    if (providerId === "antigravity" && typeof window !== "undefined") {
      const confirmed = window.localStorage.getItem(AG_RISK_STORAGE_KEY) === "true";
      if (!confirmed) {
        setShowAgRiskModal(true);
        return;
      }
    }
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerApiKeyConnection = () => {
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerAddConnection = () => {
    if (isOAuth) {
      triggerOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const handleAgRiskConfirm = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    }
    setShowAgRiskModal(false);
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const providerInfo = providerNode
    ? {
        id: providerNode.id,
        name: providerNode.name || (providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
        color: providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: providerNode.apiType,
        baseUrl: providerNode.baseUrl,
        type: providerNode.type,
      }
    : (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId] || WEB_COOKIE_PROVIDERS[providerId]);
  const authModes = providerInfo?.authModes || [];
  // isOAuth is gated by `hasOAuth !== false`: providers like trae/cody/windsurf are
  // registered under category "oauth" for grouping but use import-token / API-key
  // auth (hasOAuth:false). Without this guard the page would fire the real OAuth
  // flow and hit "Unknown provider" in the OAuth route.
  const isOAuth = (!!OAUTH_PROVIDERS[providerId] || !!FREE_PROVIDERS[providerId] || authModes.includes("oauth")) && providerInfo?.hasOAuth !== false;
  const supportsApiKeyAuth = !!APIKEY_PROVIDERS[providerId] || authModes.includes("apikey") || providerInfo?.hasOAuth === false;
  const isFreeNoAuth = !!FREE_PROVIDERS[providerId]?.noAuth;
  const models = getModelsByProviderId(providerId);
  const providerAlias = getProviderAlias(providerId);
  
  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;
  const hasDualAuthModes = !isCompatible && isOAuth && supportsApiKeyAuth;
  const oauthConnectionLabel = providerId === "xai" ? "Grok Build OAuth" : "OAuth";
  const apiKeyConnectionLabel = providerId === "xai" ? "xAI API Key" : "API Key";
  const thinkingConfig = AI_PROVIDERS[providerId]?.thinkingConfig || THINKING_CONFIG.extended;
  
  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  const providerDisplayAlias = isCompatible
    ? (providerNode?.prefix || providerId)
    : providerAlias;

  const fetchDisabledModels = useCallback(async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDisabledModelIds(data.ids || []);
    } catch (error) {
      console.log("Error fetching disabled models:", error);
    }
  }, [providerStorageAlias]);

  const handleDisableModel = async (modelId) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [modelId] }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error disabling model:", error);
    }
  };

  const handleEnableModel = async (modelId) => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}&id=${encodeURIComponent(modelId)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error enabling model:", error);
    }
  };

  const handleDisableAll = async (ids) => {
    if (!ids.length) return;
    setConfirmState({
      title: "Disable All Models",
      message: `Disable all ${ids.length} model(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch("/api/models/disabled", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
          });
          if (res.ok) await fetchDisabledModels();
        } catch (error) {
          console.log("Error disabling all models:", error);
        }
      }
    });
  };

  const handleEnableAll = async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error enabling all models:", error);
    }
  };

  // Define callbacks BEFORE the useEffect that uses them
  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.log("Error fetching aliases:", error);
    }
  }, []);

  const fetchCustomModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/custom", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setCustomModels(data.models || []);
      }
    } catch (error) {
      console.log("Error fetching custom models:", error);
    }
  }, []);

  // Fetch free models from Kilo API for kilocode provider
  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetch("/api/providers/kilo/free-models")
      .then((res) => res.json())
      .then((data) => { if (data.models?.length) setKiloFreeModels(data.models); })
      .catch(() => {});
  }, [providerId]);

  const fetchConnections = useCallback(async () => {
    try {
      const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connectionsData = await connectionsRes.json();
      const nodesData = await nodesRes.json();
      const proxyPoolsData = await proxyPoolsRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connectionsRes.ok) {
        const filtered = (connectionsData.connections || []).filter(c => c.provider === providerId);
        setConnections(filtered);
      }
      if (proxyPoolsRes.ok) {
        setProxyPools(proxyPoolsData.proxyPools || []);
      }
      // Load per-provider strategy override
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
      // Load per-provider thinking config
      const thinkingCfg = (settingsData.providerThinking || {})[providerId] || {};
      setThinkingMode(thinkingCfg.mode || "auto");
      const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
      const apCfg = autoPingSettingsKey ? settingsData[autoPingSettingsKey] || {} : {};
      setAutoPing({ enabled: apCfg.enabled === true, connections: apCfg.connections || {} });
      if (nodesRes.ok) {
        let node = (nodesData.nodes || []).find((entry) => entry.id === providerId) || null;

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
            if (!retryRes.ok) continue;
            const retryData = await retryRes.json();
            node = (retryData.nodes || []).find((entry) => entry.id === providerId) || null;
            if (node) break;
          }
        }

        setProviderNode(node);
      }
    } catch (error) {
      console.log("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  }, [providerId, isCompatible]);

  const handleUpdateNode = async (formData) => {
    try {
      const res = await fetch(`/api/provider-nodes/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        setProviderNode(data.node);
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    } catch (error) {
      console.log("Error updating provider node:", error);
    }
  };

  const saveProviderStrategy = async (strategy, stickyLimit) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerStrategies || {};

      // Build override: null strategy means remove override, use global
      const override = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") {
        override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (error) {
      console.log("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? (providerStickyLimit || "1") : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  const saveThinkingConfig = async (mode) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerThinking || {};
      const updated = { ...current };
      if (!mode || mode === "auto") {
        delete updated[providerId];
      } else {
        updated[providerId] = { mode };
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerThinking: updated }),
      });
    } catch (error) {
      console.log("Error saving thinking config:", error);
    }
  };

  const handleThinkingModeChange = (mode) => {
    setThinkingMode(mode);
    saveThinkingConfig(mode);
  };

  const saveAutoPing = async (next) => {
    const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
    if (!autoPingSettingsKey) return;

    setAutoPing(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [autoPingSettingsKey]: next }),
      });
    } catch (error) {
      console.log("Error saving auto-ping config:", error);
    }
  };

  const handleAutoPingConnection = (connectionId, on) => {
    saveAutoPing({ ...autoPing, connections: { ...autoPing.connections, [connectionId]: on } });
  };

  useEffect(() => {
    fetchConnections();
    fetchAliases();
    fetchCustomModels();
    fetchDisabledModels();
  }, [fetchConnections, fetchAliases, fetchCustomModels, fetchDisabledModels]);

  // Fetch suggested models from provider's public API (if configured)
  useEffect(() => {
    const fetcher = (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId])?.modelsFetcher;
    if (!fetcher) return;
    fetchSuggestedModels(fetcher).then(setSuggestedModels);
  }, [providerId]);

  const handleSetAlias = async (modelId, alias, providerAliasOverride = providerAlias) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) {
        await fetchAliases();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to set alias");
      }
    } catch (error) {
      console.log("Error setting alias:", error);
    }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.log("Error deleting alias:", error);
    }
  };

  const handleAddCustomModel = async (modelId, type = "llm", providerAliasOverride = providerStorageAlias) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerAliasOverride, id: modelId, type }),
      });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      } else {
        const data = await res.json();
        alert(data.error || "Failed to add custom model");
      }
    } catch (error) {
      console.log("Error adding custom model:", error);
    }
  };

  const handleDeleteCustomModel = async (modelId, type = "llm", providerAliasOverride = providerStorageAlias) => {
    try {
      const params = new URLSearchParams({ providerAlias: providerAliasOverride, id: modelId, type });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (error) {
      console.log("Error deleting custom model:", error);
    }
  };

  // Fetch Qoder model list and automatically add to available models
  const handleImportQoderModels = async () => {
    if (importingQoderModels) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) {
      alert(translate("Please add an active Qoder connection first"));
      return;
    }

    setImportingQoderModels(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || translate("Failed to fetch models"));
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert(translate("No models returned"));
        return;
      }

      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name;
        if (!modelId) continue;
        
        // Qoder model ID format may be "qoder/auto" or "auto", need to remove prefix
        const cleanModelId = modelId.replace(/^qoder\//, "");
        const alreadyExists = customModels.some(
          (entry) => entry.providerAlias === providerStorageAlias && entry.id === cleanModelId && (entry.kind || entry.type || "llm") === "llm"
        ) || Object.values(modelAliases).includes(`${providerStorageAlias}/${cleanModelId}`);
        if (alreadyExists) {
          continue;
        }

        await handleAddCustomModel(cleanModelId, "llm", providerStorageAlias);
        importedCount += 1;
      }
      
      if (importedCount === 0) {
        alert(translate("All models already exist, no new models added"));
      } else {
        alert(translate("Successfully added") + ` ${importedCount} ` + translate("models"));
      }
    } catch (error) {
      console.log("Error importing Qoder models:", error);
      alert(translate("Error fetching models") + ": " + error.message);
    } finally {
      setImportingQoderModels(false);
    }
  };

  const handleRunOneByOneTest = async () => {
    if (oneByOneRunning || connections.length === 0) return;

    const queuedState = Object.fromEntries(
      connections.map((connection) => [connection.id, { state: "queued", error: null }]),
    );

    stopOneByOneRef.current = false;
    setOneByOneRunning(true);
    setOneByOneStopping(false);
    setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({ total: connections.length, completed: 0, passed: 0, failed: 0, stopped: false });

    let passed = 0;
    let failed = 0;

    try {
      for (let index = 0; index < connections.length; index += 1) {
        if (stopOneByOneRef.current) {
          setOneByOneSummary({
            total: connections.length,
            completed: index,
            passed,
            failed,
            stopped: true,
          });
          break;
        }

        const connection = connections[index];
        setOneByOneCurrentConnectionId(connection.id);
        setOneByOneResults((prev) => ({
          ...prev,
          [connection.id]: { state: "testing", error: null },
        }));

        try {
          const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
          const data = await res.json();
          const valid = !!data.valid;

          if (valid) {
            passed += 1;
          } else {
            failed += 1;
          }

          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: valid ? "success" : "failed",
              error: valid ? null : (data.error || null),
            },
          }));
        } catch (error) {
          failed += 1;
          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: "failed",
              error: error.message || "Test failed",
            },
          }));
        }

        setOneByOneSummary({
          total: connections.length,
          completed: index + 1,
          passed,
          failed,
          stopped: false,
        });

        if (index < connections.length - 1) {
          await sleep(ONE_BY_ONE_DELAY_MS);
        }
      }
    } finally {
      setOneByOneCurrentConnectionId(null);
      setOneByOneRunning(false);
      setOneByOneStopping(false);
      stopOneByOneRef.current = false;
    }
  };

  const handleStopOneByOneTest = () => {
    if (!oneByOneRunning) return;
    stopOneByOneRef.current = true;
    setOneByOneStopping(true);
  };

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Connection",
      message: "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) {
            setConnections(prev => prev.filter(c => c.id !== id));
          }
        } catch (error) {
          console.log("Error deleting connection:", error);
        }
      }
    });
  };

  const handleBulkDelete = () => {
    const count = selectedConnectionIds.length;
    if (count === 0) return;
    setConfirmState({
      title: `Delete ${count} Connection${count > 1 ? "s" : ""}`,
      message: `Delete ${count} connection${count > 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        let failed = 0;
        const idsToDelete = [...selectedConnectionIds];
        for (const id of idsToDelete) {
          try {
            const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
            if (!res.ok) failed += 1;
          } catch (error) {
            console.log("Error deleting connection:", error);
            failed += 1;
          }
        }
        setConnections(prev => prev.filter(c => !idsToDelete.includes(c.id)));
        setSelectedConnectionIds([]);
        if (failed > 0) alert(`Deleted ${idsToDelete.length - failed} connection(s), ${failed} failed.`);
      }
    });
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
  };

  const handleIFlowCookieSuccess = () => {
    fetchConnections();
    setShowIFlowCookieModal(false);
  };

  const handleSaveApiKey = async (formData) => {
    setAddConnectionError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
        return;
      }

      setAddConnectionError(data?.error || "Failed to save connection");
    } catch (error) {
      console.log("Error saving connection:", error);
      setAddConnectionError("Failed to save connection");
    }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.log("Error updating connection:", error);
    }
  };

  const handleUpdateConnectionStatus = async (id, isActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections(prev => prev.map(c => c.id === id ? { ...c, isActive } : c));
      }
    } catch (error) {
      console.log("Error updating connection status:", error);
    }
  };

  const handleSwapPriority = async (index1, index2) => {
    // Optimistic update state
    const newConnections = [...connections];
    [newConnections[index1], newConnections[index2]] = [newConnections[index2], newConnections[index1]];
    setConnections(newConnections);

    try {
      await Promise.all([
        fetch(`/api/providers/${newConnections[index1].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index1 }),
        }),
        fetch(`/api/providers/${newConnections[index2].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index2 }),
        }),
      ]);
    } catch (error) {
      console.log("Error swapping priority:", error);
      await fetchConnections();
    }
  };

  const selectedConnections = connections.filter((conn) => selectedConnectionIds.includes(conn.id));
  const allSelected = connections.length > 0 && selectedConnectionIds.length === connections.length;

  const toggleSelectConnection = (connectionId) => {
    setSelectedConnectionIds((prev) => (
      prev.includes(connectionId)
        ? prev.filter((id) => id !== connectionId)
        : [...prev, connectionId]
    ));
  };

  const toggleSelectAllConnections = () => {
    if (allSelected) {
      setSelectedConnectionIds([]);
      return;
    }
    setSelectedConnectionIds(connections.map((conn) => conn.id));
  };

  const clearSelection = () => {
    setSelectedConnectionIds([]);
    setBulkProxyPoolId("__none__");
  };

  useEffect(() => {
    setSelectedConnectionIds((prev) => prev.filter((id) => connections.some((conn) => conn.id === id)));
  }, [connections]);

  const selectedProxySummary = (() => {
    if (selectedConnections.length === 0) return "";
    const poolIds = new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"));
    if (poolIds.size === 1) {
      const onlyId = [...poolIds][0];
      if (onlyId === "__none__") return "All selected currently unbound";
      const pool = proxyPools.find((p) => p.id === onlyId);
      return `All selected currently bound to ${pool?.name || onlyId}`;
    }
    return "Selected connections have mixed proxy bindings";
  })();

  const openBulkProxyModal = () => {
    if (selectedConnections.length === 0) return;
    const uniquePoolIds = [...new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"))];
    setBulkProxyPoolId(uniquePoolIds.length === 1 ? uniquePoolIds[0] : "__none__");
    setShowBulkProxyModal(true);
  };

  const closeBulkProxyModal = () => {
    if (bulkUpdatingProxy) return;
    setShowBulkProxyModal(false);
  };

  const applyProxyAssignments = async (assignments) => {
    setBulkUpdatingProxy(true);
    try {
      let failed = 0;
      for (const { connectionId, proxyPoolId } of assignments) {
        try {
          const res = await fetch(`/api/providers/${connectionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proxyPoolId }),
          });
          if (!res.ok) failed += 1;
        } catch (e) {
          console.log("Error applying proxy for", connectionId, e);
          failed += 1;
        }
      }
      if (failed > 0) alert(`Updated with ${failed} failed request(s).`);
      await fetchConnections();
      setShowBulkProxyModal(false);
    } finally {
      setBulkUpdatingProxy(false);
    }
  };

  const handleApplySinglePool = (proxyPoolId) => {
    const targets = connections.map((c) => ({ connectionId: c.id, proxyPoolId }));
    return applyProxyAssignments(targets);
  };

  const handleApplyOneToOne = () => {
    const activePools = proxyPools.filter((p) => p.isActive === true);
    if (activePools.length === 0) {
      alert("No active proxy pools available.");
      return;
    }
    const targets = connections.map((c, i) => ({
      connectionId: c.id,
      proxyPoolId: activePools[i % activePools.length].id,
    }));
    return applyProxyAssignments(targets);
  };


  // NOTE: connectionsList, activePools, and bulkActionModal were extracted
  // into ConnectionsCard.js during the page redesign. The handlers above
  // (applyProxyAssignments, handleApplySinglePool, handleApplyOneToOne, etc.)
  // remain here and are passed as props to ConnectionsCard.

  const activePools = proxyPools.filter((p) => p.isActive === true);

  const handleTestModel = async (modelId) => {
    if (testingModelIds.has(modelId)) return;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setModelsTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError("Network error");
    } finally {
      setTestingModelIds((prev) => { const n = new Set(prev); n.delete(modelId); return n; });
    }
  };

  // Test every visible model concurrently. Each result populates modelTestResults independently.
  const handleTestAllModels = async (modelIds) => {
    if (testingAllModels || modelIds.length === 0) return;
    setTestingAllModels(true);
    setModelsTestError("");
    await Promise.all(modelIds.map((id) => handleTestModel(id)));
    setTestingAllModels(false);
  };

  // NOTE: connectionsList, bulkActionModal, and renderModelsSection were
  // extracted into ConnectionsCard.js and ModelsCard.js during the redesign.
  // All handlers above remain here and are passed as props.

  // ── Early returns ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!providerInfo) {
    return (
      <div className="py-20 text-center">
        <p className="text-text-muted">Provider not found</p>
        <Link href="/dashboard/providers" className="mt-4 inline-block text-primary">
          Back to Providers
        </Link>
      </div>
    );
  }

  const headerIconPath = getProviderIconPath(providerInfo.id, providerInfo.apiType);

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* Branded header */}
      <ProviderDetailHeader
        providerInfo={providerInfo}
        providerId={providerId}
        connections={connections}
        modelCount={models.length}
        headerIconPath={headerIconPath}
        headerImgError={headerImgError}
        setHeaderImgError={setHeaderImgError}
      />

      {/* Compatible-node details (OpenAI/Anthropic compatible only) */}
      {isCompatible && providerNode && (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{isAnthropicCompatible ? "Anthropic Compatible" : "OpenAI Compatible"}</h2>
              <p className="break-all text-sm text-text-muted">
                {isAnthropicCompatible ? "Messages API" : (providerNode.apiType === "responses" ? "Responses API" : "Chat Completions")} · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
                {isAnthropicCompatible ? "messages" : (providerNode.apiType === "responses" ? "responses" : "chat/completions")}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
              <Button
                size="sm"
                icon="add"
                onClick={() => { setAddConnectionError(""); setShowAddApiKeyModal(true); }}
                className="w-full sm:w-auto"
              >
                Add API Key
              </Button>
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setShowEditNodeModal(true)} className="w-full sm:w-auto">
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="delete"
                onClick={() => {
                  setConfirmState({
                    title: "Delete Compatible Node",
                    message: `Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`,
                    onConfirm: async () => {
                      setConfirmState(null);
                      try {
                        const res = await fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
                        if (res.ok) router.push("/dashboard/providers");
                      } catch (error) {
                        console.log("Error deleting provider node:", error);
                      }
                    },
                  });
                }}
                className="w-full sm:w-auto"
              >
                Delete
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Collapsible sections ── */}

      {/* Connections */}
      <CollapsibleSection
        title="Connections"
        icon="cable"
        count={connections.length}
        defaultExpanded
      >
        <ConnectionsCard
          // identity
          providerId={providerId}
          isOAuth={isOAuth}
          isCompatible={isCompatible}
          isFreeNoAuth={isFreeNoAuth}
          hasDualAuthModes={hasDualAuthModes}
          oauthConnectionLabel={oauthConnectionLabel}
          apiKeyConnectionLabel={apiKeyConnectionLabel}
          thinkingConfig={thinkingConfig}
          AUTO_PING_SETTINGS_KEYS={AUTO_PING_SETTINGS_KEYS}
          // data
          connections={connections}
          proxyPools={proxyPools}
          selectedConnectionIds={selectedConnectionIds}
          selectedConnections={selectedConnections}
          allSelected={allSelected}
          oneByOneRunning={oneByOneRunning}
          oneByOneStopping={oneByOneStopping}
          oneByOneCurrentConnectionId={oneByOneCurrentConnectionId}
          oneByOneResults={oneByOneResults}
          oneByOneSummary={oneByOneSummary}
          providerStrategy={providerStrategy}
          providerStickyLimit={providerStickyLimit}
          thinkingMode={thinkingMode}
          autoPing={autoPing}
          // modal state
          showBulkProxyModal={showBulkProxyModal}
          bulkUpdatingProxy={bulkUpdatingProxy}
          activePools={activePools}
          selectedProxySummary={selectedProxySummary}
          // handlers
          handleSwapPriority={handleSwapPriority}
          handleUpdateConnectionStatus={handleUpdateConnectionStatus}
          handleDelete={handleDelete}
          handleBulkDelete={handleBulkDelete}
          handleRunOneByOneTest={handleRunOneByOneTest}
          handleStopOneByOneTest={handleStopOneByOneTest}
          handleRoundRobinToggle={handleRoundRobinToggle}
          handleStickyLimitChange={handleStickyLimitChange}
          handleThinkingModeChange={handleThinkingModeChange}
          handleAutoPingConnection={handleAutoPingConnection}
          triggerOAuthConnection={triggerOAuthConnection}
          triggerApiKeyConnection={triggerApiKeyConnection}
          triggerAddConnection={triggerAddConnection}
          toggleSelectConnection={toggleSelectConnection}
          toggleSelectAllConnections={toggleSelectAllConnections}
          openBulkProxyModal={openBulkProxyModal}
          closeBulkProxyModal={closeBulkProxyModal}
          applyProxyAssignments={applyProxyAssignments}
          handleApplySinglePool={handleApplySinglePool}
          handleApplyOneToOne={handleApplyOneToOne}
          fetchConnections={fetchConnections}
          setSelectedConnection={setSelectedConnection}
          setShowEditModal={setShowEditModal}
          setShowBulkProxyModal={setShowBulkProxyModal}
          setShowIFlowCookieModal={setShowIFlowCookieModal}
          setShowBulkImportCodex={setShowBulkImportCodex}
          setConnections={setConnections}
        />
      </CollapsibleSection>

      {/* Health Timeline */}
      <CollapsibleSection
        title="Health"
        icon="monitoring"
        defaultExpanded={false}
      >
        <div className="px-4 py-3">
          <HealthTimeline providerId={providerId} />
        </div>
      </CollapsibleSection>

      {/* Models */}
      <CollapsibleSection
        title="Models"
        icon="apps"
        count={models.length}
        defaultExpanded
      >
        <ModelsCard
          // identity
          providerId={providerId}
          isCompatible={isCompatible}
          isAnthropicCompatible={isAnthropicCompatible}
          isFreeNoAuth={isFreeNoAuth}
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          // data
          models={models}
          kiloFreeModels={kiloFreeModels}
          modelAliases={modelAliases}
          customModels={customModels}
          disabledModelIds={disabledModelIds}
          modelTestResults={modelTestResults}
          testingModelIds={testingModelIds}
          testingAllModels={testingAllModels}
          modelsTestError={modelsTestError}
          modelSearchQuery={modelSearchQuery}
          connections={connections}
          suggestedModels={suggestedModels}
          importingQoderModels={importingQoderModels}
          copied={copied}
          // hooks
          getCaps={getCaps}
          // handlers
          copy={copy}
          handleTestModel={handleTestModel}
          handleTestAllModels={handleTestAllModels}
          handleDisableModel={handleDisableModel}
          handleEnableModel={handleEnableModel}
          handleDisableAll={handleDisableAll}
          handleEnableAll={handleEnableAll}
          handleSetAlias={handleSetAlias}
          handleDeleteAlias={handleDeleteAlias}
          handleAddCustomModel={handleAddCustomModel}
          handleDeleteCustomModel={handleDeleteCustomModel}
          handleImportQoderModels={handleImportQoderModels}
          setModelSearchQuery={setModelSearchQuery}
          setShowAddCustomModel={setShowAddCustomModel}
        />
      </CollapsibleSection>

      {/* ── Modals (unchanged) ── */}
      {providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal isOpen={showOAuthModal} onSuccess={handleOAuthSuccess} onClose={() => setShowOAuthModal(false)} />
      ) : providerId === "gitlab" ? (
        <GitLabAuthModal isOpen={showOAuthModal} providerInfo={providerInfo} onSuccess={handleOAuthSuccess} onClose={() => setShowOAuthModal(false)} />
      ) : (
        <OAuthModal isOpen={showOAuthModal} provider={providerId} providerInfo={providerInfo} onSuccess={handleOAuthSuccess} onClose={() => setShowOAuthModal(false)} />
      )}
      {providerId === "iflow" && (
        <IFlowCookieModal isOpen={showIFlowCookieModal} onSuccess={handleIFlowCookieSuccess} onClose={() => setShowIFlowCookieModal(false)} />
      )}
      <AddApiKeyModal
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={providerInfo?.authType}
        authHint={providerInfo?.authHint}
        website={providerInfo?.website}
        proxyPools={proxyPools}
        error={addConnectionError}
        onSave={handleSaveApiKey}
        onBulkDone={fetchConnections}
        onClose={() => { setAddConnectionError(""); setShowAddApiKeyModal(false); }}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={showEditNodeModal}
          node={providerNode}
          onSave={handleUpdateNode}
          onClose={() => setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {!isCompatible && (
        <AddCustomModelModal
          isOpen={showAddCustomModel}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={async (modelId) => { await handleAddCustomModel(modelId, "llm", providerStorageAlias); setShowAddCustomModel(false); }}
          onClose={() => setShowAddCustomModel(false)}
        />
      )}
      {providerId === "codex" && (
        <BulkImportCodexModal isOpen={showBulkImportCodex} onClose={() => setShowBulkImportCodex(false)} onSuccess={fetchConnections} />
      )}
      <ConfirmModal
        isOpen={showAgRiskModal}
        onClose={() => setShowAgRiskModal(false)}
        onConfirm={handleAgRiskConfirm}
        title="Risk Notice"
        message={providerInfo?.deprecationNotice}
        confirmText="I Understand, Continue"
        cancelText="Cancel"
        variant="danger"
      />
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}
