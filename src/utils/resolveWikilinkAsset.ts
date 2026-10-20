import type { AssetMetadata } from "../store/useStore";
import { normalizePosixPath, isPathWithinVault } from "./paths";
import { safeConvertFileSrc } from "./vaultImages";

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
  nearDir?: string,
): string {
  // Rule 1 — explicit sub-path: treat as vault-root-relative
  if (wikilinkName.includes("/")) {
    const resolved = normalizePosixPath(`${vaultPath}/${wikilinkName}`);
    if (!isPathWithinVault(resolved, vaultPath)) {
      return `${vaultPath}/${wikilinkName.split("/").pop() ?? wikilinkName}`;
    }
    return resolved;
  }

  const lower = wikilinkName.toLowerCase();
  const named = assetIndex.filter((a) => a.name.toLowerCase() === lower);
  const sibling = nearDir ? normalizePosixPath(`${nearDir}/${wikilinkName}`) : "";
  const beside =
    sibling && named.find((a) => normalizePosixPath(a.path) === sibling);
  if (beside) return beside.path;

  // A `.note` embed beside a markdown companion must not open another folder's copy.
  if (sibling && /\.note$/i.test(wikilinkName) && isPathWithinVault(sibling, vaultPath)) {
    return sibling;
  }

  if (named.length > 0) return named[0].path;

  if (sibling && isPathWithinVault(sibling, vaultPath)) return sibling;

  return `${vaultPath}/${wikilinkName}`;
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
  const abs = resolveWikilinkAssetPath(wikilinkName, assetIndex, vaultPath);
  return safeConvertFileSrc(abs, vaultPath);
}
