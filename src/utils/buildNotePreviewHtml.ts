import type { AssetMetadata } from "@/store/useStore";
import {
  addHeadingIds,
  escapeHtml,
  sanitizeMarkdownHtml,
} from "./markdownHtml";
import { parseMarkedWithHighlight } from "./markedHighlight";
import { preserveBlankLinesBeforeRenderedBlocks } from "./previewMarkdown";
import { preprocessStickyBlocksForPreview } from "./stickyNotes";
import { normalizeWikilinkTarget } from "./vaultNavigation";
import {
  resolveMarkdownImageAbsPath,
  resolveMarkdownImageSrc,
} from "./vaultImages";

export type BuildNotePreviewOptions = {
  content: string;
  vaultPath: string;
  filePath: string;
  assetIndex: AssetMetadata[];
};

/** Render note markdown to sanitized Visual-preview HTML (no React / lazy images). */
export function buildNotePreviewHtml({
  content,
  vaultPath,
  filePath,
  assetIndex,
}: BuildNotePreviewOptions): string {
  const fileDir = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/"))
    : vaultPath;

  let md = preserveBlankLinesBeforeRenderedBlocks(content);
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
      const resolved = resolveMarkdownImageSrc(src, vaultPath, fileDir, assetIndex);
      const absPath = resolveMarkdownImageAbsPath(src, vaultPath, fileDir, assetIndex);
      const dataAbs = absPath ? ` data-export-abs-path="${escapeHtml(absPath)}"` : "";
      const srcAttr = resolved ? ` src="${resolved}"` : "";
      return `${before}${srcAttr}${dataAbs}`;
    },
  );

  return sanitizeMarkdownHtml(raw, {
    taskLists: true,
    previewAttrs: true,
    stickyNotes: true,
  });
}
