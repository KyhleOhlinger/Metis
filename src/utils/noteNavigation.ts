import type { NoteMetadata } from "@/store/useStore";

export const MAX_RECENT_NOTES = 12;
/** How many recent notes the sidebar and empty state show. */
export const RECENT_NOTES_SHOWN = 5;
export const MAX_PINNED_NOTES = 24;

export interface VaultNoteNavigation {
  pinned: string[];
  recent: string[];
}

export function recordRecentNote(
  nav: VaultNoteNavigation | undefined,
  notePath: string,
): VaultNoteNavigation {
  const pinned = nav?.pinned ?? [];
  const recent = [
    notePath,
    ...(nav?.recent ?? []).filter((p) => p !== notePath),
  ].slice(0, MAX_RECENT_NOTES);
  return { pinned, recent };
}

export function togglePinnedNote(
  nav: VaultNoteNavigation | undefined,
  notePath: string,
): VaultNoteNavigation {
  const pinned = nav?.pinned ?? [];
  const recent = nav?.recent ?? [];
  if (pinned.includes(notePath)) {
    return { pinned: pinned.filter((p) => p !== notePath), recent };
  }
  return {
    pinned: [...pinned, notePath].slice(0, MAX_PINNED_NOTES),
    recent,
  };
}

export function isNotePinned(nav: VaultNoteNavigation | undefined, notePath: string): boolean {
  return (nav?.pinned ?? []).includes(notePath);
}

export function mergeVaultNavigation(
  all: Record<string, VaultNoteNavigation> | undefined,
  vaultPath: string,
  entry: VaultNoteNavigation,
): Record<string, VaultNoteNavigation> {
  return { ...(all ?? {}), [vaultPath]: entry };
}

/** Pinned notes, then recent notes that are not already pinned. */
export function splitQuickNotes(
  nav: VaultNoteNavigation | undefined,
  noteIndex: NoteMetadata[],
): { pinned: NoteMetadata[]; recent: NoteMetadata[] } {
  const pinned = resolveNotePaths(nav?.pinned ?? [], noteIndex);
  const pinnedSet = new Set(nav?.pinned ?? []);
  const recent = resolveNotePaths(nav?.recent ?? [], noteIndex).filter(
    (note) => !pinnedSet.has(note.path),
  );
  return { pinned, recent };
}

/** Keep only paths that still exist in the vault index. */
export function resolveNotePaths(
  paths: string[],
  noteIndex: NoteMetadata[],
): NoteMetadata[] {
  const byPath = new Map(noteIndex.map((n) => [n.path, n]));
  const out: NoteMetadata[] = [];
  for (const path of paths) {
    const note = byPath.get(path);
    if (note) out.push(note);
  }
  return out;
}

export function noteDisplayTitle(note: NoteMetadata): string {
  return note.name.replace(/\.md$/i, "") || note.name;
}

export function removeNoteFromNavigation(
  nav: VaultNoteNavigation | undefined,
  notePath: string,
): VaultNoteNavigation {
  return {
    pinned: (nav?.pinned ?? []).filter((p) => p !== notePath),
    recent: (nav?.recent ?? []).filter((p) => p !== notePath),
  };
}

export function pruneVaultNavigation(
  nav: VaultNoteNavigation | undefined,
  validPaths: Set<string>,
): VaultNoteNavigation {
  return {
    pinned: (nav?.pinned ?? []).filter((p) => validPaths.has(p)),
    recent: (nav?.recent ?? []).filter((p) => validPaths.has(p)),
  };
}
