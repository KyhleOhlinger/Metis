import { useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { FoldVertical, UnfoldVertical, Search } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, VaultData } from "../store/useStore";
import { usePersonaStore } from "../store/usePersonaStore";
import { moveNodeInTree } from "../utils/treeUtils";
import CreateVaultModal from "./CreateVaultModal";
import SearchPanel from "./SearchPanel";
import { isPinnedSpaceName } from "../constants/vaultSpaces";
import { toastError } from "../store/useToastStore";
import { dragSlot, setDragOverEl, findDropTarget } from "./sidebar/sidebarDragDrop";
import { ChevronLeft, ChevronRight, CollapsedBtn, ActionButton } from "./sidebar/sidebarIcons";
import { InlineInput } from "./sidebar/InlineInput";
import { todayString, openOrCreateDailyNote } from "./sidebar/dailyNote";
import { FileTreeNode } from "./sidebar/FileTreeNode";

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onForeignVault?: (path: string, hint?: string) => void;
}

export default function Sidebar({ isOpen, onToggle, onForeignVault }: SidebarProps) {
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
  // Passed to every FileTreeNode to bulk-expand or bulk-collapse all folders
  const [expandVersion, setExpandVersion] = useState<{ value: boolean } | null>(null);
  const allCollapsed = expandVersion?.value === false;

  // ── Consume native menu actions dispatched from the menu bar ─────────────
  useEffect(() => {
    if (!pendingMenuAction) return;
    // Always clear the action so the next dispatch is picked up cleanly
    setPendingMenuAction(null);
    switch (pendingMenuAction) {
      case "new-note":
        setRootCreating("note");
        break;
      case "new-folder":
        setRootCreating("folder");
        break;
      // "open-vault" is handled directly in useMenuEvents (multi-window logic)
      case "new-vault":
        setShowCreateVault(true);
        break;
    }
    // handleOpenVault is declared below; the linter warning is expected here
    // because the function is hoisted — it is safe to call it in this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMenuAction]);


  // ── Global pointer handlers for drag-and-drop ─────────────────────────────
  // Using pointer events (not HTML5 DnD) because WKWebView on macOS does not
  // reliably fire dragstart/drop on arbitrary div elements.
  useEffect(() => {
    const THRESHOLD = 5;

    const onMove = (e: PointerEvent) => {
      if (!dragSlot.drag) return;

      const dx = e.clientX - dragSlot.drag.startX;
      const dy = e.clientY - dragSlot.drag.startY;

      if (!dragSlot.drag.active) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        dragSlot.drag.active = true;
        e.preventDefault();
        document.body.style.cursor = "grabbing";
        // Disable text selection globally for the duration of the drag so
        // nothing gets highlighted as the pointer moves across the page.
        document.body.style.userSelect = "none";
      }

      // Update ghost position + label
      const ghost = document.getElementById("metis-drag-ghost");
      if (ghost) {
        ghost.style.left = `${e.clientX + 14}px`;
        ghost.style.top = `${e.clientY + 4}px`;
        ghost.style.opacity = "1";
        ghost.textContent = dragSlot.drag.label;
      }

      // Highlight drop target via direct DOM attr (no React re-render)
      const vp = useStore.getState().vaultPath ?? "";
      const target = findDropTarget(e.clientX, e.clientY, dragSlot.drag.srcPath, vp);
      setDragOverEl(target);
      if (dragSlot.drag.active) e.preventDefault();
    };

    const onUp = async (_e: PointerEvent) => {
      const drag = dragSlot.drag;
      dragSlot.drag = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      const ghost = document.getElementById("metis-drag-ghost");
      if (ghost) ghost.style.opacity = "0";

      const targetEl = document.querySelector("[data-drag-over]") as HTMLElement | null;
      setDragOverEl(null);

      if (!drag?.active || !targetEl) return;

      // ── Persona drop — trigger a scoped AI run instead of a file move ─────
      const personaId = (targetEl as HTMLElement).dataset.personaId;
      if (personaId) {
        const { setActivePersona, setPendingScope } = usePersonaStore.getState();
        // Switch to the target persona, then set the scope
        setActivePersona(personaId);
        if (drag.isDir) {
          setPendingScope({ type: "specific-folder", folderPath: drag.srcPath });
        } else {
          setPendingScope({ type: "specific-file", filePath: drag.srcPath });
        }
        return;
      }

      const { vaultPath, files, refreshVault } = useStore.getState();
      if (!vaultPath) return;

      // Specific folder node → use its path; tree container → vault root
      const destPath = targetEl.dataset.nodePath ?? vaultPath;
      if (destPath === drag.srcPath) return;

      // ── Optimistic update: move the node in-memory immediately ─────────────
      const newTree = moveNodeInTree(files, drag.srcPath, destPath, vaultPath);
      if (newTree) {
        useStore.setState({ files: newTree });
        // Update editor path if the open file was moved
        const ap = useStore.getState().activeFilePath;
        if (ap === drag.srcPath) {
          const newPath = destPath + "/" + drag.srcPath.split("/").pop()!;
          useStore.setState({ activeFilePath: newPath });
        }
      }

      // ── Persist to disk, then sync to get correct recursive paths ──────────
      try {
        await invoke("move_path", { src: drag.srcPath, destDir: destPath, vaultPath });
      } catch (err) {
        toastError(String(err));
      } finally {
        // Always re-sync to ensure paths are canonical
        await refreshVault();
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []); // stable — all state is read via getState() or module-level vars

  const handleOpenVault = async () => {
    // Use the Rust-side picker so the dialog is parented to THIS window —
    // the JS plugin-dialog open() attaches to the primary window on macOS,
    // which breaks folder selection in secondary (multi-vault) windows.
    const selected = await invoke<string | null>("pick_folder");
    if (!selected) return;

    // Skip if the user picked the vault already open in this window.
    if (selected === useStore.getState().vaultPath) return;

    // Always load the vault in the current window so the Metis-vault check
    // (and conversion modal if needed) is immediately visible to the user.
    // Multi-window opening is available via File → Open Vault in the menu bar.
    setLoading(true);
    try {
      const data = await invoke<VaultData>("open_vault", { path: selected });
      setVault(data);
      setActiveFolderPath(data.path);
      if (!data.is_metis_vault && onForeignVault) {
        onForeignVault(data.path, data.vault_hint);
      }
    } catch (err) {
      toastError(`Could not open vault: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // Header buttons always create at the vault ROOT — independent of which
  // folder is currently selected/active in the tree.
  const handleRootCreate = async (name: string) => {
    const type = rootCreating;
    setRootCreating(null);
    // Read vaultPath from store at call time so we never use a stale closure
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
    } catch (err) { toastError(String(err)); }
  };

  // ── Collapsed state — icon strip ────────────────────────────────────────────
  if (!isOpen) {
    return (
      <>
        {/* Ghost must always be in the DOM for drag-and-drop to work */}
        <div
          id="metis-drag-ghost"
          style={{ opacity: 0, pointerEvents: "none" }}
          className="fixed z-[9999] rounded-md border border-accent bg-surface-overlay px-2.5 py-1 text-xs text-text-primary shadow-lg transition-opacity"
        />

        <aside className="flex h-full w-8 flex-col items-center gap-0.5 bg-surface-raised py-2">
          {/* Expand */}
          <CollapsedBtn title="Expand sidebar" onClick={onToggle}>
            <ChevronRight />
          </CollapsedBtn>

          {/* Divider */}
          <div className="my-1 w-4 border-t border-border" />

          {/* Per-vault actions — only when a vault is open */}
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

              {/* Divider */}
              <div className="my-1 w-4 border-t border-border" />
            </>
          )}

          {/* Vault actions — always visible */}
          <CollapsedBtn title="Create new vault" onClick={() => setShowCreateVault(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </CollapsedBtn>
          <CollapsedBtn title="Open existing vault" onClick={handleOpenVault} disabled={loading}>
            {loading ? <span className="text-[10px]">…</span> : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            )}
          </CollapsedBtn>

          {/* Push planner control to the bottom of the strip */}
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
      {/* ── Drag ghost — label is written imperatively to avoid re-renders ─── */}
      <div
        id="metis-drag-ghost"
        style={{ opacity: 0, pointerEvents: "none" }}
        className="fixed z-[9999] rounded-md border border-accent bg-surface-overlay px-2.5 py-1 text-xs text-text-primary shadow-lg transition-opacity"
      />

      <aside className="flex h-full w-full flex-col bg-surface-raised">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="border-b border-border px-2 py-2">
          <div className="flex items-center justify-between">
            <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-text-muted max-w-[110px]">
              {vaultPath ? vaultPath.split("/").pop() : "No Vault"}
            </span>
            <div className="flex items-center gap-0.5">
              {/* Vault management — always first */}
              <ActionButton title="Create new vault" onClick={() => setShowCreateVault(true)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </ActionButton>
              <ActionButton title="Open existing vault" onClick={handleOpenVault} disabled={loading}>
                {loading ? <span className="text-[10px]">…</span> : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                )}
              </ActionButton>
              {vaultPath && (
                <>
                  <ActionButton title="New note" onClick={() => setRootCreating("note")}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                  </ActionButton>
                  <ActionButton title="New folder" onClick={() => setRootCreating("folder")}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                  </ActionButton>
                </>
              )}
              {/* Daily Note — calendar icon */}
              {vaultPath && (
                <ActionButton
                  title={`Open / create today's daily note (${todayString()})`}
                  onClick={() =>
                    openOrCreateDailyNote(vaultPath, setActiveFile, refreshVault)
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                    <line x1="8" y1="14" x2="8.01" y2="14" />
                    <line x1="12" y1="14" x2="12.01" y2="14" />
                    <line x1="16" y1="14" x2="16.01" y2="14" />
                  </svg>
                </ActionButton>
              )}
              {/* Search vault */}
              {vaultPath && (
                <ActionButton
                  title="Search vault (Cmd+Shift+F)"
                  onClick={() => setSidebarView(sidebarView === "search" ? "files" : "search")}
                  className={sidebarView === "search" ? "text-accent" : "text-text-muted"}
                >
                  <Search size={12} />
                </ActionButton>
              )}
              {/* Expand / collapse all folders */}
              {vaultPath && (
                <ActionButton
                  title={allCollapsed ? "Expand all folders" : "Collapse all folders"}
                  onClick={() => setExpandVersion({ value: allCollapsed })}
                >
                  {allCollapsed ? (
                    <UnfoldVertical size={12} />
                  ) : (
                    <FoldVertical size={12} />
                  )}
                </ActionButton>
              )}
              {/* Collapse sidebar button */}
              <button
                onClick={onToggle}
                title="Collapse sidebar"
                className="rounded p-1 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
              >
                <ChevronLeft />
              </button>
            </div>
          </div>
          {/* No context label — header buttons always target vault root */}
        </div>

        {/* ── File tree / Search panel ─────────────────────────────────── */}
        {sidebarView === "search" ? (
          <div className="flex-1 min-h-0">
            <SearchPanel />
          </div>
        ) : (
          <div id="metis-file-tree" className="flex-1 min-h-0 overflow-y-auto py-1">
            {rootCreating && vaultPath && (
              <InlineInput
                placeholder={rootCreating === "note" ? "note-name" : "folder-name"}
                onConfirm={handleRootCreate}
                onCancel={() => setRootCreating(null)}
                indent={0}
              />
            )}

            {files.length === 0 && !rootCreating ? (
              <div className="mt-8 flex flex-col items-center gap-2 px-4 text-center">
                <span className="text-2xl opacity-20">◈</span>
                <p className="text-[11px] text-text-muted">
                  {vaultPath ? "No markdown files yet." : "Open or create a vault to start."}
                </p>
                {!vaultPath && (
                  <div className="mt-1 flex flex-col gap-1.5 w-full">
                    <button onClick={() => setShowCreateVault(true)} className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors">
                      Create Vault
                    </button>
                    <button onClick={handleOpenVault} className="w-full rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors">
                      Open Vault
                    </button>
                  </div>
                )}
              </div>
            ) : (() => {
              const pinned = files.filter((n) => n.is_dir && isPinnedSpaceName(n.name));
              const rest = files.filter((n) => !(n.is_dir && isPinnedSpaceName(n.name)));
              return (
                <>
                  {pinned.length > 0 && (
                    <>
                      <div className="px-3 pt-2 pb-0.5">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted opacity-60">
                          Spaces
                        </span>
                      </div>
                      {pinned.map((node) => (
                        <FileTreeNode key={node.path} node={node} depth={0} vaultPath={vaultPath ?? ""} expandVersion={expandVersion} />
                      ))}
                      {rest.length > 0 && (
                        <div className="px-3 pt-3 pb-0.5">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted opacity-60">
                            Files
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {rest.map((node) => (
                    <FileTreeNode key={node.path} node={node} depth={0} vaultPath={vaultPath ?? ""} expandVersion={expandVersion} />
                  ))}
                </>
              );
            })()}
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="border-t border-border px-3 py-1.5">
          {vaultPath && (
            <button
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
