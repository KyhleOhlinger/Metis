import { convertFileSrc } from "@tauri-apps/api/core";
import type { AssetMetadata } from "../store/useStore";
import { useStore } from "../store/useStore";
import { resolveWikilinkAssetPath } from "./resolveWikilinkAsset";
import { isPathWithinVault, normalizePosixPath } from "./paths";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/**
 * Resolve markdown image `src` to an absolute vault-local path, or null if external/unsafe.
 * SECURITY: enforces vault containment before asset:// conversion.
 */
export function resolveMarkdownImageAbsPath(
  src: string,
  vaultPath: string,
  fileDir: string,
  assetIndex?: AssetMetadata[],
): string | null {
  if (!src || /^(https?:|data:|blob:|asset:)/i.test(src)) return null;

  const trimmed = src.trim();

  if (IMAGE_EXT.test(trimmed) && !trimmed.includes("/")) {
    const index = assetIndex ?? useStore.getState().assetIndex;
    const resolved = resolveWikilinkAssetPath(trimmed, index, vaultPath);
    const normalized = normalizePosixPath(resolved);
    return isPathWithinVault(normalized, vaultPath) ? normalized : null;
  }

  if (trimmed.startsWith("assets/") || (trimmed.includes("/") && !/^https?:/i.test(trimmed))) {
    const normalized = normalizePosixPath(`${vaultPath}/${trimmed.replace(/^\.\//, "")}`);
    return isPathWithinVault(normalized, vaultPath) ? normalized : null;
  }

  if (trimmed.startsWith("/")) {
    const normalized = normalizePosixPath(trimmed);
    return isPathWithinVault(normalized, vaultPath) ? normalized : null;
  }

  const normalized = normalizePosixPath(`${fileDir}/${trimmed}`);
  return isPathWithinVault(normalized, vaultPath) ? normalized : null;
}

/** Resolve image src to a display URL (`asset://`, https, etc.). */
export function resolveMarkdownImageSrc(
  src: string,
  vaultPath: string,
  fileDir: string,
  assetIndex?: AssetMetadata[],
): string {
  if (!src || /^(https?:|data:|asset:|blob:)/i.test(src)) return src;
  const abs = resolveMarkdownImageAbsPath(src, vaultPath, fileDir, assetIndex);
  if (!abs) return "";
  return convertFileSrc(abs);
}

/** True when a vault tree entry is a raster/vector image file. */
export function isVaultImageFile(nameOrPath: string): boolean {
  const name = nameOrPath.split("/").pop() ?? nameOrPath;
  return IMAGE_EXT.test(name);
}

export { IMAGE_EXT as VAULT_IMAGE_EXT };
