import { usePersonaStore } from "@/store/usePersonaStore";
import { useStore } from "@/store/useStore";

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
  onOpenAgentHistory: () => void;
  onOpenVault?: () => void;
  onCreateVault?: () => void;
}

export function EditorEmptyState({
  vaultPath,
  onOpenPlanner,
  onOpenAgentHistory,
  onOpenVault,
  onCreateVault,
}: EditorEmptyStateProps) {
  const openSettings = () => usePersonaStore.getState().openSettings();
  const openPalette = () => useStore.getState().setPendingMenuAction("open-palette");
  const openExport = () => useStore.getState().setPendingMenuAction("export-hub");
  const openSearch = () => {
    const store = useStore.getState();
    if (!store.vaultPath) return;
    store.setSidebarView("search");
  };

  return (
    <div className="flex h-full flex-col bg-surface-base select-none">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-raised/70 px-4 py-1.5 backdrop-blur-sm">
        <span className="text-xs text-text-muted">No note open</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-text-secondary">
          {vaultPath ? "Open a note to start writing" : "Open or create a vault to get started"}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {vaultPath ? (
            <>
              <EmptyAction label="Quick switcher" hint="⌘P" onClick={openPalette} />
              <EmptyAction label="Search vault" hint="⌘⇧F" onClick={openSearch} />
              <EmptyAction label="Planner" onClick={onOpenPlanner} />
              <EmptyAction label="Run log" onClick={onOpenAgentHistory} />
              <EmptyAction label="Export…" onClick={openExport} />
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
        <p className="max-w-sm text-center text-xs text-text-muted opacity-70">
          {vaultPath
            ? "Notes auto-save after you edit. Use the sidebar or ⌘P to browse your vault."
            : "Vaults are local folders of markdown notes — nothing leaves your machine unless you use AI features."}
        </p>
      </div>
    </div>
  );
}
