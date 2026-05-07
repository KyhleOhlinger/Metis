/**
 * SelectionToolbar — floating AI action bar that appears above highlighted text.
 *
 * Quick actions are read from the persona store so users can customise them in
 * Settings → Quick Actions.  Each action can optionally be pinned to a specific
 * persona; if none is set the currently active persona is used.
 */

import { useStore } from "../store/useStore";
import { usePersonaStore } from "../store/usePersonaStore";
import { DEFAULT_QUICK_ACTIONS } from "../types/persona";

// ── Component ─────────────────────────────────────────────────────────────────

export default function SelectionToolbar() {
  const { selectedText, selectionCoords, selectionEndOffset, clearSelection } = useStore();
  const { settings, setSelectionQuery } = usePersonaStore();

  // Fall back to hardcoded defaults until settings have been loaded from disk
  const quickActions = settings.quickActions?.length
    ? settings.quickActions
    : DEFAULT_QUICK_ACTIONS;

  // Hide when nothing is selected or the selection was consumed by an action
  if (!selectedText || !selectionCoords) return null;

  const TOOLBAR_HEIGHT = 36;
  const TOOLBAR_WIDTH  = 300;
  const MARGIN         = 8;

  const rawLeft = selectionCoords.left;
  const maxLeft = window.innerWidth - TOOLBAR_WIDTH - MARGIN;
  const left    = Math.max(MARGIN, Math.min(rawLeft, maxLeft));
  const top     = Math.max(MARGIN, selectionCoords.top - TOOLBAR_HEIGHT - MARGIN);

  function handleAction(action: typeof quickActions[number]) {
    const userMessage = action.custom
      ? `Selection:\n\n${selectedText}\n\n`
      : action.promptTemplate.replace("{text}", selectedText);

    setSelectionQuery({
      selectedText,
      userMessage,
      autoRun: !action.custom,
      insertAfterSelection: action.insertAfterSelection,
      selectionEndOffset: action.insertAfterSelection ? selectionEndOffset : undefined,
      // Pass the action's dedicated persona (null means "use active persona")
      personaId: action.personaId ?? null,
    });
    clearSelection();
  }

  return (
    <div
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-surface-raised px-1 py-1 shadow-lg"
      style={{ top, left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="mr-1 select-none px-1 text-[9px] text-text-muted opacity-60">
        {selectedText.length.toLocaleString()} chars
      </span>

      <div className="h-3 w-px bg-border opacity-50" />

      {quickActions.map((action) => (
        <button
          key={action.id}
          onClick={() => handleAction(action)}
          title={action.id === "ask" ? "Open agent with selection as context" : undefined}
          className={[
            "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
            action.custom
              ? "text-accent hover:bg-accent/10"
              : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary",
          ].join(" ")}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
