import type { FileNode } from "@/store/useStore";
import { isPinnedSpaceName } from "@/constants/vaultSpaces";
import { InlineInput } from "./InlineInput";
import { FileTreeNode } from "./FileTreeNode";
import { SidebarQuickNotes } from "./SidebarQuickNotes";
import { isSupernoteNoteFile } from "@/constants/supernote";

interface SidebarFileTreePanelProps {
  vaultPath: string | null;
  files: FileNode[];
  vaultRestoring?: boolean;
  rootCreating: "note" | "folder" | null;
  expandVersion: { value: boolean } | null;
  onRootCreate: (name: string) => void;
  onCancelRootCreate: () => void;
  onCreateVault: () => void;
  onOpenVault: () => void;
}

export function SidebarFileTreePanel({
  vaultPath,
  files,
  vaultRestoring,
  rootCreating,
  expandVersion,
  onRootCreate,
  onCancelRootCreate,
  onCreateVault,
  onOpenVault,
}: SidebarFileTreePanelProps) {
  return (
    <div id="metis-file-tree" className="relative flex-1 min-h-0 overflow-y-auto py-1">
      {vaultRestoring && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised/80 backdrop-blur-[1px]">
          <p className="text-[11px] text-text-muted">Restoring vault…</p>
        </div>
      )}
      {rootCreating && vaultPath && (
        <InlineInput
          placeholder={rootCreating === "note" ? "note-name" : "folder-name"}
          onConfirm={onRootCreate}
          onCancel={onCancelRootCreate}
          indent={0}
        />
      )}

      {vaultPath && <SidebarQuickNotes vaultPath={vaultPath} />}

      {files.length === 0 && !rootCreating ? (
        <div className="mt-6 flex flex-col items-center gap-3 px-4 text-center">
          <span className="text-2xl opacity-20">◈</span>
          {vaultPath ? (
            <>
              <p className="text-[11px] font-medium text-text-secondary">This vault has no notes yet</p>
              <p className="max-w-[14rem] text-[10px] leading-relaxed text-text-muted">
                Create a note from the toolbar above, press{" "}
                <span className="font-mono text-text-secondary">⌘P</span> to quick-switch, or open
                Planner from the footer.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-text-muted">Open or create a vault to start.</p>
              <div className="mt-1 flex w-full flex-col gap-1.5">
              <button
                type="button"
                onClick={onCreateVault}
                className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover"
              >
                Create Vault
              </button>
              <button
                type="button"
                onClick={onOpenVault}
                className="w-full rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary"
              >
                Open Vault
              </button>
            </div>
            </>
          )}
        </div>
      ) : (
        <FileTreeSections
          files={files}
          vaultPath={vaultPath ?? ""}
          expandVersion={expandVersion}
        />
      )}
    </div>
  );
}

function FileTreeSections({
  files,
  vaultPath,
  expandVersion,
}: {
  files: FileNode[];
  vaultPath: string;
  expandVersion: { value: boolean } | null;
}) {
  const pinned = files.filter((n) => n.is_dir && isPinnedSpaceName(n.name));
  const rest = files.filter(
    (n) =>
      !(n.is_dir && isPinnedSpaceName(n.name)) &&
      (n.is_dir || !isSupernoteNoteFile(n.name)),
  );

  return (
    <>
      {pinned.length > 0 && (
        <>
          <div className="px-3 pb-0.5 pt-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted opacity-60">
              Spaces
            </span>
          </div>
          {pinned.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              vaultPath={vaultPath}
              expandVersion={expandVersion}
            />
          ))}
          {rest.length > 0 && (
            <div className="px-3 pb-0.5 pt-3">
              <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted opacity-60">
                Files
              </span>
            </div>
          )}
        </>
      )}
      {rest.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          vaultPath={vaultPath}
          expandVersion={expandVersion}
        />
      ))}
    </>
  );
}
