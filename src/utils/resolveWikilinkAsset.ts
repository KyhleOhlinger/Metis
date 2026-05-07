import { convertFileSrc } from "@tauri-apps/api/core";
import type { AssetMetadata } from "../store/useStore";

/**
 * Resolve an Obsidian-style wikilink asset reference to an absolute path.
 *
 * Obsidian's resolution rules (replicated here):
 *  1. If the link contains "/" it is vault-root-relative:
 *       ![[subfolder/photo.jpg]]  →  <vaultPath>/subfolder/photo.jpg
 *  2. Otherwise the entire vault is searched for a file whose name (with
 *     extension) matches case-insensitively — this is how Obsidian finds
 *     attachments regardless of where they live in the vault:
 *       ![[photo.jpg]]  →  whichever path in assetIndex has name "photo.jpg"
 *  3. If no match is found, fall back to the vault root (legacy behaviour).
 *
 * Returns the absolute filesystem path (NOT an asset:// URL).
 * Call `convertFileSrc()` on the result when you need a URL.
 */
export function resolveWikilinkAssetPath(
  wikilinkName: string,
  assetIndex: AssetMetadata[],
  vaultPath: string,
): string {
  // Rule 1 — explicit sub-path: treat as vault-root-relative
  if (wikilinkName.includes("/")) {
    const resolved = normalizePath(`${vaultPath}/${wikilinkName}`);
    if (!resolved.startsWith(vaultPath + "/") && resolved !== vaultPath) {
      return `${vaultPath}/${wikilinkName.split("/").pop() ?? wikilinkName}`;
    }
    return resolved;
  }

  // Rule 2 — vault-wide name search (Obsidian-compatible)
  const lower = wikilinkName.toLowerCase();
  const match = assetIndex.find((a) => a.name.toLowerCase() === lower);
  if (match) return match.path;

  // Rule 3 — fallback: assume vault root (original Metis behaviour)
  return `${vaultPath}/${wikilinkName}`;
}

function normalizePath(path: string): string {
  const parts = path.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (out.length > 1) out.pop();
    } else if (part !== ".") {
      out.push(part);
    }
  }
  return out.join("/");
}

/**
 * Convenience wrapper that also converts the resolved path to a Tauri
 * `asset://` URL ready for use as an `<img src>`.
 */
export function resolveWikilinkAssetSrc(
  wikilinkName: string,
  assetIndex: AssetMetadata[],
  vaultPath: string,
): string {
  return convertFileSrc(
    resolveWikilinkAssetPath(wikilinkName, assetIndex, vaultPath),
  );
}
