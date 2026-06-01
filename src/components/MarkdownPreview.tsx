import { useMemo, useEffect, useRef, useDeferredValue } from "react";
import { marked } from "marked";
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
import { resolveMarkdownImageAbsPath, resolveMarkdownImageSrc } from "../utils/vaultImages";
import {
  followVaultHref,
  openNoteByWikilinkName,
  revealPlatformLabel,
} from "../utils/vaultNavigation";
import { findImageSourceOffsets } from "../utils/noteImages";
import { openDomContextMenu } from "../utils/domContextMenu";

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
};

export default function MarkdownPreview({
  content,
  filePath,
  vaultPath,
  bgColor,
  textColor,
  scrollAnchorOffset = null,
  onImageActivate,
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
    let imageLineIdx = 0;

    let md = deferredContent.replace(
      /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/gi,
      (_, filename) => `![${filename}](${filename})`,
    );

    md = md.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
      const trimmed = name.trim();
      const encoded = encodeURIComponent(trimmed);
      return `<a href="#" data-metis-wikilink="${encoded}">${escapeHtml(trimmed)}</a>`;
    });

    let raw = marked.parse(md, { gfm: true }) as string;
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

    const html = sanitizeMarkdownHtml(raw, { taskLists: true, previewAttrs: true });
    return { html, imagePaths, imageSourceOffsets };
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

      const a = target.closest("a") as HTMLAnchorElement | null;
      if (!a || !root.contains(a)) return;

      e.preventDefault();
      e.stopPropagation();

      const wiki = a.dataset.metisWikilink;
      if (wiki) {
        openNoteByWikilinkName(wiki, ctx.noteIndex, ctx.setActiveFile);
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
            onClick: () => openNoteByWikilinkName(wiki, ctx.noteIndex, ctx.setActiveFile),
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
          onClick: () => {
            invoke("open_url", { url: href }).catch(console.error);
          },
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
