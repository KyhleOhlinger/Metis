import { usePersonaStore } from "@/store/usePersonaStore";
import { useStore } from "@/store/useStore";
import { EditorEmptyQuickNotes } from "./EditorEmptyQuickNotes";
import { useCorePluginEnabled } from "@/plugins/usePluginStore";

function EmptyAction({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-primary transition hover:border-accent/40 hover:bg-surface-overlay"
    >
      {label}
      {hint && <span className="ml-1.5 font-mono text-[10px] text-text-muted">{hint}</span>}
    </button>
  );
}

interface EditorEmptyStateProps {
  vaultPath: string | null;
  onOpenPlanner: () => void;
  onOpenVault?: () => void;
  onCreateVault?: () => void;
}

export function EditorEmptyState({
  vaultPath,
  onOpenPlanner,
  onOpenVault,
  onCreateVault,
}: EditorEmptyStateProps) {
  const openSettings = () => usePersonaStore.getState().openSettings();
  const openPalette = () => useStore.getState().setPendingMenuAction("open-palette");
  const openExport = () => useStore.getState().setPendingMenuAction("export-hub");
  const noteCount = useStore((s) => s.noteIndex.length);
  const plannerSetupRequired = useStore((s) => s.plannerSetupRequired);
  const openSearch = () => {
    const store = useStore.getState();
    if (!store.vaultPath) return;
    store.setPendingMenuAction("open-search");
  };
  const searchEnabled = useCorePluginEnabled("search");
  const plannerEnabled = useCorePluginEnabled("planner");
  const exportEnabled = useCorePluginEnabled("export");

  return (
    <div className="flex min-h-0 flex-1 flex-col select-none">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8">
        <div className="text-center">
          <p className="text-sm text-text-secondary">
            {vaultPath
              ? noteCount > 0
                ? "Pick a note to start writing"
                : "Your vault is ready — create your first note"
              : "Open or create a vault to get started"}
          </p>
          {vaultPath && noteCount > 0 && (
            <p className="mt-1 text-[11px] text-text-muted">
              {noteCount} note{noteCount !== 1 ? "s" : ""} in vault · sidebar lists pinned and recent
            </p>
          )}
          {vaultPath && plannerSetupRequired && (
            <p className="mt-2 text-[11px] text-amber-400/90">
              Planner setup incomplete — open Planner or Settings → Planner to finish.
            </p>
          )}
        </div>

        {vaultPath && <EditorEmptyQuickNotes vaultPath={vaultPath} />}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {vaultPath ? (
            <>
              <EmptyAction label="Quick switcher" hint="⌘P" onClick={openPalette} />
              {searchEnabled && <EmptyAction label="Search vault" hint="⌘⇧F" onClick={openSearch} />}
              {plannerEnabled && <EmptyAction label="Planner" onClick={onOpenPlanner} />}
              {exportEnabled && <EmptyAction label="Export…" onClick={openExport} />}
              <EmptyAction label="Settings" hint="⌘," onClick={openSettings} />
            </>
          ) : (
            <>
              {onCreateVault && <EmptyAction label="Create vault" onClick={onCreateVault} />}
              {onOpenVault && <EmptyAction label="Open vault" onClick={onOpenVault} />}
              <EmptyAction label="Settings" hint="⌘," onClick={openSettings} />
            </>
          )}
        </div>

        <p className="max-w-md text-center text-xs text-text-muted opacity-70">
          {vaultPath
            ? "Notes auto-save after you edit. Pin favorites from the file tree context menu; recent notes appear in the sidebar."
            : "Vaults are local folders of markdown notes — nothing leaves your machine unless you use AI features."}
        </p>
      </div>
    </div>
  );
}
