import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store/useStore";
import type { NoteMetadata } from "../store/useStore";
import { normalizePosixPath, pathsEqual } from "./paths";

/** Strip `[[target|display]]` alias and `#heading` suffix from a wikilink token. */
export function normalizeWikilinkTarget(rawName: string): string {
  let name = decodeURIComponent(rawName).trim();
  const pipe = name.indexOf("|");
  if (pipe >= 0) name = name.slice(0, pipe).trim();
  const hash = name.indexOf("#");
  if (hash >= 0) name = name.slice(0, hash).trim();
  return name;
}

function noteMatchesWikilinkName(
  note: NoteMetadata,
  name: string,
  stem: string,
): boolean {
  if (
    note.name === name ||
    note.name.toLowerCase() === name.toLowerCase() ||
    note.name.replace(/\.md$/i, "").toLowerCase() === stem
  ) {
    return true;
  }
  return (
    note.aliases?.some(
      (alias) =>
        alias === name ||
        alias.toLowerCase() === name.toLowerCase() ||
        alias.replace(/\.md$/i, "").toLowerCase() === stem,
    ) ?? false
  );
}

function noteMatchesVaultRelativePath(
  note: NoteMetadata,
  vaultPath: string,
  relative: string,
): boolean {
  const rel = normalizePosixPath(relative.replace(/\\/g, "/").replace(/\.md$/i, "")).toLowerCase();
  const noteRel = normalizePosixPath(
    note.path.slice(vaultPath.length + 1).replace(/\.md$/i, ""),
  ).toLowerCase();
  return noteRel === rel || noteRel.endsWith(`/${rel}`);
}

export function findNoteByWikilinkName(
  rawName: string,
  noteIndex: NoteMetadata[],
  vaultPath?: string,
): NoteMetadata | undefined {
  const name = normalizeWikilinkTarget(rawName);
  const stem = name.replace(/\.md$/i, "").toLowerCase();

  const direct = noteIndex.find((n) => noteMatchesWikilinkName(n, name, stem));
  if (direct) return direct;

  if (vaultPath && (name.includes("/") || name.includes("\\"))) {
    const rel = name.replace(/\\/g, "/");
    return noteIndex.find((n) => noteMatchesVaultRelativePath(n, vaultPath, rel));
  }

  return undefined;
}

function openNotePath(
  note: NoteMetadata,
  setActiveFile: (path: string, content: string) => void,
): void {
  invoke<string>("get_file_content", { path: note.path })
    .then((c) => setActiveFile(note.path, c))
    .catch(console.error);
}

export function openNoteByWikilinkName(
  rawName: string,
  noteIndex: NoteMetadata[],
  setActiveFile: (path: string, content: string) => void,
  vaultPath?: string,
): void {
  const note = findNoteByWikilinkName(rawName, noteIndex, vaultPath);
  if (!note) return;
  openNotePath(note, setActiveFile);
}

export function openNoteByWikilinkNameFromStore(rawName: string): void {
  const { noteIndex, setActiveFile, vaultPath } = useStore.getState();
  openNoteByWikilinkName(rawName, noteIndex, setActiveFile, vaultPath ?? undefined);
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

function looksLikeVaultFilePath(pathPart: string): boolean {
  return (
    /\.(md|markdown)$/i.test(pathPart) ||
    pathPart.includes("/") ||
    pathPart.startsWith("/")
  );
}

export function isExternalHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/** Open http(s) URL in the OS default browser (validated in Rust `open_url`). */
export function openExternalUrl(raw: string): void {
  const url = raw.trim();
  if (!isExternalHttpUrl(url)) return;
  invoke("open_url", { url }).catch(console.error);
}

/** Open external URL, same-page fragment, vault file, or wikilink name. */
export function followVaultHref(href: string, opts: FollowVaultHrefOptions): void {
  const trimmed = href.trim();
  if (isExternalHttpUrl(trimmed)) {
    openExternalUrl(trimmed);
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

  const setActive = opts.setActiveFile ?? useStore.getState().setActiveFile;
  const { noteIndex } = useStore.getState();

  const tryOpenByName = () => {
    const note = findNoteByWikilinkName(pathPart, noteIndex, opts.vaultPath);
    if (note) openNotePath(note, setActive);
  };

  // `[text](Note Title)` — resolve by name before treating as a relative file path.
  if (!looksLikeVaultFilePath(pathPart)) {
    const note = findNoteByWikilinkName(pathPart, noteIndex, opts.vaultPath);
    if (note) {
      openNotePath(note, setActive);
      return;
    }
  }

  const abs = pathPart.startsWith("/")
    ? normalizePosixPath(pathPart)
    : normalizePosixPath(`${opts.fileDir}/${pathPart}`);

  if (opts.filePath && opts.onSamePageFragment && pathsEqual(abs, opts.filePath)) {
    if (fragment) opts.onSamePageFragment(fragment);
    return;
  }

  if (abs.startsWith(`${opts.vaultPath}/`)) {
    invoke<string>("get_file_content", { path: abs })
      .then((c) => setActive(abs, c))
      .catch(() => tryOpenByName());
    return;
  }

  tryOpenByName();
}
