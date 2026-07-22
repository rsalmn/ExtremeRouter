"use client";

import {
  Button,
  Toggle,
  Modal,
} from "@/shared/components";
import { translate } from "@/i18n/runtime";
import ConnectionRow from "../ConnectionRow";
import VaultPoolBadge from "../VaultPoolBadge";
import FreeBuffProfile from "../FreeBuffProfile";
import V0Profile from "../V0Profile";
import QwenCloudProfile from "../QwenCloudProfile";
import ZenmuxPlanSelector from "../ZenmuxPlanSelector";
import NoAuthProxyCard from "@/shared/components/NoAuthProxyCard";

/**
 * Connections card — extracted from page.js lines 1387-1643 + connectionsList
 * (892-949) + bulkActionModal (953-1000). All state and handlers live in the
 * parent page.js and are passed down via props. Visual polish: Card
 * padding="none", header section with border-b, cleaner toolbar layout,
 * progress-bar-style one-by-one summary, compact pill buttons.
 *
 * Behavioral logic is UNCHANGED — this is a pure extraction + restyle.
 */
export default function ConnectionsCard({
  // identity
  providerId,
  isOAuth,
  isCompatible,
  isFreeNoAuth,
  hasDualAuthModes,
  oauthConnectionLabel,
  apiKeyConnectionLabel,
  thinkingConfig,
  AUTO_PING_SETTINGS_KEYS,

  // data
  connections,
  proxyPools,
  selectedConnectionIds,
  selectedConnections,
  allSelected,
  oneByOneRunning,
  oneByOneStopping,
  oneByOneCurrentConnectionId,
  oneByOneResults,
  oneByOneSummary,
  providerStrategy,
  providerStickyLimit,
  thinkingMode,
  autoPing,

  // modal state
  showBulkProxyModal,
  bulkUpdatingProxy,
  activePools,
  selectedProxySummary,

  // handlers
  handleSwapPriority,
  handleUpdateConnectionStatus,
  handleDelete,
  handleBulkDelete,
  handleRunOneByOneTest,
  handleStopOneByOneTest,
  handleRoundRobinToggle,
  handleStickyLimitChange,
  handleThinkingModeChange,
  handleAutoPingConnection,
  triggerOAuthConnection,
  triggerApiKeyConnection,
  triggerAddConnection,
  toggleSelectConnection,
  toggleSelectAllConnections,
  openBulkProxyModal,
  closeBulkProxyModal,
  applyProxyAssignments,
  handleApplySinglePool,
  handleApplyOneToOne,
  fetchConnections,
  setSelectedConnection,
  setShowEditModal,
  setShowBulkProxyModal,
  setShowIFlowCookieModal,
  setShowBulkImportCodex,
  setConnections,
}) {
  // ── noAuth providers: delegate entirely to NoAuthProxyCard ──
  if (isFreeNoAuth) {
    return <NoAuthProxyCard providerId={providerId} />;
  }

  const isSelected = (connectionId) => selectedConnectionIds.includes(connectionId);

  return (
    <div className="flex flex-col">
      {/* ── Header: title + provider widgets + toolbar ── */}
      <div className="flex flex-col gap-3 border-b border-border-subtle px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-main">Connections</h3>
            {connections.length > 0 && (
              <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text-muted dark:bg-white/10">
                {connections.length}
              </span>
            )}
          </div>
          <VaultPoolBadge providerId={providerId} />
          {providerId === "freebuff-web" && connections.length > 0 && (
            <FreeBuffProfile connectionId={connections[0].id} />
          )}
          {providerId === "v0-vercel-web" && connections.length > 0 && (
            <V0Profile connectionId={connections[0].id} />
          )}
          {providerId === "qwencloud" && connections.length > 0 && (
            <QwenCloudProfile connectionId={connections[0].id} />
          )}
        </div>

        {/* Toolbar: wraps on mobile, row on desktop */}
        <div className="flex flex-wrap items-center gap-2">
          {connections.length > 0 && proxyPools.length > 0 && (
            <Button size="sm" variant="secondary" icon="lan" onClick={openBulkProxyModal}>
              Apply Proxy
            </Button>
          )}
          {connections.length > 0 && selectedConnectionIds.length > 0 && (
            <Button size="sm" variant="danger" icon="delete" onClick={handleBulkDelete}>
              Delete ({selectedConnectionIds.length})
            </Button>
          )}
          {connections.length > 0 && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={oneByOneRunning ? "progress_activity" : "sync"}
                onClick={handleRunOneByOneTest}
                disabled={oneByOneRunning}
                className={oneByOneRunning ? "animate-pulse" : ""}
              >
                {oneByOneRunning ? "Testing..." : "Test All"}
              </Button>
              {oneByOneRunning && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="stop"
                  onClick={handleStopOneByOneTest}
                  disabled={oneByOneStopping}
                >
                  {oneByOneStopping ? "Stopping" : "Stop"}
                </Button>
              )}
            </>
          )}
          {thinkingConfig && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-text-muted">Thinking</span>
              <select
                value={thinkingMode}
                onChange={(e) => handleThinkingModeChange(e.target.value)}
                className="h-7 rounded-lg border border-border bg-black/[0.02] px-2 text-xs text-text-primary outline-none transition-colors hover:bg-surface-2 dark:border-white/10 dark:bg-white/[0.03]"
              >
                {thinkingConfig.options.map((opt) => (
                  <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">Round Robin</span>
            <Toggle checked={providerStrategy === "round-robin"} onChange={handleRoundRobinToggle} />
            {providerStrategy === "round-robin" && (
              <input
                type="number"
                min={1}
                value={providerStickyLimit}
                onChange={(e) => handleStickyLimitChange(e.target.value)}
                placeholder="1"
                className="w-12 rounded-lg border border-border bg-black/[0.02] px-1.5 py-0.5 text-xs text-text-primary outline-none dark:border-white/10 dark:bg-white/[0.03]"
                title="Sticky limit (requests per account before rotating)"
              />
            )}
          </div>
          {providerId === "zenmux-free" && connections.length > 0 && (
            <ZenmuxPlanSelector
              connectionId={connections[0].id}
              cookie={connections[0].apiKey || ""}
              currentPlan={connections[0].providerSpecificData?.zenmuxPlan || "free"}
              onPlanChanged={fetchConnections}
            />
          )}
        </div>
      </div>

      {/* ── Body ── */}
      {connections.length === 0 ? (
        // Empty state
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[24px]">{isOAuth ? "lock" : "key"}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-text-main">No connections yet</p>
            {hasDualAuthModes && (
              <p className="mt-0.5 text-xs text-text-muted">
                Choose {oauthConnectionLabel} or {apiKeyConnectionLabel}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {hasDualAuthModes ? (
              <>
                <Button size="sm" icon="lock" variant="secondary" onClick={triggerOAuthConnection}>
                  {oauthConnectionLabel}
                </Button>
                <Button size="sm" icon="key" onClick={triggerApiKeyConnection}>
                  {apiKeyConnectionLabel}
                </Button>
              </>
            ) : (
              <>
                {!isCompatible && providerId === "iflow" && (
                  <Button size="sm" icon="cookie" variant="secondary" onClick={() => setShowIFlowCookieModal(true)}>
                    Cookie
                  </Button>
                )}
                {providerId === "codex" && (
                  <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportCodex(true)}>
                    {translate("Bulk Add")}
                  </Button>
                )}
                <Button size="sm" icon="add" onClick={triggerAddConnection}>
                  {isCompatible ? "Add API Key" : (providerId === "iflow" ? "OAuth" : "Add Connection")}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        // Populated state
        <div className="flex flex-col">
          {/* One-by-one test summary — progress bar style */}
          {oneByOneSummary && (
            <div className="border-b border-border-subtle px-4 py-2.5">
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-text-muted">checklist</span>
                  <span className="font-medium text-text-main">
                    {oneByOneSummary.completed}/{oneByOneSummary.total}
                  </span>
                </div>
                {oneByOneSummary.passed > 0 && (
                  <span className="text-success">✓ {oneByOneSummary.passed}</span>
                )}
                {oneByOneSummary.failed > 0 && (
                  <span className="text-danger">✗ {oneByOneSummary.failed}</span>
                )}
                {oneByOneSummary.stopped && (
                  <span className="text-warning">Stopped</span>
                )}
                {oneByOneRunning && oneByOneCurrentConnectionId && (
                  <span className="truncate text-text-muted">
                    Testing: {connections.find((c) => c.id === oneByOneCurrentConnectionId)?.name || oneByOneCurrentConnectionId}
                  </span>
                )}
              </div>
              {/* Progress bar */}
              {oneByOneSummary.total > 0 && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${(oneByOneSummary.completed / oneByOneSummary.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Select All row */}
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted hover:text-primary">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAllConnections}
                className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
              />
              Select All
            </label>
            {selectedConnectionIds.length > 0 && (
              <span className="text-[10px] text-text-muted">
                {selectedConnectionIds.length} selected
              </span>
            )}
          </div>

          {/* Connection rows */}
          <div className="flex min-w-0 flex-col divide-y divide-border-subtle">
            {connections.map((conn, index) => (
              <div key={conn.id} className="flex min-w-0 items-stretch">
                <div className="flex shrink-0 items-center pl-2 sm:pl-3">
                  <input
                    type="checkbox"
                    checked={isSelected(conn.id)}
                    onChange={() => toggleSelectConnection(conn.id)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <ConnectionRow
                    connection={conn}
                    proxyPools={proxyPools}
                    isOAuth={isOAuth}
                    isFirst={index === 0}
                    isLast={index === connections.length - 1}
                    onMoveUp={() => handleSwapPriority(index, index - 1)}
                    onMoveDown={() => handleSwapPriority(index, index + 1)}
                    onToggleActive={(isActive) => handleUpdateConnectionStatus(conn.id, isActive)}
                    autoPing={
                      AUTO_PING_SETTINGS_KEYS[providerId] && conn.authType === "oauth"
                        ? {
                            on: autoPing.connections[conn.id] === true,
                            onToggle: (on) => handleAutoPingConnection(conn.id, on),
                            provider: providerId,
                          }
                        : null
                    }
                    onUpdateProxy={async (proxyPoolId) => {
                      try {
                        const res = await fetch(`/api/providers/${conn.id}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
                        });
                        if (res.ok) {
                          setConnections((prev) =>
                            prev.map((c) =>
                              c.id === conn.id
                                ? { ...c, providerSpecificData: { ...c.providerSpecificData, proxyPoolId: proxyPoolId || null } }
                                : c,
                            ),
                          );
                        }
                      } catch (error) {
                        console.log("Error updating proxy:", error);
                      }
                    }}
                    onEdit={() => {
                      setSelectedConnection(conn);
                      setShowEditModal(true);
                    }}
                    onDelete={() => handleDelete(conn.id)}
                    oneByOneStatus={oneByOneResults[conn.id] || null}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Footer: add-connection buttons */}
          {!isCompatible && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-3">
              {providerId === "iflow" && (
                <Button size="sm" icon="cookie" variant="secondary" onClick={() => setShowIFlowCookieModal(true)}>
                  Cookie
                </Button>
              )}
              {providerId === "codex" && (
                <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportCodex(true)}>
                  {translate("Bulk Add")}
                </Button>
              )}
              {hasDualAuthModes ? (
                <>
                  <Button size="sm" icon="lock" variant="secondary" onClick={triggerOAuthConnection}>
                    {oauthConnectionLabel}
                  </Button>
                  <Button size="sm" icon="key" onClick={triggerApiKeyConnection}>
                    {apiKeyConnectionLabel}
                  </Button>
                </>
              ) : (
                <Button size="sm" icon="add" onClick={triggerAddConnection}>
                  Add
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Bulk proxy modal ── */}
      <Modal
        isOpen={showBulkProxyModal}
        onClose={closeBulkProxyModal}
        title={`Apply Proxy (${connections.length} connections)`}
      >
        <div className="flex flex-col gap-3">
          {selectedProxySummary && (
            <p className="text-xs text-text-muted">{selectedProxySummary}</p>
          )}
          <div className="flex flex-col">
            <button
              onClick={handleApplyOneToOne}
              disabled={bulkUpdatingProxy || activePools.length === 0}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px] text-text-muted">sync_alt</span>
              <span className="text-sm text-text-main">One-to-one (rotate)</span>
            </button>
            <button
              onClick={() => handleApplySinglePool(null)}
              disabled={bulkUpdatingProxy}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px] text-text-muted">link_off</span>
              <span className="text-sm text-text-main">None (unbind all)</span>
            </button>
            {proxyPools.map((pool) => (
              <button
                key={pool.id}
                onClick={() => handleApplySinglePool(pool.id)}
                disabled={bulkUpdatingProxy || pool.isActive !== true}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px] text-text-muted">lan</span>
                <span className="truncate text-sm text-text-main">{pool.name}</span>
                {pool.isActive !== true && (
                  <span className="text-[10px] text-text-muted">(inactive)</span>
                )}
              </button>
            ))}
          </div>
          {bulkUpdatingProxy && <p className="text-xs text-text-muted">Applying...</p>}
          <Button onClick={closeBulkProxyModal} variant="ghost" fullWidth disabled={bulkUpdatingProxy}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}
