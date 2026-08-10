import type { EditorState } from "@codemirror/state";

/** YAML frontmatter block at document start (`---` … `---`). */
export const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Number of document lines covered by the frontmatter block (0 when absent). */
export function frontmatterLineCount(state: EditorState): number {
  const text = state.doc.sliceString(0, Math.min(state.doc.length, 4_000));
  const match = text.match(FRONTMATTER_RE);
  if (!match) return 0;
  return (match[0].match(/\n/g) ?? []).length;
}

/** Document offset where editable body content begins (after frontmatter). */
export function frontmatterEndPos(state: EditorState): number {
  const text = state.doc.sliceString(0, Math.min(state.doc.length, 4_000));
  const match = text.match(FRONTMATTER_RE);
  return match ? match[0].length : 0;
}

/** First body line number — selection/caret motion should not enter lines above this. */
export function firstBodyLineNumber(state: EditorState): number {
  const fmLines = frontmatterLineCount(state);
  return fmLines > 0 ? fmLines + 1 : 1;
}
