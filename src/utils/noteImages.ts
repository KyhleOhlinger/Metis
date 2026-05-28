import type { AssetMetadata } from "../store/useStore";
import { resolveWikilinkAssetPath } from "./resolveWikilinkAsset";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const WIKI_IMAGE_RE = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/gi;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function normalizePosixPath(raw: string): string {
  const isAbs = raw.startsWith("/");
  const stack: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "..") stack.pop();
    else if (seg && seg !== ".") stack.push(seg);
  }
  return (isAbs ? "/" : "") + stack.join("/");
}

function resolveMarkdownImagePath(
  src: string,
  notePath: string,
  vaultPath: string,
): string | null {
  const trimmed = src.trim();
  if (!trimmed || /^(https?:|data:|blob:)/i.test(trimmed)) return null;

  let abs: string;
  if (trimmed.startsWith("assets/") || trimmed.startsWith("attachments/")) {
    abs = normalizePosixPath(`${vaultPath}/${trimmed}`);
  } else if (trimmed.startsWith("/")) {
    abs = normalizePosixPath(trimmed);
  } else {
    const fileDir = notePath.substring(0, notePath.lastIndexOf("/"));
    abs = normalizePosixPath(`${fileDir}/${trimmed}`);
  }

  if (!abs.startsWith(`${vaultPath}/`) && abs !== vaultPath) return null;
  return abs;
}

/** Collect absolute vault-local image paths referenced in note markdown. */
export function collectImagePathsFromMarkdown(
  content: string,
  notePath: string,
  vaultPath: string,
  assetIndex: AssetMetadata[],
): string[] {
  const found = new Set<string>();

  WIKI_IMAGE_RE.lastIndex = 0;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = WIKI_IMAGE_RE.exec(content)) !== null) {
    const abs = resolveWikilinkAssetPath(wikiMatch[1], assetIndex, vaultPath);
    const normalized = normalizePosixPath(abs);
    if (normalized.startsWith(`${vaultPath}/`) && IMAGE_EXT.test(normalized)) {
      found.add(normalized);
    }
  }

  MD_IMAGE_RE.lastIndex = 0;
  let mdMatch: RegExpExecArray | null;
  while ((mdMatch = MD_IMAGE_RE.exec(content)) !== null) {
    const abs = resolveMarkdownImagePath(mdMatch[2], notePath, vaultPath);
    if (abs && IMAGE_EXT.test(abs)) found.add(abs);
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
