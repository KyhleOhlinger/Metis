import type { NoteMetadata } from "@/store/useStore";
import { findNoteByWikilinkName } from "@/utils/vaultNavigation";

const WIKILINK_RE = /(?<!!)\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g;

/** Wikilink targets in note body (excludes image embeds). */
export function extractWikilinkTargets(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    const target = m[1].trim();
    const key = target.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(target);
    }
  }
  return out;
}

/**
 * Build incoming backlink map: target note path → list of source note paths
 * that link to it via [[wikilinks]].
 */
export function buildBacklinkIndex(
  noteIndex: NoteMetadata[],
  contentsByPath: Map<string, string>,
  vaultPath: string,
): Map<string, string[]> {
  const incoming = new Map<string, Set<string>>();

  for (const note of noteIndex) {
    incoming.set(note.path, new Set());
  }

  for (const source of noteIndex) {
    const content = contentsByPath.get(source.path) ?? "";
    for (const targetName of extractWikilinkTargets(content)) {
      const target = findNoteByWikilinkName(targetName, noteIndex, vaultPath);
      if (!target || target.path === source.path) continue;
      const set = incoming.get(target.path);
      if (set) set.add(source.path);
    }
  }

  const out = new Map<string, string[]>();
  for (const [path, sources] of incoming) {
    out.set(path, [...sources].sort((a, b) => a.localeCompare(b)));
  }
  return out;
}

/** Display names for backlink source paths. */
export function backlinkLabels(paths: string[]): string[] {
  return paths.map((p) => {
    const name = p.split("/").pop() ?? p;
    return name.replace(/\.md$/i, "");
  });
}

/** Rebuild incoming backlinks after a single source note changes. */
export function patchBacklinkIndexForSource(
  backlinkIndex: Record<string, string[]>,
  sourcePath: string,
  content: string,
  noteIndex: NoteMetadata[],
  vaultPath: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [target, sources] of Object.entries(backlinkIndex)) {
    const filtered = sources.filter((s) => s !== sourcePath);
    if (filtered.length > 0) next[target] = filtered;
  }

  for (const targetName of extractWikilinkTargets(content)) {
    const target = findNoteByWikilinkName(targetName, noteIndex, vaultPath);
    if (!target || target.path === sourcePath) continue;
    const list = next[target.path] ?? [];
    if (!list.includes(sourcePath)) {
      next[target.path] = [...list, sourcePath].sort((a, b) => a.localeCompare(b));
    }
  }

  return next;
}
