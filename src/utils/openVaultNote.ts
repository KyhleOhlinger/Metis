import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";

export async function loadVaultFile(path: string): Promise<string> {
  return invoke<string>("get_file_content", { path });
}

/**
 * Load a vault file and show it. Recent-note tracking happens inside setActiveFile.
 * Pass `content` when the caller already read the file (search match, new daily note).
 * `quiet` skips the toast so a caller can try another path.
 */
export async function openVaultNotePath(
  path: string,
  options?: { content?: string; quiet?: boolean },
): Promise<boolean> {
  const store = useStore.getState();
  try {
    const content = options?.content ?? (await loadVaultFile(path));
    store.setActiveFile(path, content);
    const parent = path.substring(0, path.lastIndexOf("/"));
    if (parent) store.setActiveFolderPath(parent);
    return true;
  } catch (err) {
    if (!options?.quiet) toastError(`Could not open note: ${formatError(err)}`);
    return false;
  }
}
