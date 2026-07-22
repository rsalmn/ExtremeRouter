"use client";

import { Button, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import ModelRow from "../ModelRow";
import CompatibleModelsSection from "../CompatibleModelsSection";
import { getModelKind } from "@/shared/constants/models";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";

/**
 * Models card — extracted from page.js lines 1652-1712 (toolbar + card) +
 * renderModelsSection() function (1031-1212). All state/handlers passed from
 * page.js. Visual polish: responsive grid instead of flex-wrap, compact pill
 * toolbar buttons, right-aligned search.
 *
 * Behavioral logic is UNCHANGED — pure extraction + restyle.
 */
export default function ModelsCard({
  // identity
  providerId,
  isCompatible,
  isAnthropicCompatible,
  isFreeNoAuth,
  providerStorageAlias,
  providerDisplayAlias,

  // data
  models,
  kiloFreeModels,
  modelAliases,
  customModels,
  disabledModelIds,
  modelTestResults,
  testingModelIds,
  testingAllModels,
  modelsTestError,
  modelSearchQuery,
  connections,
  suggestedModels,
  importingQoderModels,
  copied,

  // hooks
  getCaps,

  // handlers
  copy,
  handleTestModel,
  handleTestAllModels,
  handleDisableModel,
  handleEnableModel,
  handleDisableAll,
  handleEnableAll,
  handleSetAlias,
  handleDeleteAlias,
  handleAddCustomModel,
  handleDeleteCustomModel,
  handleImportQoderModels,
  setModelSearchQuery,
  setShowAddCustomModel,
}) {
  // ── Compatible providers: delegate to CompatibleModelsSection ──
  if (isCompatible) {
    return (
      <div className="px-4 py-3">
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          customModels={customModels}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          onAddCustomModel={(modelId) => handleAddCustomModel(modelId, "llm", providerStorageAlias)}
          onDeleteCustomModel={(modelId) => handleDeleteCustomModel(modelId, "llm", providerStorageAlias)}
          connections={connections}
          isAnthropic={isAnthropicCompatible}
        />
      </div>
    );
  }

  // ── Standard providers: model grid ──
  // Combine hardcoded models with Kilo free models (deduplicated), exclude non-llm.
  const allModels = [
    ...models,
    ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
  ].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; });

  const disabledSet = new Set(disabledModelIds);
  const displayModels = allModels.filter((m) => !disabledSet.has(m.id));
  const disabledDisplayModels = allModels.filter((m) => disabledSet.has(m.id));
  const customModelRows = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    builtInModels: models,
    type: "llm",
  });

  // Search filter
  const q = modelSearchQuery.trim().toLowerCase();
  const matchesSearch = (id, name = "") =>
    !q || id.toLowerCase().includes(q) || String(name).toLowerCase().includes(q);
  const filteredDisplayModels = displayModels.filter((m) => matchesSearch(m.id, m.name));
  const filteredCustomModelRows = customModelRows.filter((m) => matchesSearch(m.id, m.name));

  // Toolbar IDs
  const allIds = allModels.map((m) => m.id);
  const activeIds = allIds.filter((id) => !disabledModelIds.includes(id));
  const testableIds = activeIds.filter((id) => !q || id.toLowerCase().includes(q));

  return (
    <div className="flex flex-col">
      {/* ── Toolbar ── */}
      <div className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {disabledModelIds.length > 0 && (
            <Button size="sm" variant="secondary" icon="restart_alt" onClick={handleEnableAll}>
              Active All
            </Button>
          )}
          {activeIds.length > 0 && (
            <Button size="sm" variant="secondary" icon="block" onClick={() => handleDisableAll(activeIds)}>
              Disable All
            </Button>
          )}
          {(connections.length > 0 || isFreeNoAuth) && testableIds.length > 0 && (
            <Button
              size="sm"
              variant="primary"
              icon={testingAllModels ? "progress_activity" : "play_arrow"}
              onClick={() => handleTestAllModels(testableIds)}
              disabled={testingAllModels}
              className={testingAllModels ? "animate-pulse" : ""}
            >
              {testingAllModels ? "Testing..." : `Test All (${testableIds.length})`}
            </Button>
          )}
        </div>
        <div className="sm:w-56">
          <Input
            type="search"
            placeholder="Search models..."
            value={modelSearchQuery}
            onChange={(e) => setModelSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-4 py-3">
        {!!modelsTestError && (
          <p className="mb-3 break-words text-xs text-danger">{modelsTestError}</p>
        )}

        {/* Model grid — responsive instead of flex-wrap */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Custom models first */}
          {filteredCustomModelRows.map((model) => (
            <ModelRow
              key={`${model.source}-${model.fullModel}`}
              model={{ id: model.id, name: model.name }}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={model.alias}
              copied={copied}
              onCopy={copy}
              onSetAlias={() => {}}
              onDeleteAlias={() => {
                if (model.source === "custom") {
                  handleDeleteCustomModel(model.id, "llm", providerStorageAlias);
                } else {
                  handleDeleteAlias(model.alias);
                }
              }}
              testStatus={modelTestResults[model.id]}
              onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
              isTesting={testingModelIds.has(model.id)}
              isCustom
              isFree={false}
              caps={getCaps(`${providerId}/${model.id}`)}
            />
          ))}

          {/* Built-in display models */}
          {filteredDisplayModels.map((model) => {
            const fullModel = `${providerStorageAlias}/${model.id}`;
            const oldFormatModel = `${providerId}/${model.id}`;
            const existingAlias = Object.entries(modelAliases).find(
              ([, m]) => m === fullModel || m === oldFormatModel,
            )?.[0];
            return (
              <ModelRow
                key={model.id}
                model={model}
                fullModel={`${providerDisplayAlias}/${model.id}`}
                alias={existingAlias}
                copied={copied}
                onCopy={copy}
                onSetAlias={(alias) => handleSetAlias(model.id, alias, providerStorageAlias)}
                onDeleteAlias={() => handleDeleteAlias(existingAlias)}
                testStatus={modelTestResults[model.id]}
                onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
                isTesting={testingModelIds.has(model.id)}
                isFree={model.isFree}
                onDisable={() => handleDisableModel(model.id)}
                caps={getCaps(`${providerId}/${model.id}`)}
              />
            );
          })}
        </div>

        {/* No search results */}
        {modelSearchQuery.trim() && filteredDisplayModels.length === 0 && filteredCustomModelRows.length === 0 && (
          <p className="w-full py-4 text-center text-sm text-text-muted">
            No models match &ldquo;{modelSearchQuery}&rdquo;
          </p>
        )}

        {/* Add model + Qoder import buttons */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setShowAddCustomModel(true)}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-xs text-primary transition-colors hover:border-primary hover:bg-primary/5"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            Add Model
          </button>
          {providerId === "qoder" && connections.some((conn) => conn.isActive !== false) && (
            <button
              onClick={handleImportQoderModels}
              disabled={importingQoderModels}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-blue-500/40 px-3 py-2 text-xs text-info transition-colors hover:border-blue-500 hover:bg-blue-500/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className="material-symbols-outlined text-sm"
                style={importingQoderModels ? { animation: "spin 1s linear infinite" } : undefined}
              >
                {importingQoderModels ? "progress_activity" : "download"}
              </span>
              {importingQoderModels ? translate("Fetching...") : translate("Fetch Qoder Models")}
            </button>
          )}
        </div>

        {/* Suggested models */}
        {suggestedModels.length > 0 && (() => {
          const addedFullModels = new Set([
            ...Object.values(modelAliases),
            ...customModelRows.map((model) => model.fullModel),
          ]);
          const hardcodedIds = new Set(models.map((m) => m.id));
          const notAdded = suggestedModels.filter(
            (m) => !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id),
          );
          if (notAdded.length === 0) return null;
          return (
            <div className="mt-3 w-full">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">
                Suggested free models
              </p>
              <div className="flex flex-wrap gap-2">
                {notAdded.map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => {
                      await handleAddCustomModel(m.id, "llm", providerStorageAlias);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                    title={`${m.name} · ${(m.contextLength / 1000).toFixed(0)}k ctx`}
                  >
                    <span className="material-symbols-outlined text-[13px]">add</span>
                    {m.id.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Disabled models — restorable */}
        {disabledDisplayModels.length > 0 && (
          <div className="mt-3 w-full">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">
              Disabled ({disabledDisplayModels.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {disabledDisplayModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleEnableModel(m.id)}
                  className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                  title="Restore model"
                >
                  <span className="material-symbols-outlined text-[13px]">add</span>
                  {m.id}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
