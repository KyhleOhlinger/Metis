import { useState, useRef, useEffect, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { FoldVertical, UnfoldVertical, Search, Image, Copy } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, FileNode, VaultData } from "../store/useStore";
import { usePersonaStore, selectActivePersona } from "../store/usePersonaStore";
import { moveNodeInTree } from "../utils/treeUtils";
import ContextMenu, { ContextMenuEntry } from "./ContextMenu";
import CreateVaultModal from "./CreateVaultModal";
import SearchPanel from "./SearchPanel";
import { collectImagePathsFromMarkdown } from "../utils/noteImages";
import { isVaultImageFile } from "../utils/vaultImages";

// ── Daily Note helper ─────────────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD in local time. */
function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function openOrCreateDailyNote(
  vaultPath: string,
  setActiveFile: (path: string, content: string) => void,
  refreshVault: () => Promise<void>,
): Promise<void> {
  const date = todayString();
  const dailyDir = `${vaultPath}/daily`;
  const notePath = `${dailyDir}/${date}.md`;

  // Try to open an existing note first
  try {
    const content = await invoke<string>("get_file_content", { path: notePath });
    setActiveFile(notePath, content);
    return;
  } catch {
    // Not found — create it below
  }

  // Ensure the /daily directory exists (ignore "already exists" errors)
  try {
    await invoke("create_folder", { parentPath: vaultPath, name: "daily" });
  } catch {
    // Already exists — fine
  }

  // Create the daily note with a starter template
  const template = `# ${date}\n\n## Tasks\n- [ ] \n\n## Notes\n\n`;
  await invoke("save_note", { path: notePath, content: template });
  await refreshVault();
  setActiveFile(notePath, template);
}

// ── Drag state (module-level — avoids React re-renders during drag) ───────────

interface DragState {
  srcPath: string;
  isDir: boolean;
  label: string;
  startX: number;
  startY: number;
  active: boolean; // true once moved past threshold
}
let _drag: DragState | null = null;

function setDragOverEl(el: Element | null) {
  document.querySelectorAll("[data-drag-over]").forEach((e) =>
    e.removeAttribute("data-drag-over"),
  );
  el?.setAttribute("data-drag-over", "true");
}

function findDropTarget(x: number, y: number, srcPath: string, vaultPath: string): Element | null {
  // Temporarily hide the ghost so elementFromPoint sees what's underneath
  const ghost = document.getElementById("metis-drag-ghost");
  if (ghost) ghost.style.display = "none";
  const el = document.elementFromPoint(x, y);
  if (ghost) ghost.style.display = "";

  if (!el) return null;

  // 1. Persona chip in the CommandCenter — triggers a scoped AI run
  const personaEl = el.closest("[data-persona-id]") as HTMLElement | null;
  if (personaEl) return personaEl;

  // 2. Specific folder node — move the file/folder into it
  const folderEl = el.closest("[data-node-isdir='true']") as HTMLElement | null;
  if (folderEl) {
    const tPath = folderEl.dataset.nodePath ?? "";
    if (tPath === srcPath || tPath.startsWith(srcPath + "/")) return null;
    return folderEl;
  }

  // 3. Anywhere inside the file tree but not over a folder → vault root
  const tree = document.getElementById("metis-file-tree");
  if (tree && tree.contains(el)) {
    // Skip if the item is already at vault root (no-op move)
    const srcParent = srcPath.substring(0, srcPath.lastIndexOf("/"));
    if (srcParent === vaultPath) return null;
    return tree; // tree element represents the vault root drop zone
  }

  return null;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconFile({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function IconFolder({ open: isOpen, size = 12 }: { open: boolean; size?: number }) {
  return isOpen ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ── InlineInput ───────────────────────────────────────────────────────────────

interface InlineInputProps {
  initialValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  indent?: number;
}

function InlineInput({ initialValue = "", placeholder, onConfirm, onCancel, indent = 0 }: InlineInputProps) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    const dotIdx = initialValue.lastIndexOf(".");
    if (dotIdx > 0) ref.current?.setSelectionRange(0, dotIdx);
    else ref.current?.select();
  }, [initialValue]);

  const confirm = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
    else onCancel();
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <div style={{ paddingLeft: `${(indent + 1) * 12}px` }} className="pr-2 py-0.5">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); confirm(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        onBlur={confirm}
        className="w-full rounded border border-accent bg-surface-overlay px-2 py-0.5 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}

// ── FileTreeNode ──────────────────────────────────────────────────────────────

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  vaultPath: string;
  /** When this object reference changes, all nodes snap to its `value`. */
  expandVersion?: { value: boolean } | null;
}

function FileTreeNode({ node, depth, vaultPath, expandVersion }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);

  // Bulk expand / collapse triggered from the sidebar header button
  useEffect(() => {
    if (expandVersion != null) setExpanded(expandVersion.value);
  }, [expandVersion]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [creatingInside, setCreatingInside] = useState<"note" | "folder" | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const {
    activeFilePath, setActiveFile, isDirty, markSaved,
    refreshVault, activeFolderPath, setActiveFolderPath, noteIndex,
    assetIndex, defaultImageFolder, setDefaultImageFolder,
  } = useStore(
    useShallow((s) => ({
      activeFilePath: s.activeFilePath,
      setActiveFile: s.setActiveFile,
      isDirty: s.isDirty,
      markSaved: s.markSaved,
      refreshVault: s.refreshVault,
      activeFolderPath: s.activeFolderPath,
      setActiveFolderPath: s.setActiveFolderPath,
      noteIndex: s.noteIndex,
      assetIndex: s.assetIndex,
      defaultImageFolder: s.defaultImageFolder,
      setDefaultImageFolder: s.setDefaultImageFolder,
    })),
  );

  const activePersona = usePersonaStore(selectActivePersona);
  const setPendingScope = usePersonaStore((s) => s.setPendingScope);

  const isActiveFile   = activeFilePath === node.path;
  const isActiveFolder = activeFolderPath === node.path && node.is_dir;

  const isImage = !node.is_dir && isVaultImageFile(node.name);
  const isOpenable = !node.is_dir && (node.name.endsWith(".md") || isImage);

  // ── Open file / select folder ───────────────────────────────────────────────
  const handleClick = useCallback(async (_e: React.MouseEvent) => {
    // Don't open file if we were just dragging
    if (_drag?.active) return;

    if (node.is_dir) {
      setExpanded((p) => !p);
      setActiveFolderPath(node.path);
      return;
    }

    if (!isOpenable) return;

    const parent = node.path.substring(0, node.path.lastIndexOf("/"));
    setActiveFolderPath(parent || vaultPath);

    if (isDirty && activeFilePath) {
      if (!window.confirm("You have unsaved changes. Discard and switch?")) return;
      markSaved();
    }

    if (isImage) {
      setActiveFile(node.path, "");
      return;
    }

    try {
      const content = await invoke<string>("get_file_content", { path: node.path });
      setActiveFile(node.path, content);
    } catch (err) {
      console.error("Failed to read file:", err);
    }
  }, [node, isDirty, activeFilePath, markSaved, setActiveFile, setActiveFolderPath, vaultPath, isOpenable, isImage]);

  // ── Pointer-down: begin potential drag ─────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent) => {
    // Only primary button; ignore clicks on child buttons
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;

    // Prevent the browser's native text-selection / image-drag behaviour so the
    // custom pointer-based drag takes over cleanly.
    e.preventDefault();

    _drag = {
      srcPath: node.path,
      isDir: node.is_dir,
      label: node.name,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  };

  // ── Context menu ────────────────────────────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const isNote = !node.is_dir && node.name.endsWith(".md");

  const vaultRelativePath =
    node.path.startsWith(`${vaultPath}/`) ? node.path.slice(vaultPath.length + 1) : node.name;

  const buildMenu = (): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [];

    // ── Folder-only: create actions ──────────────────────────────────────────
    if (node.is_dir) {
      items.push({
        label: "New Note Here",
        icon: <IconFile />,
        onClick: () => { setExpanded(true); setCreatingInside("note"); },
      });
      items.push({
        label: "New Folder Here",
        icon: <IconFolder open={false} />,
        onClick: () => { setExpanded(true); setCreatingInside("folder"); },
      });
      items.push({
        label:
          defaultImageFolder === vaultRelativePath
            ? "Default Image Folder ✓"
            : "Set as Default Image Folder",
        icon: <Image className="h-3.5 w-3.5" />,
        disabled: defaultImageFolder === vaultRelativePath,
        onClick: async () => {
          try {
            await setDefaultImageFolder(vaultRelativePath);
          } catch (err) {
            alert(String(err));
          }
        },
      });
      items.push({ separator: true });
    }

    // ── Common: rename ────────────────────────────────────────────────────────
    if (isNote || node.is_dir) {
      items.push({ label: "Rename", onClick: () => setIsRenaming(true) });
    }

    // ── Reveal in system file manager ─────────────────────────────────────────
    items.push({
      label: "Reveal in Finder",
      onClick: () => {
        invoke("reveal_in_finder", { path: node.path, vaultPath }).catch((e) =>
          alert(String(e)),
        );
      },
    });

    // ── Copy Path ──────────────────────────────────────────────────────────
    items.push({
      label: "Copy Path",
      onClick: () => {
        navigator.clipboard.writeText(node.path).catch(console.error);
      },
    });

    if (isNote) {
      items.push({
        label: "Copy Images to Folder…",
        icon: <Copy className="h-3.5 w-3.5" />,
        onClick: async () => {
          try {
            const content = await invoke<string>("get_file_content", { path: node.path });
            const imagePaths = collectImagePathsFromMarkdown(
              content,
              node.path,
              vaultPath,
              assetIndex,
            );
            if (!imagePaths.length) {
              alert("No local images found in this note.");
              return;
            }
            const destDir = await invoke<string | null>("pick_folder");
            if (!destDir) return;
            const copied = await invoke<number>("copy_files_to_folder", {
              sourcePaths: imagePaths,
              destDir,
            });
            alert(`Copied ${copied} image${copied === 1 ? "" : "s"}.`);
            await refreshVault();
          } catch (err) {
            alert(String(err));
          }
        },
      });
    }

    // ── AI: Run with active persona ───────────────────────────────────────────
    if (activePersona) {
      items.push({ separator: true });
      items.push({
        label: `Run with ${activePersona.icon} ${activePersona.name}`,
        onClick: () => {
          if (node.is_dir) {
            setPendingScope({ type: "specific-folder", folderPath: node.path });
          } else {
            // Scope to current-file; user's active file should already be
            // this node (or will be once they click it)
            setPendingScope({ type: "current-file" });
          }
        },
      });
    }

    // ── Danger zone ───────────────────────────────────────────────────────────
    items.push({ separator: true });
    items.push({
      label: node.is_dir ? "Delete Folder" : `Delete ${isNote ? "Note" : "File"}`,
      danger: true,
      onClick: async () => {
        const label = node.is_dir
          ? "folder and all its contents"
          : isNote
            ? "note"
            : "file";
        if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
        try {
          await invoke("delete_path", { path: node.path, vaultPath });
          if (
            activeFilePath === node.path ||
            activeFilePath?.startsWith(node.path + "/")
          ) {
            useStore.setState({ activeFilePath: null, activeFileContent: "", isDirty: false });
          }
          if (
            activeFolderPath === node.path ||
            activeFolderPath?.startsWith(node.path + "/")
          ) {
            setActiveFolderPath(vaultPath);
          }
          await refreshVault();
        } catch (err) { alert(String(err)); }
      },
    });

    return items;
  };

  const handleCreateConfirm = async (name: string) => {
    const type = creatingInside;
    setCreatingInside(null);
    try {
      if (type === "note") {
        const newPath = await invoke<string>("create_note", { dirPath: node.path, name });
        await refreshVault();
        const content = await invoke<string>("get_file_content", { path: newPath });
        setActiveFile(newPath, content);
        setActiveFolderPath(node.path);
      } else if (type === "folder") {
        await invoke<string>("create_folder", { parentPath: node.path, name });
        await refreshVault();
        setActiveFolderPath(node.path + "/" + name);
      }
    } catch (err) { alert(String(err)); }
  };

  const handleRenameConfirm = async (newName: string) => {
    setIsRenaming(false);
    try {
      const newPath = await invoke<string>("rename_path", { path: node.path, newName });
      if (activeFilePath === node.path) useStore.setState({ activeFilePath: newPath });
      if (activeFolderPath === node.path) setActiveFolderPath(newPath);
      await refreshVault();
    } catch (err) { alert(String(err)); }
  };

  const paddingLeft = `${(depth + 1) * 12}px`;

  return (
    <div>
      {isRenaming ? (
        <InlineInput
          initialValue={node.name}
          onConfirm={handleRenameConfirm}
          onCancel={() => setIsRenaming(false)}
          indent={depth}
        />
      ) : (
        <div
          data-node-path={node.path}
          data-node-isdir={node.is_dir ? "true" : undefined}
          style={{ paddingLeft }}
          onPointerDown={handlePointerDown}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          className={[
            `group flex items-center gap-1.5 pr-1 py-[3px] rounded-sm select-none transition-colors ${node.is_dir || isOpenable ? "cursor-pointer" : "cursor-default"}`,
            isActiveFile
              ? "bg-accent-muted text-text-primary"
              : isActiveFolder
              ? "border-l-2 border-accent bg-surface-overlay text-text-primary"
              : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary",
          ].join(" ")}
        >
          {node.is_dir ? (
            // Dedicated chevron button — toggles expand without selecting the folder
            <button
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
              className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"
            >
              <svg
                width="11" height="11" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 150ms ease" }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ) : (
            <span className="w-[15px] shrink-0" />
          )}
          {(() => {
            // Colour the file icon to reflect the note's status field from noteIndex.
            const STATUS_ICON_COLORS: Record<string, string> = {
              "draft":       "text-text-muted",
              "in-progress": "text-blue-400",
              "review":      "text-yellow-400",
              "done":        "text-green-400",
              "archived":    "text-text-muted opacity-50",
            };
            const status = !node.is_dir
              ? noteIndex.find((n) => n.path === node.path)?.status
              : undefined;
            const iconColor = status ? (STATUS_ICON_COLORS[status] ?? "text-text-muted") : "text-text-muted";
            return (
              <span className={`shrink-0 ${iconColor}`}>
                {node.is_dir ? (
                  <IconFolder open={expanded} size={11} />
                ) : isImage ? (
                  <Image size={11} />
                ) : (
                  <IconFile size={11} />
                )}
              </span>
            );
          })()}
          <span className="flex-1 truncate text-xs">{node.name}</span>

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
            {/* Run active persona on this file / folder */}
            {activePersona && (
              <button
                title={`Run ${activePersona.icon} ${activePersona.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (node.is_dir) {
                    setPendingScope({ type: "specific-folder", folderPath: node.path });
                  } else {
                    setPendingScope({ type: "current-file" });
                  }
                }}
                className="rounded p-0.5 text-text-muted hover:bg-surface-raised hover:text-accent transition-colors"
              >
                {/* Lightning bolt / spark icon */}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M13 2L4.5 13.5H11L10 22L19.5 10.5H13L13 2Z" />
                </svg>
              </button>
            )}
            {node.is_dir && (
              <button
                title="New note inside"
                onClick={(e) => { e.stopPropagation(); setExpanded(true); setCreatingInside("note"); }}
                className="rounded p-0.5 hover:bg-surface-raised hover:text-accent"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            <button
              title="More actions"
              onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
              className="rounded p-0.5 hover:bg-surface-raised hover:text-text-primary"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {node.is_dir && expanded && creatingInside && (
        <InlineInput
          placeholder={creatingInside === "note" ? "note-name" : "folder-name"}
          onConfirm={handleCreateConfirm}
          onCancel={() => setCreatingInside(null)}
          indent={depth + 1}
        />
      )}

      {node.is_dir && expanded && node.children && (
        <div>
          {[...node.children]
            // Pin todo.md to the top of whichever folder it lives in
            .sort((a, b) => {
              if (a.name.toLowerCase() === "todo.md") return -1;
              if (b.name.toLowerCase() === "todo.md") return  1;
              return 0;
            })
            .map((child) => (
              <FileTreeNode key={child.path} node={child} depth={depth + 1} vaultPath={vaultPath} expandVersion={expandVersion} />
            ))}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenu()}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

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
    editorTab, setEditorTab,
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
      setEditorTab: s.setEditorTab,
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
      if (!_drag) return;

      const dx = e.clientX - _drag.startX;
      const dy = e.clientY - _drag.startY;

      if (!_drag.active) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        _drag.active = true;
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
        ghost.textContent = _drag.label;
      }

      // Highlight drop target via direct DOM attr (no React re-render)
      const vp = useStore.getState().vaultPath ?? "";
      const target = findDropTarget(e.clientX, e.clientY, _drag.srcPath, vp);
      setDragOverEl(target);
    };

    const onUp = async (_e: PointerEvent) => {
      const drag = _drag;
      _drag = null;
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
        alert(String(err));
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
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
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
    } catch (err) { alert(String(err)); }
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
              onClick={() => setEditorTab("planner")}
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
              const PINNED_NAMES = ["daily", "meetings", "summaries", "assets"];
              const pinned = files.filter(n => n.is_dir && PINNED_NAMES.includes(n.name.toLowerCase()));
              const rest    = files.filter(n => !(n.is_dir && PINNED_NAMES.includes(n.name.toLowerCase())));
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
              onClick={() => setEditorTab("planner")}
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

// ── Chevron icons ─────────────────────────────────────────────────────────────

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ── CollapsedBtn — icon button used in the slim collapsed strip ───────────────

function CollapsedBtn({ children, title, onClick, disabled, className }: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-1.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary disabled:opacity-40 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

// ── ActionButton ──────────────────────────────────────────────────────────────

function ActionButton({ children, title, onClick, disabled, className }: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={`rounded p-1 transition-colors hover:bg-surface-overlay hover:text-text-primary disabled:opacity-40 ${className ?? "text-text-muted"}`}>
      {children}
    </button>
  );
}
