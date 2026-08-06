import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { moveNodeInTree } from "@/utils/treeUtils";
import { toastError, toastInfo } from "@/store/useToastStore";
import { dragSlot, setDragOverEl, findDropTarget } from "@/components/sidebar/sidebarDragDrop";

/** Global pointer handlers for sidebar file-tree drag-and-drop and persona drops. */
export function useSidebarDragDrop() {
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
        document.body.style.userSelect = "none";
      }

      const ghost = document.getElementById("metis-drag-ghost");
      if (ghost) {
        ghost.style.left = `${e.clientX + 14}px`;
        ghost.style.top = `${e.clientY + 4}px`;
        ghost.style.opacity = "1";
        ghost.textContent = dragSlot.drag.label;
      }

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

      const personaId = (targetEl as HTMLElement).dataset.personaId;
      if (personaId) {
        const { setActivePersona, setPendingScope } = usePersonaStore.getState();
        setActivePersona(personaId);
        if (drag.isDir) {
          setPendingScope({ type: "specific-folder", folderPath: drag.srcPath });
        } else {
          setPendingScope({ type: "specific-file", filePath: drag.srcPath });
        }
        toastInfo("Scope set — press ⌘↵ in the AI tab to run.");
        return;
      }

      const { vaultPath, files, refreshVault } = useStore.getState();
      if (!vaultPath) return;

      const destPath = targetEl.dataset.nodePath ?? vaultPath;
      if (destPath === drag.srcPath) return;

      const newTree = moveNodeInTree(files, drag.srcPath, destPath, vaultPath);
      if (newTree) {
        useStore.setState({ files: newTree });
        const ap = useStore.getState().activeFilePath;
        if (ap === drag.srcPath) {
          const newPath = destPath + "/" + drag.srcPath.split("/").pop()!;
          useStore.setState({ activeFilePath: newPath });
        }
      }

      try {
        await invoke("move_path", { src: drag.srcPath, destDir: destPath, vaultPath });
      } catch (err) {
        toastError(String(err));
      } finally {
        await refreshVault();
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);
}
