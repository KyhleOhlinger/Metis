import type { NoteMetadata } from "../store/useStore";
import { openDomContextMenu } from "./domContextMenu";
import {
  followVaultHref,
  normalizeWikilinkTarget,
  openExternalUrl,
  openNoteByWikilinkName,
  resolveExternalHref,
  type FollowVaultHrefOptions,
} from "./vaultNavigation";

export type PreviewAnchorContext = FollowVaultHrefOptions & {
  noteIndex?: NoteMetadata[];
  setActiveFile?: (path: string, content: string) => void;
  /** Visual mode: plain click on internal links jumps to Source at offset. */
  onSourceActivate?: (sourceOffset: number, matchEnd?: number) => void;
};

export function findPreviewAnchor(
  event: MouseEvent,
  root: HTMLElement,
): HTMLAnchorElement | null {
  const a = (event.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
  if (!a || !root.contains(a)) return null;
  return a;
}

/**
 * Handle a click on a rendered markdown anchor.
 * Always blocks in-webview navigation; external URLs open in the OS browser.
 */
export function handlePreviewAnchorClick(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
  ctx: PreviewAnchorContext,
): void {
  event.preventDefault();
  event.stopPropagation();

  const href = anchor.getAttribute("href") ?? "";
  const wikiRaw = anchor.dataset.metisWikilink;
  const modifier = event.metaKey || event.ctrlKey;
  const external = resolveExternalHref(href);

  if (wikiRaw) {
    const wiki = normalizeWikilinkTarget(decodeURIComponent(wikiRaw));
    if (modifier && ctx.setActiveFile) {
      openNoteByWikilinkName(wiki, ctx.noteIndex ?? [], ctx.setActiveFile, ctx.vaultPath);
      return;
    }
    const sourceFrom = anchor.dataset.metisSourceOffset;
    if (sourceFrom !== undefined && ctx.onSourceActivate) {
      const from = Number(sourceFrom);
      const to = anchor.dataset.metisSourceEnd;
      const end = to !== undefined ? Number(to) : undefined;
      if (Number.isFinite(from)) {
        ctx.onSourceActivate(from, Number.isFinite(end!) ? end : undefined);
      }
    }
    return;
  }

  if (external) {
    openExternalUrl(external);
    return;
  }

  if (modifier) {
    followVaultHref(href, ctx);
    return;
  }

  const sourceFrom = anchor.dataset.metisSourceOffset;
  if (sourceFrom !== undefined && ctx.onSourceActivate) {
    const from = Number(sourceFrom);
    const to = anchor.dataset.metisSourceEnd;
    const end = to !== undefined ? Number(to) : undefined;
    if (Number.isFinite(from)) {
      ctx.onSourceActivate(from, Number.isFinite(end!) ? end : undefined);
      return;
    }
  }

  followVaultHref(href, ctx);
}

/** Capture-phase click + context-menu handlers for preview surfaces. */
export function bindPreviewAnchorHandlers(
  root: HTMLElement,
  getContext: () => PreviewAnchorContext,
): () => void {
  const onClick = (e: MouseEvent) => {
    const anchor = findPreviewAnchor(e, root);
    if (!anchor) return;
    handlePreviewAnchorClick(e, anchor, getContext());
  };

  const onContextMenu = (e: MouseEvent) => {
    const ctx = getContext();
    const anchor = findPreviewAnchor(e, root);
    if (!anchor) return;

    const wikiRaw = anchor.dataset.metisWikilink;
    const href = anchor.getAttribute("href") ?? "";
    const external = resolveExternalHref(href);

    e.preventDefault();
    e.stopPropagation();

    if (wikiRaw && ctx.setActiveFile) {
      const wiki = normalizeWikilinkTarget(decodeURIComponent(wikiRaw));
      openDomContextMenu(e.clientX, e.clientY, [
        {
          label: "Open Note",
          onClick: () =>
            openNoteByWikilinkName(wiki, ctx.noteIndex ?? [], ctx.setActiveFile!, ctx.vaultPath),
        },
      ]);
      return;
    }

    if (external) {
      openDomContextMenu(e.clientX, e.clientY, [
        {
          label: "Open Link",
          onClick: () => openExternalUrl(external),
        },
      ]);
      return;
    }

    const trimmed = href.trim();
    if (trimmed && trimmed !== "#") {
      openDomContextMenu(e.clientX, e.clientY, [
        {
          label: "Open Link",
          onClick: () => followVaultHref(trimmed, ctx),
        },
      ]);
    }
  };

  root.addEventListener("click", onClick, true);
  root.addEventListener("contextmenu", onContextMenu, true);
  return () => {
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("contextmenu", onContextMenu, true);
  };
}
