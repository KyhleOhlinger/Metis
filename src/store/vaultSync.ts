import { invoke } from "@tauri-apps/api/core";
import { pathsEqual } from "../utils/paths";
import type { DiskWrite } from "./vaultTypes";
import { useStore } from "./useStore";

/**
 * Refresh the vault tree and push new content into the open editor / visual
 * preview when a written file is currently active.
 */
export async function syncUiAfterDiskWrites(
  writes: DiskWrite[],
  options?: { openPath?: string },
): Promise<void> {
  const { activeFilePath, setActiveFile, refreshVault } = useStore.getState();
  await refreshVault();

  const openPath = options?.openPath;
  if (openPath) {
    const match = writes.find((w) => pathsEqual(w.path, openPath));
    const content =
      match?.content ?? (await invoke<string>("get_file_content", { path: openPath }));
    setActiveFile(openPath, content);
    return;
  }

  if (!activeFilePath) return;
  const activeWrite = writes.find((w) => pathsEqual(w.path, activeFilePath));
  if (!activeWrite) return;

  const content =
    activeWrite.content ??
    (await invoke<string>("get_file_content", { path: activeFilePath }));
  setActiveFile(activeFilePath, content);
}
