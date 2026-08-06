import { useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import { useStore, VaultData } from "../store/useStore";
import CreateVaultModal from "./CreateVaultModal";
import SearchPanel from "./SearchPanel";
import { toastError } from "../store/useToastStore";
import { formatError } from "../utils/formatError";
import { ChevronRight, CollapsedBtn } from "./sidebar/sidebarIcons";
import { todayString, openOrCreateDailyNote } from "./sidebar/dailyNote";
import { SidebarExpandedHeader } from "./sidebar/SidebarExpandedHeader";
import { SidebarFileTreePanel } from "./sidebar/SidebarFileTreePanel";
import { useSidebarDragDrop } from "../hooks/useSidebarDragDrop";

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onForeignVault?: (path: string, hint?: string) => void;
  vaultRestoring?: boolean;
}

function DragGhost() {
  return (
    <div
      id="metis-drag-ghost"
      style={{ opacity: 0, pointerEvents: "none" }}
      className="fixed z-[9999] rounded-md border border-accent bg-surface-overlay px-2.5 py-1 text-xs text-text-primary shadow-lg transition-opacity"
    />
  );
}

export default function Sidebar({ isOpen, onToggle, onForeignVault, vaultRestoring }: SidebarProps) {
  const {
    vaultPath, files, setVault, activeFilePath, isDirty,
    refreshVault, setActiveFolderPath, setActiveFile,
    pendingMenuAction, setPendingMenuAction,
    sidebarView, setSidebarView,
    editorTab, openPlannerTab,
  } = useStore(
    useShallow((s) => ({
      vaultPath: s.vaultPath,
      files: s.files,
      setVault: s.setVault,
      activeFilePath: s.activeFilePath,
      isDirty: s.isDirty,
      refreshVault: s.refreshVault,
      setActiveFolderPath: s.setActiveFolderPath,
      setActiveFile: s.setActiveFile,
      pendingMenuAction: s.pendingMenuAction,
      setPendingMenuAction: s.setPendingMenuAction,
      sidebarView: s.sidebarView,
      setSidebarView: s.setSidebarView,
      editorTab: s.editorTab,
      openPlannerTab: s.openPlannerTab,
    })),
  );

  const [loading, setLoading] = useState(false);
  const [showCreateVault, setShowCreateVault] = useState(false);
  const [rootCreating, setRootCreating] = useState<"note" | "folder" | null>(null);
  const [expandVersion, setExpandVersion] = useState<{ value: boolean } | null>(null);
  const allCollapsed = expandVersion?.value === false;

  useSidebarDragDrop();

  useEffect(() => {
    if (!pendingMenuAction) return;
    setPendingMenuAction(null);
    switch (pendingMenuAction) {
      case "new-note":
        setRootCreating("note");
        break;
      case "new-folder":
        setRootCreating("folder");
        break;
      case "new-vault":
        setShowCreateVault(true);
        break;
      case "open-vault-picker":
        void handleOpenVault();
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMenuAction]);

  const handleOpenVault = async () => {
    const selected = await invoke<string | null>("pick_folder");
    if (!selected) return;
    if (selected === useStore.getState().vaultPath) return;

    setLoading(true);
    try {
      const data = await invoke<VaultData>("open_vault", { path: selected });
      setVault(data);
      setActiveFolderPath(data.path);
      if (!data.is_metis_vault && onForeignVault) {
        onForeignVault(data.path, data.vault_hint);
      }
    } catch (err) {
      toastError(`Could not open vault: ${formatError(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRootCreate = async (name: string) => {
    const type = rootCreating;
    setRootCreating(null);
    const root = useStore.getState().vaultPath;
    if (!root) return;
    try {
      if (type === "note") {
        const newPath = await invoke<string>("create_note", { dirPath: root, name });
        await refreshVault();
        const content = await invoke<string>("get_file_content", { path: newPath });
        useStore.setState({ activeFilePath: newPath, activeFileContent: content, isDirty: false });
      } else {
        await invoke<string>("create_folder", { parentPath: root, name });
        await refreshVault();
      }
    } catch (err) {
      toastError(formatError(err));
    }
  };

  if (!isOpen) {
    return (
      <>
        <DragGhost />
        <aside className="flex h-full w-8 flex-col items-center gap-0.5 bg-surface-raised py-2">
          <CollapsedBtn title="Expand sidebar" onClick={onToggle}>
            <ChevronRight />
          </CollapsedBtn>
          <div className="my-1 w-4 border-t border-border" />
          {vaultPath && (
            <>
              <CollapsedBtn title="New note" onClick={() => { onToggle(); setTimeout(() => setRootCreating("note"), 210); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                </svg>
              </CollapsedBtn>
              <CollapsedBtn title="New folder" onClick={() => { onToggle(); setTimeout(() => setRootCreating("folder"), 210); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                </svg>
              </CollapsedBtn>
              <CollapsedBtn
                title={`Daily note (${todayString()})`}
                onClick={() => openOrCreateDailyNote(vaultPath, setActiveFile, refreshVault)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  <line x1="8" y1="14" x2="8.01" y2="14" /><line x1="12" y1="14" x2="12.01" y2="14" /><line x1="16" y1="14" x2="16.01" y2="14" />
                </svg>
              </CollapsedBtn>
              <div className="my-1 w-4 border-t border-border" />
            </>
          )}
          <CollapsedBtn title="Create new vault" onClick={() => setShowCreateVault(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </CollapsedBtn>
          <CollapsedBtn title="Open existing vault" onClick={() => void handleOpenVault()} disabled={loading}>
            {loading ? <span className="text-[10px]">…</span> : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            )}
          </CollapsedBtn>
          <div className="mt-auto" />
          {vaultPath && (
            <CollapsedBtn
              title="Open Planner"
              onClick={() => openPlannerTab()}
              className={
                editorTab === "planner"
                  ? "bg-accent text-white shadow-sm shadow-accent/40 ring-1 ring-accent/60"
                  : "bg-accent/85 text-white hover:bg-accent"
              }
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <line x1="8" y1="14" x2="16" y2="14" />
                <line x1="8" y1="18" x2="13" y2="18" />
              </svg>
            </CollapsedBtn>
          )}
        </aside>
        {showCreateVault && <CreateVaultModal onClose={() => setShowCreateVault(false)} />}
      </>
    );
  }

  return (
    <>
      <DragGhost />
      <aside className="flex h-full w-full flex-col bg-surface-raised">
        <SidebarExpandedHeader
          vaultPath={vaultPath}
          loading={loading}
          sidebarView={sidebarView}
          allCollapsed={allCollapsed}
          onCreateVault={() => setShowCreateVault(true)}
          onOpenVault={() => void handleOpenVault()}
          onNewNote={() => setRootCreating("note")}
          onNewFolder={() => setRootCreating("folder")}
          onDailyNote={() => openOrCreateDailyNote(vaultPath!, setActiveFile, refreshVault)}
          onToggleSearch={() => setSidebarView(sidebarView === "search" ? "files" : "search")}
          onToggleExpandAll={() => setExpandVersion({ value: allCollapsed })}
          onCollapseSidebar={onToggle}
        />

        {sidebarView === "search" ? (
          <div className="min-h-0 flex-1">
            <SearchPanel />
          </div>
        ) : (
          <SidebarFileTreePanel
            vaultPath={vaultPath}
            files={files}
            vaultRestoring={vaultRestoring}
            rootCreating={rootCreating}
            expandVersion={expandVersion}
            onRootCreate={handleRootCreate}
            onCancelRootCreate={() => setRootCreating(null)}
            onCreateVault={() => setShowCreateVault(true)}
            onOpenVault={() => void handleOpenVault()}
          />
        )}

        <div className="border-t border-border px-3 py-1.5">
          {vaultPath && (
            <button
              type="button"
              onClick={() => openPlannerTab()}
              className={[
                "mb-1.5 w-full rounded border px-2 py-1 text-[10px] font-semibold transition-colors",
                editorTab === "planner"
                  ? "border-accent/70 bg-accent text-white shadow-sm shadow-accent/30"
                  : "border-accent/50 bg-accent/90 text-white hover:bg-accent",
              ].join(" ")}
              title="Open Planner"
            >
              Planner ✦
            </button>
          )}
          {activeFilePath && (
            <p className="truncate text-[10px] text-text-muted">
              {isDirty && <span className="mr-1 text-accent">●</span>}
              {activeFilePath.split("/").pop()}
            </p>
          )}
        </div>
      </aside>

      {showCreateVault && <CreateVaultModal onClose={() => setShowCreateVault(false)} />}
    </>
  );
}
