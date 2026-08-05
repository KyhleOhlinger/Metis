import { useState, useEffect, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { Image, Copy, FileDown, FileOutput } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, FileNode } from "../../store/useStore";
import { usePersonaStore, selectActivePersona } from "../../store/usePersonaStore";
import ContextMenu, { ContextMenuEntry } from "../ContextMenu";
import ConvertToJekyllModal from "../ConvertToJekyllModal";
import { collectImagePathsFromMarkdown } from "../../utils/noteImages";
import { exportNotesToPdf } from "../../services/pdfExportService";
import { isVaultImageFile } from "../../utils/vaultImages";
import { appConfirm, toastError, toastInfo, toastSuccess } from "../../store/useToastStore";
import { dragSlot } from "./sidebarDragDrop";
import { IconFile, IconFolder } from "./sidebarIcons";
import { InlineInput } from "./InlineInput";

// ── FileTreeNode ──────────────────────────────────────────────────────────────

export interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  vaultPath: string;
  /** When this object reference changes, all nodes snap to its `value`. */
  expandVersion?: { value: boolean } | null;
}

export function FileTreeNode({ node, depth, vaultPath, expandVersion }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);

  // Bulk expand / collapse triggered from the sidebar header button
  useEffect(() => {
    if (expandVersion != null) setExpanded(expandVersion.value);
  }, [expandVersion]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [creatingInside, setCreatingInside] = useState<"note" | "folder" | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [jekyllModalOpen, setJekyllModalOpen] = useState(false);

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
    if (dragSlot.drag?.active) return;

    if (node.is_dir) {
      setExpanded((p) => !p);
      setActiveFolderPath(node.path);
      return;
    }

    if (!isOpenable) return;

    const parent = node.path.substring(0, node.path.lastIndexOf("/"));
    setActiveFolderPath(parent || vaultPath);

    if (isDirty && activeFilePath) {
      const discard = await appConfirm("You have unsaved changes. Discard and switch?", {
        title: "Unsaved changes",
        confirmLabel: "Discard",
        danger: true,
      });
      if (!discard) return;
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
      toastError(`Could not open file: ${String(err)}`);
    }
  }, [node, isDirty, activeFilePath, markSaved, setActiveFile, setActiveFolderPath, vaultPath, isOpenable, isImage]);

  // ── Pointer-down: begin potential drag ─────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent) => {
    // Only primary button; ignore clicks on child buttons
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;

    dragSlot.drag = {
      srcPath: node.path,
      isDir: node.is_dir,
      label: node.name,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
            toastError(String(err));
          }
        },
      });
      items.push({
        label: "Export Folder PDF…",
        icon: <FileDown className="h-3.5 w-3.5" />,
        onClick: async () => {
          try {
            await exportNotesToPdf({ scope: "folder", folderPath: node.path });
          } catch (err) {
            toastError(String(err));
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
          toastError(String(e)),
        );
      },
    });

    // ── Copy Path ──────────────────────────────────────────────────────────
    items.push({
      label: "Copy Path",
      onClick: () => {
        navigator.clipboard.writeText(node.path).catch((err) =>
          toastError(`Could not copy path: ${String(err)}`),
        );
      },
    });

    if (isNote) {
      items.push({
        label: "Export…",
        icon: <FileDown className="h-3.5 w-3.5" />,
        onClick: () => useStore.getState().setPendingMenuAction("export-hub"),
      });
      items.push({
        label: "Export PDF…",
        icon: <FileDown className="h-3.5 w-3.5" />,
        onClick: async () => {
          try {
            await exportNotesToPdf({ scope: "file", filePath: node.path });
          } catch (err) {
            toastError(String(err));
          }
        },
      });
      items.push({
        label: "Convert to Jekyll…",
        icon: <FileOutput className="h-3.5 w-3.5" />,
        onClick: () => setJekyllModalOpen(true),
      });
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
              toastInfo("No local images found in this note.");
              return;
            }
            const destDir = await invoke<string | null>("pick_folder");
            if (!destDir) return;
            const copied = await invoke<number>("copy_files_to_folder", {
              sourcePaths: imagePaths,
              destDir,
            });
            toastSuccess(`Copied ${copied} image${copied === 1 ? "" : "s"}.`);
            await refreshVault();
          } catch (err) {
            toastError(String(err));
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
        if (
          !(await appConfirm(`Delete this ${label}? This cannot be undone.`, {
            title: "Delete",
            confirmLabel: "Delete",
            danger: true,
          }))
        ) {
          return;
        }
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
        } catch (err) { toastError(String(err)); }
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
    } catch (err) { toastError(String(err)); }
  };

  const handleRenameConfirm = async (newName: string) => {
    setIsRenaming(false);
    try {
      const newPath = await invoke<string>("rename_path", { path: node.path, newName });
      if (activeFilePath === node.path) useStore.setState({ activeFilePath: newPath });
      if (activeFolderPath === node.path) setActiveFolderPath(newPath);
      await refreshVault();
    } catch (err) { toastError(String(err)); }
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

      {jekyllModalOpen && (
        <ConvertToJekyllModal
          notePath={node.path}
          onClose={() => setJekyllModalOpen(false)}
        />
      )}
    </div>
  );
}
