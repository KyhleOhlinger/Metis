import { rememberNoteDiskStamp } from "../hooks/noteAutosave";
import { pathsEqual } from "../utils/paths";
import { loadVaultFile } from "../utils/vaultRead";
import type { DiskWrite } from "./vaultTypes";
import { useStore } from "./useStore";
import { invoke } from "@tauri-apps/api/core";

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
      match?.content ?? (await loadVaultFile(openPath));
    setActiveFile(openPath, content);
    await stampOpenNote(openPath, content);
    return;
  }

  if (!activeFilePath) return;
  const activeWrite = writes.find((w) => pathsEqual(w.path, activeFilePath));
  if (!activeWrite) return;

  const content =
    activeWrite.content ??
    (await loadVaultFile(activeFilePath));
  setActiveFile(activeFilePath, content);
  await stampOpenNote(activeFilePath, content);
}

async function stampOpenNote(path: string, content: string): Promise<void> {
  if (!path.toLowerCase().endsWith(".md")) return;
  try {
    const stamp = await invoke<number>("note_file_stamp", { path });
    rememberNoteDiskStamp(path, stamp, content);
  } catch {
    rememberNoteDiskStamp(path, Date.now(), content);
  }
}
