import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";

/** Open a vault note by absolute path (loads content from disk). */
export async function openVaultNotePath(path: string): Promise<void> {
  const store = useStore.getState();
  if (!path.toLowerCase().endsWith(".md")) return;

  try {
    const content = await invoke<string>("get_file_content", { path });
    store.setActiveFile(path, content);
    const parent = path.substring(0, path.lastIndexOf("/"));
    if (parent) store.setActiveFolderPath(parent);
  } catch (err) {
    toastError(`Could not open note: ${String(err)}`);
  }
}
