import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store/useStore";
import type { NoteMetadata } from "../store/useStore";
import { formatError } from "./formatError";
import { openVaultNotePath } from "./openVaultNote";
import { normalizePosixPath, pathsEqual } from "./paths";
import { appConfirm, toastError } from "../store/useToastStore";

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

function openResolvedNote(note: NoteMetadata): void {
  void openVaultNotePath(note.path);
}

export function openNoteByWikilinkName(
  rawName: string,
  noteIndex: NoteMetadata[],
  vaultPath?: string,
): void {
  const note = findNoteByWikilinkName(rawName, noteIndex, vaultPath);
  if (!note) {
    toastError(`Note not found: ${normalizeWikilinkTarget(rawName)}`);
    return;
  }
  openResolvedNote(note);
}

export function openNoteByWikilinkNameFromStore(rawName: string): void {
  const { noteIndex, vaultPath } = useStore.getState();
  openNoteByWikilinkName(rawName, noteIndex, vaultPath ?? undefined);
}

export function revealPlatformLabel(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
    ? "Reveal in Finder"
    : "Reveal in File Explorer";
}

/** Reveal a vault path in the OS file manager; surfaces failures via toast. */
export function revealInFinder(path: string, vaultPath: string): void {
  void invoke("reveal_in_finder", { path, vaultPath }).catch((err) =>
    toastError(`${revealPlatformLabel()} failed: ${formatError(err)}`),
  );
}

export type FollowVaultHrefOptions = {
  fileDir: string;
  vaultPath: string;
  filePath?: string;
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

/**
 * Resolve a markdown `href` to an external http(s) URL when possible.
 * A bare name is a vault path. `www.example.org` and URLs that already have a
 * scheme are external. `report.zip` is not treated as a website.
 */
export function resolveExternalHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#") return null;
  if (isExternalHttpUrl(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;

  // Avoid treating vault paths, wikilink names, or fragments as external URLs.
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    /\.(md|markdown)$/i.test(trimmed) ||
    trimmed.includes(" ")
  ) {
    return null;
  }

  if (/^www\.[\w-]+(\.[\w-]+)+([\/?#][^\s]*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}

/** Open http(s) URL in the OS default browser (validated in Rust `open_url`). */
export function openExternalUrl(raw: string): void {
  const url = raw.trim();
  if (!isExternalHttpUrl(url)) return;
  invoke("open_url", { url }).catch((err) =>
    toastError(`Could not open link: ${formatError(err)}`),
  );
}

export function externalHostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Name the site before leaving the note. */
export function confirmAndOpenExternalUrl(raw: string): void {
  const url = raw.trim();
  if (!isExternalHttpUrl(url)) return;
  const host = externalHostLabel(url);
  void appConfirm(`Open ${host}?`, { title: "Open link", confirmLabel: "Open" }).then((ok) => {
    if (ok) openExternalUrl(url);
  });
}

/** Open external URL, same-page fragment, vault file, or wikilink name. */
export function followVaultHref(href: string, opts: FollowVaultHrefOptions): void {
  const trimmed = href.trim();
  const external = resolveExternalHref(trimmed);
  if (external) {
    confirmAndOpenExternalUrl(external);
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

  const { noteIndex } = useStore.getState();

  const tryOpenByName = () => {
    const note = findNoteByWikilinkName(pathPart, noteIndex, opts.vaultPath);
    if (note) {
      openResolvedNote(note);
    } else {
      toastError(`Note not found: ${normalizeWikilinkTarget(pathPart)}`);
    }
  };

  // `[text](Note Title)` — resolve by name before treating as a relative file path.
  if (!looksLikeVaultFilePath(pathPart)) {
    const note = findNoteByWikilinkName(pathPart, noteIndex, opts.vaultPath);
    if (note) {
      openResolvedNote(note);
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
    void openVaultNotePath(abs, { quiet: true }).then((opened) => {
      if (!opened) tryOpenByName();
    });
    return;
  }

  tryOpenByName();
}
