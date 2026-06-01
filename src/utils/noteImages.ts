import type { AssetMetadata } from "../store/useStore";
import { resolveMarkdownImageAbsPath, VAULT_IMAGE_EXT } from "./vaultImages";
import { normalizePosixPath } from "./paths";
import { resolveWikilinkAssetPath } from "./resolveWikilinkAsset";

const WIKI_IMAGE_RE = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/gi;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const WIKI_IMAGE_LINE_RE = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/i;
const MD_IMAGE_LINE_RE = /!\[([^\]]*)\]\(([^)]+)\)/;

/** Character offsets of image markdown lines in document order (for Visual → Source navigation). */
export function findImageSourceOffsets(content: string): number[] {
  const offsets: number[] = [];
  let pos = 0;
  for (const line of content.split("\n")) {
    if (MD_IMAGE_LINE_RE.test(line) || WIKI_IMAGE_LINE_RE.test(line)) {
      offsets.push(pos);
    }
    pos += line.length + 1;
  }
  return offsets;
}

/** Collect absolute vault-local image paths referenced in note markdown. */
export function collectImagePathsFromMarkdown(
  content: string,
  notePath: string,
  vaultPath: string,
  assetIndex: AssetMetadata[],
): string[] {
  const fileDir = notePath.substring(0, notePath.lastIndexOf("/"));
  const found = new Set<string>();

  WIKI_IMAGE_RE.lastIndex = 0;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = WIKI_IMAGE_RE.exec(content)) !== null) {
    const abs = resolveWikilinkAssetPath(wikiMatch[1], assetIndex, vaultPath);
    const normalized = normalizePosixPath(abs);
    if (normalized.startsWith(`${vaultPath}/`) && VAULT_IMAGE_EXT.test(normalized)) {
      found.add(normalized);
    }
  }

  MD_IMAGE_RE.lastIndex = 0;
  let mdMatch: RegExpExecArray | null;
  while ((mdMatch = MD_IMAGE_RE.exec(content)) !== null) {
    const abs = resolveMarkdownImageAbsPath(mdMatch[2], vaultPath, fileDir, assetIndex);
    if (abs && VAULT_IMAGE_EXT.test(abs)) found.add(abs);
  }

  return [...found];
}

/** Vault-relative folder paths for dropdowns (includes `assets` even if missing). */
export function listVaultFolderOptions(
  files: import("../store/useStore").FileNode[],
  vaultPath: string,
): { relativePath: string; label: string }[] {
  const out: { relativePath: string; label: string }[] = [];
  const seen = new Set<string>();

  function walk(nodes: typeof files, depth = 0) {
    for (const n of nodes) {
      if (!n.is_dir) continue;
      const rel = n.path.startsWith(`${vaultPath}/`)
        ? n.path.slice(vaultPath.length + 1)
        : n.name;
      if (!seen.has(rel)) {
        seen.add(rel);
        out.push({ relativePath: rel, label: `${"  ".repeat(depth)}${n.name}` });
      }
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }

  walk(files);
  if (!seen.has("assets")) {
    out.unshift({ relativePath: "assets", label: "assets" });
  }
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}
