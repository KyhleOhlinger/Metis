import { useMemo, useEffect, useRef, useDeferredValue } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store/useStore";
import type { NoteMetadata } from "../store/useStore";
import {
  addHeadingIds,
  escapeHtml,
  sanitizeMarkdownHtml,
  scrollPreviewToFragment,
  scrollPreviewToSourceOffset,
} from "../utils/markdownHtml";
import { parseMarkedWithHighlight } from "../utils/markedHighlight";
import { resolveMarkdownImageAbsPath, resolveMarkdownImageSrc } from "../utils/vaultImages";
import {
  followVaultHref,
  openExternalUrl,
  normalizeWikilinkTarget,
  openNoteByWikilinkName,
  revealPlatformLabel,
} from "../utils/vaultNavigation";
import { findImageSourceOffsets } from "../utils/noteImages";
import { preserveBlankLinesBeforeRenderedBlocks } from "../utils/previewMarkdown";
import { openDomContextMenu } from "../utils/domContextMenu";
import {
  listStickyPairOffsets,
  preprocessStickyBlocksForPreview,
  type StickyPairOffsets,
} from "../utils/stickyNotes";

interface Props {
  content: string;
  filePath: string;
  vaultPath: string;
  bgColor?: string;
  textColor?: string;
  /** Source-mode cursor offset — used once when entering Visual to preserve scroll position. */
  scrollAnchorOffset?: number | null;
  /** Visual preview image click — jump to source at the image markdown line. */
  onImageActivate?: (sourceOffset: number) => void;
  /** Visual sticky / wrap click — jump to source at the fence. */
  onStickyActivate?: (sourceOffset: number) => void;
}

type PreviewContext = {
  noteIndex: NoteMetadata[];
  setActiveFile: (path: string, content: string) => void;
  fileDir: string;
  filePath: string;
  vaultPath: string;
  imagePaths: string[];
  imageSourceOffsets: number[];
  revealLabel: string;
  onImageActivate?: (sourceOffset: number) => void;
  onStickyActivate?: (sourceOffset: number) => void;
  stickyOffsets: StickyPairOffsets[];
};

export default function MarkdownPreview({
  content,
  filePath,
  vaultPath,
  bgColor,
  textColor,
  scrollAnchorOffset = null,
  onImageActivate,
  onStickyActivate,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<PreviewContext>({
    noteIndex: [],
    setActiveFile: () => {},
    fileDir: "",
    filePath: "",
    vaultPath: "",
    imagePaths: [],
    imageSourceOffsets: [],
    stickyOffsets: [],
    revealLabel: "Reveal in Finder",
  });

  const { noteIndex, assetIndex, setActiveFile } = useStore(
    useShallow((s) => ({
      noteIndex: s.noteIndex,
      assetIndex: s.assetIndex,
      setActiveFile: s.setActiveFile,
    })),
  );

  const deferredContent = useDeferredValue(content);

  const fileDir = useMemo(
    () => filePath.substring(0, filePath.lastIndexOf("/")),
    [filePath],
  );

  const preview = useMemo(() => {
    const imagePaths: string[] = [];
    const imageSourceOffsets: number[] = [];
    const allImageOffsets = findImageSourceOffsets(deferredContent);
    const stickyOffsets = listStickyPairOffsets(deferredContent);
    let imageLineIdx = 0;

    let md = preserveBlankLinesBeforeRenderedBlocks(deferredContent);
    md = preprocessStickyBlocksForPreview(md);

    md = md.replace(
      /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/gi,
      (_, filename) => `![${filename}](${filename})`,
    );

    md = md.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
      const trimmed = name.trim();
      const target = normalizeWikilinkTarget(trimmed);
      const display =
        trimmed.includes("|") ? trimmed.slice(trimmed.indexOf("|") + 1).trim() : target;
      const encoded = encodeURIComponent(target);
      return `<a href="#" data-metis-wikilink="${encoded}">${escapeHtml(display)}</a>`;
    });

    let raw = parseMarkedWithHighlight(md, { gfm: true });
    raw = addHeadingIds(raw);

    raw = raw.replace(
      /(<img\b[^>]*?)\bsrc="([^"]+)"/gi,
      (_, before, src) => {
        const sourceOffset = allImageOffsets[imageLineIdx] ?? 0;
        imageLineIdx += 1;
        const resolved = resolveMarkdownImageSrc(src, vaultPath, fileDir, assetIndex);
        const absPath = resolveMarkdownImageAbsPath(src, vaultPath, fileDir, assetIndex);
        const idx = imagePaths.length;
        if (absPath) {
          imagePaths.push(absPath);
          imageSourceOffsets.push(sourceOffset);
        }
        const idxAttr = absPath ? ` data-image-idx="${idx}"` : "";
        return `${before}data-src="${resolved}" loading="lazy"${idxAttr}`;
      },
    );

    const html = sanitizeMarkdownHtml(raw, {
      taskLists: true,
      previewAttrs: true,
      stickyNotes: true,
    });
    return { html, imagePaths, imageSourceOffsets, stickyOffsets };
  }, [deferredContent, vaultPath, fileDir, assetIndex]);

  ctxRef.current = {
    noteIndex,
    setActiveFile,
    fileDir,
    filePath,
    vaultPath,
    imagePaths: preview.imagePaths,
    imageSourceOffsets: preview.imageSourceOffsets,
    revealLabel: revealPlatformLabel(),
    onImageActivate,
    onStickyActivate,
    stickyOffsets: preview.stickyOffsets,
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onClick = (e: MouseEvent) => {
      const ctx = ctxRef.current;
      const target = e.target as HTMLElement;

      const img = target.closest("img[data-image-idx]") as HTMLImageElement | null;
      if (img && root.contains(img)) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(img.dataset.imageIdx);
        const offset = ctx.imageSourceOffsets[idx];
        if (offset !== undefined && ctx.onImageActivate) {
          ctx.onImageActivate(offset);
        }
        return;
      }

      const stickyEl = target.closest("[data-metis-sticky-idx]") as HTMLElement | null;
      if (stickyEl && root.contains(stickyEl) && ctx.onStickyActivate) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(stickyEl.dataset.metisStickyIdx);
        const pair = ctx.stickyOffsets[idx];
        if (pair) {
          const inWrap = target.closest(".metis-sticky-wrap") !== null;
          const offset =
            inWrap && pair.wrapFrom !== null ? pair.wrapFrom : pair.stickyFrom;
          ctx.onStickyActivate(offset);
        }
        return;
      }

      const a = target.closest("a") as HTMLAnchorElement | null;
      if (!a || !root.contains(a)) return;

      e.preventDefault();
      e.stopPropagation();

      const wiki = a.dataset.metisWikilink;
      if (wiki) {
        openNoteByWikilinkName(wiki, ctx.noteIndex, ctx.setActiveFile, ctx.vaultPath);
        return;
      }

      followVaultHref(a.getAttribute("href") ?? "", {
        fileDir: ctx.fileDir,
        vaultPath: ctx.vaultPath,
        filePath: ctx.filePath,
        setActiveFile: ctx.setActiveFile,
        onSamePageFragment: (fragment) => scrollPreviewToFragment(root, fragment),
      });
    };

    const onContextMenu = (e: MouseEvent) => {
      const ctx = ctxRef.current;
      const target = e.target as HTMLElement;

      const img = target.closest("img[data-image-idx]") as HTMLImageElement | null;
      const imgIdx = img?.dataset.imageIdx;
      if (img && imgIdx !== undefined && root.contains(img)) {
        const absPath = ctx.imagePaths[Number(imgIdx)];
        if (absPath) {
          e.preventDefault();
          e.stopPropagation();
          openDomContextMenu(e.clientX, e.clientY, [
            {
              label: ctx.revealLabel,
              onClick: () => {
                invoke("reveal_in_finder", { path: absPath, vaultPath: ctx.vaultPath }).catch(
                  console.error,
                );
              },
            },
          ]);
        }
        return;
      }

      const a = target.closest("a") as HTMLAnchorElement | null;
      if (!a || !root.contains(a)) return;

      const wiki = a.dataset.metisWikilink;
      if (wiki) {
        e.preventDefault();
        e.stopPropagation();
        openDomContextMenu(e.clientX, e.clientY, [
          {
            label: "Open Note",
            onClick: () =>
              openNoteByWikilinkName(wiki, ctx.noteIndex, ctx.setActiveFile, ctx.vaultPath),
          },
        ]);
        return;
      }

      const href = a.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      openDomContextMenu(e.clientX, e.clientY, [
        {
          label: "Open Link",
          onClick: () => openExternalUrl(href),
        },
      ]);
    };

    root.addEventListener("click", onClick, true);
    root.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => {
      const src = img.dataset.src;
      if (src) {
        img.src = src;
        img.loading = "lazy";
        delete img.dataset.src;
      }
    });
    el.querySelectorAll<HTMLElement>(".metis-sticky[data-metis-sticky-width]").forEach((node) => {
      const w = node.dataset.metisStickyWidth?.trim();
      if (w) node.style.setProperty("--metis-sticky-width", w);
    });
  }, [preview.html]);

  useEffect(() => {
    if (scrollAnchorOffset == null) return;
    const el = rootRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      scrollPreviewToSourceOffset(el, deferredContent, scrollAnchorOffset);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollAnchorOffset, preview.html, deferredContent]);

  return (
    <div
      ref={rootRef}
      className="preview-prose pointer-events-auto absolute inset-0 z-20 h-full min-h-0 overflow-y-auto"
      style={bgColor ? { backgroundColor: bgColor, color: textColor } : undefined}
    >
      <div ref={contentRef} dangerouslySetInnerHTML={{ __html: preview.html }} />
    </div>
  );
}
