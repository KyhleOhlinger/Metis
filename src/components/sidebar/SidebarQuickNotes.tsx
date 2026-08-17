import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { resolveNotePaths } from "@/utils/noteNavigation";
import { QuickNoteList, RECENT_DROPDOWN_LIMIT } from "./QuickNoteList";

export function SidebarQuickNotes({ vaultPath }: { vaultPath: string }) {
  const noteIndex = useStore((s) => s.noteIndex);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const nav = usePersonaStore((s) => s.settings.vaultNoteNavigation?.[vaultPath]);

  const pinned = resolveNotePaths(nav?.pinned ?? [], noteIndex);
  const pinnedSet = new Set(nav?.pinned ?? []);
  const recent = resolveNotePaths(nav?.recent ?? [], noteIndex).filter(
    (n) => !pinnedSet.has(n.path),
  );

  if (pinned.length === 0 && recent.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border py-1.5">
      <QuickNoteList
        title="Pinned"
        notes={pinned}
        activeFilePath={activeFilePath}
        dropdown
      />
      <QuickNoteList
        title="Recent"
        notes={recent}
        activeFilePath={activeFilePath}
        limit={RECENT_DROPDOWN_LIMIT}
        dropdown
      />
    </div>
  );
}
