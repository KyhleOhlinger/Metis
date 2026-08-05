// ── Drag state (module-level — avoids React re-renders during drag) ───────────

export interface DragState {
  srcPath: string;
  isDir: boolean;
  label: string;
  startX: number;
  startY: number;
  active: boolean; // true once moved past threshold
}
/** Mutable drag slot — object wrapper so importers can assign without rebinding imports. */
export const dragSlot = { drag: null as DragState | null };

export function setDragOverEl(el: Element | null) {
  document.querySelectorAll("[data-drag-over]").forEach((e) =>
    e.removeAttribute("data-drag-over"),
  );
  el?.setAttribute("data-drag-over", "true");
}

export function findDropTarget(x: number, y: number, srcPath: string, vaultPath: string): Element | null {
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
