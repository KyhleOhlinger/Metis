import type { FileNode } from "../store/useStore";
import { HANDWRITTEN_SPACE } from "../constants/vaultSpaces";
import { isVaultImageFile } from "./vaultImages";

export interface HandwritingImageEntry {
  /** Absolute path on disk */
  path: string;
  fileName: string;
  /** Vault-relative path, e.g. `handwritten/scan-01.jpg` */
  relativePath: string;
  /** Absolute path for the note to write */
  mdPath: string;
  hasExistingNote: boolean;
}

function findHandwrittenFolder(nodes: FileNode[]): FileNode | null {
  for (const n of nodes) {
    if (n.is_dir && n.name.toLowerCase() === HANDWRITTEN_SPACE) return n;
    if (n.is_dir && n.children?.length) {
      const found = findHandwrittenFolder(n.children);
      if (found) return found;
    }
  }
  return null;
}

/** Images in `handwritten/` suitable for OCR. */
export function collectHandwritingImages(
  files: FileNode[],
  vaultPath: string,
  mode: "pending" | "all",
): HandwritingImageEntry[] {
  const folder = findHandwrittenFolder(files);
  if (!folder?.children?.length) return [];

  const mdBasenames = new Set(
    folder.children
      .filter((c) => !c.is_dir && c.name.toLowerCase().endsWith(".md"))
      .map((c) => c.name.replace(/\.md$/i, "").toLowerCase()),
  );

  const out: HandwritingImageEntry[] = [];

  for (const child of folder.children) {
    if (child.is_dir) continue;
    if (!isVaultImageFile(child.name)) continue;
    if (child.name.toLowerCase().endsWith(".svg")) continue;

    const base = child.name.replace(/\.[^.]+$/i, "");
    const hasExistingNote = mdBasenames.has(base.toLowerCase());
    if (mode === "pending" && hasExistingNote) continue;

    const relativePath = child.path.startsWith(`${vaultPath}/`)
      ? child.path.slice(vaultPath.length + 1)
      : `${HANDWRITTEN_SPACE}/${child.name}`;

    out.push({
      path: child.path,
      fileName: child.name,
      relativePath,
      mdPath: child.path.replace(/\.[^.]+$/i, ".md"),
      hasExistingNote,
    });
  }

  return out.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export function mimeTypeForImagePath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

/** Markdown note body for a transcribed handwriting image. */
export function buildHandwritingNoteMarkdown(
  relativeImagePath: string,
  imageFileName: string,
  transcription: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const embedName = imageFileName.includes("/")
    ? imageFileName.split("/").pop()!
    : imageFileName;

  return [
    "---",
    `source_image: ${relativeImagePath}`,
    `transcribed_at: ${today}`,
    "type: handwriting",
    "---",
    "",
    `![${embedName}](${embedName})`,
    "",
    "## Transcription",
    "",
    transcription.trim(),
    "",
  ].join("\n");
}
