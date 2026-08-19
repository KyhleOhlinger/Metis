/**
 * agentVisionContext.ts — Attach vault images referenced in agent context.
 *
 * Notes sent to personas are markdown. Image embeds (`![[photo.png]]`,
 * `![](assets/…)`) are otherwise invisible to the model, which then replies
 * that it cannot view images. This module resolves those refs to vault files
 * and loads them via `read_vault_image_base64` for multimodal chat.
 *
 * SECURITY: Only raster images already referenced in scoped note content.
 * Paths go through the existing vault-boundary IPC. SVG is excluded (not a
 * vision payload; scriptable). Count and size are capped to limit egress.
 */

import { invoke } from "@tauri-apps/api/core";
import type { AssetMetadata, NoteMetadata } from "../store/vaultTypes";
import { collectImagePathsFromMarkdown } from "../utils/noteImages";

/** Max images attached to a single agent chat request (cost / payload guard). */
export const MAX_AGENT_VISION_IMAGES = 8;

const RASTER_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const CONCAT_SECTION_RE = /\n\n---\n## /;

export interface AgentVisionImage {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

interface VaultImageBase64 {
  data_base64: string;
  mime_type: string;
}

function isRasterImagePath(absPath: string): boolean {
  return RASTER_EXT.test(absPath);
}

/**
 * Collect unique vault-local raster image paths referenced in agent markdown.
 * Concatenated multi-note context (`## name.md` sections) is resolved per note
 * when `noteIndex` is provided so relative embeds stay correct.
 */
export function collectAgentVisionImagePaths(
  markdown: string,
  vaultPath: string,
  notePath: string | null,
  assetIndex: AssetMetadata[],
  noteIndex: NoteMetadata[] = [],
): string[] {
  if (!markdown.trim() || !vaultPath) return [];

  const found = new Set<string>();
  const fallbackNote = notePath ?? `${vaultPath}/note.md`;

  for (const p of collectImagePathsFromMarkdown(
    markdown,
    fallbackNote,
    vaultPath,
    assetIndex,
  )) {
    if (isRasterImagePath(p)) found.add(p);
  }

  if (noteIndex.length > 0 && CONCAT_SECTION_RE.test(markdown)) {
    const parts = markdown.split(CONCAT_SECTION_RE);
    for (let i = 1; i < parts.length; i++) {
      const section = parts[i] ?? "";
      const splitAt = section.indexOf("\n\n");
      const name = (splitAt === -1 ? section : section.slice(0, splitAt)).trim();
      const body = splitAt === -1 ? "" : section.slice(splitAt + 2);
      if (!name || !body.trim()) continue;
      const note = noteIndex.find(
        (n) => n.name === name || n.path.endsWith(`/${name}`),
      );
      if (!note) continue;
      for (const p of collectImagePathsFromMarkdown(
        body,
        note.path,
        vaultPath,
        assetIndex,
      )) {
        if (isRasterImagePath(p)) found.add(p);
      }
    }
  }

  return [...found];
}

function fileNameFromPath(absPath: string): string {
  const parts = absPath.split(/[/\\]/);
  return parts[parts.length - 1] ?? absPath;
}

/**
 * Load up to `MAX_AGENT_VISION_IMAGES` referenced vault images as base-64.
 * Missing or oversized files are skipped so the text run still proceeds.
 */
export async function loadAgentVisionImages(opts: {
  markdown: string;
  vaultPath: string;
  notePath: string | null;
  assetIndex: AssetMetadata[];
  noteIndex?: NoteMetadata[];
  onStatus?: (msg: string) => void;
}): Promise<{ images: AgentVisionImage[]; skipped: number; totalRefs: number }> {
  const paths = collectAgentVisionImagePaths(
    opts.markdown,
    opts.vaultPath,
    opts.notePath,
    opts.assetIndex,
    opts.noteIndex ?? [],
  );
  const totalRefs = paths.length;
  const selected = paths.slice(0, MAX_AGENT_VISION_IMAGES);
  const images: AgentVisionImage[] = [];
  let skipped = totalRefs - selected.length;

  for (let i = 0; i < selected.length; i++) {
    const path = selected[i]!;
    const fileName = fileNameFromPath(path);
    opts.onStatus?.(
      `Attaching image ${i + 1} of ${selected.length}: ${fileName}…`,
    );
    try {
      const payload = await invoke<VaultImageBase64>("read_vault_image_base64", {
        path,
      });
      if (!payload.data_base64) {
        skipped += 1;
        continue;
      }
      images.push({
        fileName,
        mimeType: payload.mime_type || "application/octet-stream",
        dataBase64: payload.data_base64,
      });
    } catch {
      skipped += 1;
    }
  }

  return { images, skipped, totalRefs };
}

/** Count image markdown refs (unresolved) for egress estimates. */
export function countImageMarkdownRefs(content: string): number {
  if (!content) return 0;
  const wiki = content.match(
    /!\[\[[^\]]+\.(?:png|jpe?g|gif|webp|bmp|avif)\]\]/gi,
  );
  const md = content.match(/!\[[^\]]*\]\([^)]+\)/g);
  return (wiki?.length ?? 0) + (md?.length ?? 0);
}
