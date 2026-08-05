/** CodeMirror editor plugin helpers shared across extension modules. */
import type { EditorState } from "@codemirror/state";
import { escapeHtml } from "@/utils/markdownHtml";
import {
  followVaultHref,
  revealPlatformLabel,
  revealInFinder,
} from "@/utils/vaultNavigation";
import { resolveMarkdownImageAbsPath } from "@/utils/vaultImages";

export function escapeHtmlCell(s: string): string {
  return escapeHtml(s);
}

/** True when the caret or selection should show raw markdown (not collapsed preview). */
export function selectionIntersectsRange(
  sel: EditorState["selection"],
  from: number,
  to: number,
): boolean {
  const { main } = sel;
  if (main.empty) {
    return main.head >= from && main.head < to;
  }
  return main.from < to && main.to > from;
}

export function sourceLinkMenuItems(href: string, fileDir: string, vaultPath: string) {
  const trimmed = href.trim();
  const label = /^https?:\/\//i.test(trimmed) ? "Open Link" : "Open Note";
  return [
    {
      label,
      onClick: () => followVaultHref(trimmed, { fileDir, vaultPath }),
    },
  ];
}

export function sourceImageRevealMenuItems(
  src: string,
  fileDir: string,
  vaultPath: string,
): Array<{ label: string; onClick: () => void }> | null {
  const absPath = resolveMarkdownImageAbsPath(src, vaultPath, fileDir);
  if (!absPath) return null;
  return [
    {
      label: revealPlatformLabel(),
      onClick: () => revealInFinder(absPath, vaultPath),
    },
  ];
}
