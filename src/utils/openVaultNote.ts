import { cancelNoteAutosave } from "@/hooks/noteAutosave";
import { useStore } from "@/store/useStore";
import { appConfirm, toastError } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";
import { loadVaultFile } from "@/utils/vaultRead";

/** Ask before leaving a dirty note. Discard cancels a pending autosave. */
export async function confirmLeaveDirtyNote(): Promise<boolean> {
  const store = useStore.getState();
  if (!store.isDirty || !store.activeFilePath) return true;
  const discard = await appConfirm("You have unsaved changes. Discard and switch?", {
    title: "Unsaved changes",
    confirmLabel: "Discard",
    danger: true,
  });
  if (!discard) return false;
  cancelNoteAutosave(store.activeFilePath);
  store.markSaved();
  return true;
}

export { loadVaultFile, loadVaultFiles } from "@/utils/vaultRead";

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
  if (store.isDirty && store.activeFilePath && !(await confirmLeaveDirtyNote())) return false;
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
