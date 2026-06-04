/** Pinned sidebar "Spaces" — vault folders created on open/create vault. */
export const PINNED_SPACE_NAMES = [
  "daily",
  "meetings",
  "summaries",
  "handwritten",
  "assets",
] as const;

export type PinnedSpaceName = (typeof PINNED_SPACE_NAMES)[number];

export const HANDWRITTEN_SPACE = "handwritten";

/** Whether a folder name is a pinned Space (case-insensitive). */
export function isPinnedSpaceName(name: string): boolean {
  const lower = name.toLowerCase();
  return PINNED_SPACE_NAMES.some((s) => s === lower);
}
