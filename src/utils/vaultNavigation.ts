import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store/useStore";
import type { NoteMetadata } from "../store/useStore";
import { normalizePosixPath, pathsEqual } from "./paths";

export function findNoteByWikilinkName(
  rawName: string,
  noteIndex: NoteMetadata[],
): NoteMetadata | undefined {
  const name = decodeURIComponent(rawName).trim();
  const stem = name.replace(/\.md$/i, "").toLowerCase();
  return noteIndex.find(
    (n) =>
      n.name === name ||
      n.name.toLowerCase() === name.toLowerCase() ||
      n.name.replace(/\.md$/i, "").toLowerCase() === stem,
  );
}

export function openNoteByWikilinkName(
  rawName: string,
  noteIndex: NoteMetadata[],
  setActiveFile: (path: string, content: string) => void,
): void {
  const note = findNoteByWikilinkName(rawName, noteIndex);
  if (!note) return;
  invoke<string>("get_file_content", { path: note.path })
    .then((c) => setActiveFile(note.path, c))
    .catch(console.error);
}

export function openNoteByWikilinkNameFromStore(rawName: string): void {
  const { noteIndex, setActiveFile } = useStore.getState();
  openNoteByWikilinkName(rawName, noteIndex, setActiveFile);
}

export function revealPlatformLabel(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
    ? "Reveal in Finder"
    : "Reveal in File Explorer";
}

export type FollowVaultHrefOptions = {
  fileDir: string;
  vaultPath: string;
  filePath?: string;
  setActiveFile?: (path: string, content: string) => void;
  onSamePageFragment?: (fragment: string) => void;
};

/** Open external URL, same-page fragment, vault file, or wikilink name. */
export function followVaultHref(href: string, opts: FollowVaultHrefOptions): void {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    invoke("open_url", { url: trimmed }).catch(console.error);
    return;
  }
  if (!trimmed || trimmed === "#") return;

  const hashIdx = trimmed.indexOf("#");
  const pathPart = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  const fragment = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : "";

  if (!pathPart || pathPart === "#") {
    if (fragment) opts.onSamePageFragment?.(fragment);
    return;
  }

  let abs: string;
  if (pathPart.startsWith("/")) {
    abs = normalizePosixPath(pathPart);
  } else {
    abs = normalizePosixPath(`${opts.fileDir}/${pathPart}`);
  }

  if (opts.filePath && opts.onSamePageFragment && pathsEqual(abs, opts.filePath)) {
    if (fragment) opts.onSamePageFragment(fragment);
    return;
  }

  if (abs.startsWith(`${opts.vaultPath}/`)) {
    const setActive = opts.setActiveFile ?? useStore.getState().setActiveFile;
    invoke<string>("get_file_content", { path: abs })
      .then((c) => setActive(abs, c))
      .catch(console.error);
    return;
  }

  openNoteByWikilinkNameFromStore(pathPart);
}
