import { usePersonaStore } from "@/store/usePersonaStore";
import { useStore } from "@/store/useStore";
import { QuickNoteList } from "@/components/sidebar/QuickNoteList";
import { RECENT_NOTES_SHOWN, splitQuickNotes } from "@/utils/noteNavigation";

interface EditorEmptyQuickNotesProps {
  vaultPath: string;
}

/** Pinned / recent notes on the editor empty state. */
export function EditorEmptyQuickNotes({ vaultPath }: EditorEmptyQuickNotesProps) {
  const noteIndex = useStore((s) => s.noteIndex);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const nav = usePersonaStore((s) => s.settings.vaultNoteNavigation?.[vaultPath]);

  const { pinned, recent } = splitQuickNotes(nav, noteIndex);

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
        limit={RECENT_NOTES_SHOWN}
        dropdown
        compact
      />
    </div>
  );
}
