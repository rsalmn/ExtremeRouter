"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CapacityBadges } from "@/shared/components";

// ModelItem — drag-and-drop sortable, inline-editable model row.
// Redesigned with cleaner visual hierarchy: priority number, drag handle,
// inline edit, capacity badges, and priority arrows.
export default function ModelItem({ id, index, model, isFirst, isLast, modelCaps, onEdit, onMoveUp, onMoveDown, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 999 : undefined,
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-all ${
        isDragging
          ? "border-primary/40 bg-panel shadow-md ring-1 ring-primary/20"
          : "border-transparent bg-panel hover:border-border-subtle"
      }`}
    >
      {/* Priority number badge */}
      <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-bold text-primary">
        {index + 1}
      </span>

      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        type="button"
        className="cursor-grab touch-none shrink-0 p-0.5 rounded text-text-muted/50 hover:text-text-main active:cursor-grabbing"
        title="Drag to reorder"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="4" r="1.5"/><circle cx="15" cy="4" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="20" r="1.5"/><circle cx="15" cy="20" r="1.5"/>
        </svg>
      </button>

      {/* Model name — inline editable */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 rounded border border-primary/40 bg-panel px-1.5 py-0.5 font-mono text-xs text-text-main outline-none"
        />
      ) : (
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5 cursor-text rounded px-1 py-0.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-main">{model}</code>
          {modelCaps?.[model] && <CapacityBadges caps={modelCaps[model]} size={11} />}
        </div>
      )}

      {/* Priority arrows */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className={`rounded p-1 transition-colors ${
            isFirst ? "cursor-not-allowed text-text-muted/20" : "text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
          }`}
          title="Move up"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className={`rounded p-1 transition-colors ${
            isLast ? "cursor-not-allowed text-text-muted/20" : "text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
          }`}
          title="Move down"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
        </button>
      </div>

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="shrink-0 rounded p-1 text-text-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  );
}
