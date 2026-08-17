import { usePersonaStore } from "@/store/usePersonaStore";
import { useStore } from "@/store/useStore";
import { QuickNoteList, RECENT_DROPDOWN_LIMIT } from "@/components/sidebar/QuickNoteList";
import { resolveNotePaths } from "@/utils/noteNavigation";

interface EditorEmptyQuickNotesProps {
  vaultPath: string;
}

/** Pinned / recent notes on the editor empty state. */
export function EditorEmptyQuickNotes({ vaultPath }: EditorEmptyQuickNotesProps) {
  const noteIndex = useStore((s) => s.noteIndex);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const plannerSetupRequired = useStore((s) => s.plannerSetupRequired);
  const nav = usePersonaStore((s) => s.settings.vaultNoteNavigation?.[vaultPath]);

  const pinned = resolveNotePaths(nav?.pinned ?? [], noteIndex);
  const pinnedSet = new Set(nav?.pinned ?? []);
  const recent = resolveNotePaths(nav?.recent ?? [], noteIndex).filter(
    (n) => !pinnedSet.has(n.path),
  );

  if (pinned.length === 0 && recent.length === 0) return null;

  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-surface-raised/80 px-2 py-2">
      <QuickNoteList
        title="Pinned"
        notes={pinned}
        activeFilePath={activeFilePath}
        dropdown
        compact
      />
      <QuickNoteList
        title="Recent"
        notes={recent}
        activeFilePath={activeFilePath}
        limit={RECENT_DROPDOWN_LIMIT}
        dropdown
        compact
      />
      {plannerSetupRequired && (
        <p className="mt-1 border-t border-border px-2 pt-2 text-[10px] text-text-muted">
          Planner needs setup — open Settings → Planner or the Planner tab to finish configuration.
        </p>
      )}
    </div>
  );
}
