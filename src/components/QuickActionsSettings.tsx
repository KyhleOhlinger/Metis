/**
 * QuickActionsSettings — settings panel for the floating selection toolbar.
 *
 * Allows users to:
 *  • Drag rows to reorder quick actions.
 *  • Edit label, prompt template, and linked persona for every existing action.
 *  • Create new custom actions.
 *  • Delete any action except the built-in "Ask…" fallback.
 *  • Pin a specific persona to an action so it always uses that agent regardless
 *    of whichever persona is currently active in the Command Center.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePersonaStore } from "../store/usePersonaStore";
import { DEFAULT_QUICK_ACTIONS, type QuickAction } from "../types/persona";

// ── Helpers ───────────────────────────────────────────────────────────────────

function newId() {
  return `qa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Move item at `from` to the position indicated by (`toId`, `position`). */
function reorderById(
  actions: QuickAction[],
  fromId: string,
  toId: string,
  position: "before" | "after",
): QuickAction[] {
  const fromIdx = actions.findIndex((a) => a.id === fromId);
  const toIdx   = actions.findIndex((a) => a.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return actions;

  const result = [...actions];
  const [item] = result.splice(fromIdx, 1);
  // After removing fromIdx, all later indices shift left by 1
  let insertAt = position === "before" ? toIdx : toIdx + 1;
  if (fromIdx < toIdx) insertAt -= 1;
  result.splice(insertAt, 0, item);
  return result;
}

// ── Drag-handle icon ──────────────────────────────────────────────────────────

function DragHandle() {
  return (
    <svg
      width="10" height="14" viewBox="0 0 10 14"
      fill="currentColor"
      className="text-text-muted"
      aria-hidden
    >
      {/* 2 × 3 grid of dots */}
      <circle cx="2.5" cy="2"  r="1.1" /><circle cx="7.5" cy="2"  r="1.1" />
      <circle cx="2.5" cy="7"  r="1.1" /><circle cx="7.5" cy="7"  r="1.1" />
      <circle cx="2.5" cy="12" r="1.1" /><circle cx="7.5" cy="12" r="1.1" />
    </svg>
  );
}

// ── Inline editor for a single action ────────────────────────────────────────

interface ActionEditorProps {
  initial: QuickAction;
  personas: ReturnType<typeof usePersonaStore.getState>["personas"];
  onSave: (action: QuickAction) => void;
  onCancel: () => void;
}

function ActionEditor({ initial, personas, onSave, onCancel }: ActionEditorProps) {
  const [label, setLabel]             = useState(initial.label);
  const [template, setTemplate]       = useState(initial.promptTemplate);
  const [personaId, setPersonaId]     = useState(initial.personaId ?? "");
  const [insertAfter, setInsertAfter] = useState(initial.insertAfterSelection ?? false);

  const inputCls =
    "w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none";
  const labelCls =
    "block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-0.5";

  function handleSave() {
    const trimLabel    = label.trim();
    const trimTemplate = template.trim();
    if (!trimLabel || !trimTemplate) return;
    onSave({
      ...initial,
      label: trimLabel,
      promptTemplate: trimTemplate,
      personaId: personaId || null,
      insertAfterSelection: insertAfter,
    });
  }

  return (
    <div className="mt-1 rounded-md border border-accent/30 bg-surface-overlay p-3 space-y-2.5">
      {/* Label */}
      <div>
        <label className={labelCls}>Label</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. ✦ Improve"
          className={inputCls}
        />
      </div>

      {/* Prompt template */}
      <div>
        <label className={labelCls}>
          Prompt template
          <span className="ml-1 font-normal normal-case text-text-muted opacity-60">
            — use <code className="rounded bg-surface-raised px-0.5">{"{text}"}</code> as the selection placeholder
          </span>
        </label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={4}
          placeholder={"Summarise the following in 2–3 sentences:\n\n{text}"}
          className={`${inputCls} resize-y font-mono text-[11px]`}
        />
      </div>

      {/* Persona picker */}
      <div>
        <label className={labelCls}>Persona</label>
        <select
          value={personaId}
          onChange={(e) => setPersonaId(e.target.value)}
          className={inputCls}
        >
          <option value="">Active Persona (default)</option>
          {personas
            .filter((p) => !p.disabled)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.name}
              </option>
            ))}
        </select>
        <p className="mt-0.5 text-[9px] text-text-muted opacity-60">
          "Active Persona" uses whichever agent is selected in the Command Center at the time.
        </p>
      </div>

      {/* Insert-after-selection toggle — only for non-custom auto-run actions */}
      {!initial.custom && (
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={insertAfter}
            onChange={(e) => setInsertAfter(e.target.checked)}
            className="accent-accent"
          />
          <span className="text-xs text-text-secondary">
            Offer response as inline insert at selection end
          </span>
        </label>
      )}

      {/* Buttons */}
      <div className="flex gap-1.5 pt-0.5">
        <button
          onClick={handleSave}
          disabled={!label.trim() || !template.trim()}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-border px-3 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function QuickActionsSettings({
  hideHeader = false,
  newActionTrigger = 0,
}: {
  hideHeader?: boolean;
  newActionTrigger?: number;
} = {}) {
  const {
    settings, personas,
    upsertQuickAction, deleteQuickAction, reorderQuickActions,
  } = usePersonaStore();

  const quickActions = settings.quickActions?.length
    ? settings.quickActions
    : DEFAULT_QUICK_ACTIONS;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding]       = useState(false);

  const blankAction: QuickAction = {
    id: newId(),
    label: "",
    promptTemplate: "{text}",
    personaId: null,
  };
  const [draft, setDraft] = useState<QuickAction>(blankAction);

  // When the parent increments the trigger, open the new-action form
  useEffect(() => {
    if (newActionTrigger > 0) {
      setDraft({ ...blankAction, id: newId() });
      setEditing(null);
      setAdding(true);
    }
    // blankAction is intentionally a stable reference within the effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newActionTrigger]);

  function startAdd() {
    setDraft({ ...blankAction, id: newId() });
    setEditing(null);
    setAdding(true);
  }

  function setEditing(id: string | null) {
    setEditingId(id);
    setAdding(false);
  }

  function handleSave(action: QuickAction) {
    upsertQuickAction(action);
    setEditingId(null);
    setAdding(false);
  }

  // Resolve linked persona name for display
  function personaBadge(pid?: string | null) {
    if (!pid) return null;
    const p = personas.find((p) => p.id === pid);
    return p ? `${p.icon} ${p.name}` : null;
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  // Uses setPointerCapture (reliable in Tauri WKWebView) on the drag handle.
  // All move/up events route back to the captured element so we can hit-test
  // against sibling item rects to find the live drop target.

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);

  // One ref per list item, keyed by action id
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleDragPointerDown = useCallback(
    (e: React.PointerEvent, actionId: string) => {
      // Only primary pointer (left button / single touch)
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      // Capture pointer on the handle so move/up always come here
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDraggingId(actionId);
      setDropTarget(null);
    },
    [],
  );

  const handleDragPointerMove = useCallback(
    (e: React.PointerEvent, actionId: string) => {
      if (draggingId !== actionId) return;
      // Hit-test all sibling rows to find the current drop target
      let found: { id: string; position: "before" | "after" } | null = null;
      for (const [id, el] of itemRefs.current) {
        if (id === draggingId) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          found = {
            id,
            position: e.clientY < rect.top + rect.height / 2 ? "before" : "after",
          };
          break;
        }
      }
      setDropTarget(found);
    },
    [draggingId],
  );

  const handleDragPointerUp = useCallback(
    (_e: React.PointerEvent, actionId: string) => {
      if (draggingId === actionId && dropTarget) {
        const reordered = reorderById(quickActions, draggingId, dropTarget.id, dropTarget.position);
        if (reordered !== quickActions) {
          reorderQuickActions(reordered.map((a) => a.id));
        }
      }
      setDraggingId(null);
      setDropTarget(null);
    },
    [draggingId, dropTarget, quickActions, reorderQuickActions],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* Section header — hidden when rendered inside CollapsibleSection */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Quick Actions
          </p>
          <button
            onClick={startAdd}
            className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
          >
            + New Action
          </button>
        </div>
      )}

      <p className="text-[10px] text-text-muted opacity-70 leading-relaxed">
        These actions appear in the floating toolbar when you highlight text in the editor.
        Each can be linked to a dedicated persona. Drag ⠿ to reorder.
      </p>

      {/* Action list */}
      <div className="space-y-1">
        {quickActions.map((action) => {
          const isDragging  = draggingId === action.id;
          const isDropBefore = dropTarget?.id === action.id && dropTarget.position === "before";
          const isDropAfter  = dropTarget?.id === action.id && dropTarget.position === "after";

          return (
            <div
              key={action.id}
              ref={(el) => {
                if (el) itemRefs.current.set(action.id, el);
                else    itemRefs.current.delete(action.id);
              }}
              className={[
                "rounded transition-opacity",
                isDragging ? "opacity-40" : "opacity-100",
                // Top drop-line
                isDropBefore ? "border-t-2 border-accent" : "border-t-2 border-transparent",
                // Bottom drop-line
                isDropAfter  ? "border-b-2 border-accent" : "border-b-2 border-transparent",
              ].join(" ")}
            >
              {/* ── Row ── */}
              <div
                className={`flex items-center gap-1.5 rounded px-1.5 py-1.5 transition-colors ${
                  editingId === action.id
                    ? "bg-surface-overlay"
                    : "hover:bg-surface-overlay"
                }`}
              >
                {/* Drag handle — pointer events manage the whole drag lifecycle */}
                <div
                  className={[
                    "shrink-0 flex items-center justify-center px-0.5 py-1 rounded",
                    "text-text-muted hover:text-text-primary transition-colors",
                    draggingId ? "cursor-grabbing" : "cursor-grab",
                    "touch-none select-none",
                  ].join(" ")}
                  title="Drag to reorder"
                  onPointerDown={(e) => handleDragPointerDown(e, action.id)}
                  onPointerMove={(e) => handleDragPointerMove(e, action.id)}
                  onPointerUp={(e)   => handleDragPointerUp(e, action.id)}
                >
                  <DragHandle />
                </div>

                {/* Label */}
                <span className="flex-1 truncate text-xs font-medium text-text-primary">
                  {action.label}
                </span>

                {/* Persona badge */}
                <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 text-[9px] text-text-muted">
                  {personaBadge(action.personaId) ?? "Active Persona"}
                </span>

                {/* Edit / delete buttons */}
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={() => setEditing(editingId === action.id ? null : action.id)}
                    title="Edit action"
                    className="rounded p-1 text-[10px] text-text-muted hover:bg-surface-raised hover:text-accent transition-colors"
                  >
                    ✎
                  </button>
                  {/* The "ask" action is the permanent fallback — no delete */}
                  {action.id !== "ask" && (
                    <button
                      onClick={() => {
                        if (editingId === action.id) setEditingId(null);
                        deleteQuickAction(action.id);
                      }}
                      title="Delete action"
                      className="rounded p-1 text-[10px] text-text-muted hover:bg-surface-raised hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Inline edit form */}
              {editingId === action.id && (
                <ActionEditor
                  initial={action}
                  personas={personas}
                  onSave={handleSave}
                  onCancel={() => setEditingId(null)}
                />
              )}
            </div>
          );
        })}

        {/* "Add new action" form */}
        {adding && (
          <div className="mt-1">
            <div className="flex items-center gap-2 rounded px-2 py-1.5 bg-surface-overlay">
              <span className="flex-1 text-xs font-medium text-text-muted italic">
                New action…
              </span>
            </div>
            <ActionEditor
              initial={draft}
              personas={personas}
              onSave={handleSave}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
