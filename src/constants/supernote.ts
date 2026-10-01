import { HANDWRITTEN_SPACE } from "./vaultSpaces";

export const SUPERNOTE_SPACE = HANDWRITTEN_SPACE;
export const SUPERNOTE_FOLDER = "Supernote";
export const SUPERNOTE_RELATIVE_DIR = `${SUPERNOTE_SPACE}/${SUPERNOTE_FOLDER}`;
export const SUPERNOTE_DEFAULT_PORT = 8089;
export const SUPERNOTE_DEFAULT_INTERVAL_MIN = 15;

export function isSupernoteNoteFile(nameOrPath: string): boolean {
  return nameOrPath.toLowerCase().endsWith(".note");
}

export function isHandwrittenSpaceNode(name: string, depth: number): boolean {
  return depth === 0 && name.toLowerCase() === SUPERNOTE_SPACE;
}

/** Sync control lives on `handwritten/Supernote/`, not the handwritten Space. */
export function isSupernoteSyncFolderNode(name: string, nodePath: string, vaultPath: string): boolean {
  if (name.toLowerCase() !== SUPERNOTE_FOLDER.toLowerCase()) return false;
  const path = nodePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const expected = `${vaultPath.replace(/\\/g, "/").replace(/\/+$/, "")}/${SUPERNOTE_RELATIVE_DIR}`;
  return path === expected || path.toLowerCase().endsWith(`/${SUPERNOTE_RELATIVE_DIR.toLowerCase()}`);
}

export const SUPERNOTE_FILES_CHANGED_EVENT = "metis:supernote-files-changed";

/** Tell open pagers to drop raster cache after a Nomad pull. */
export function notifySupernoteFilesChanged(): void {
  window.dispatchEvent(new Event(SUPERNOTE_FILES_CHANGED_EVENT));
}

export function onSupernoteFilesChanged(callback: () => void): () => void {
  window.addEventListener(SUPERNOTE_FILES_CHANGED_EVENT, callback);
  return () => window.removeEventListener(SUPERNOTE_FILES_CHANGED_EVENT, callback);
}
