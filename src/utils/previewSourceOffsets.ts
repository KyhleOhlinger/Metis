/** Source offsets for Visual preview → Source navigation and in-place edits. */

const TASK_LINE_RE = /^([ \t]*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/;
const MD_LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export type SourceSpan = { from: number; to: number };

/** Character offsets of `[` in task markers, in document order. */
export function findTaskMarkerOffsets(content: string): number[] {
  const offsets: number[] = [];
  let pos = 0;
  for (const line of content.split("\n")) {
    const m = line.match(TASK_LINE_RE);
    if (m) offsets.push(pos + m[1].length);
    pos += line.length + 1;
  }
  return offsets;
}

/** Toggle `[ ]` ↔ `[x]` at a task marker offset (points at `[`). */
export function patchTaskMarker(content: string, markerOffset: number, checked: boolean): string {
  const ch = content[markerOffset + 1];
  if (ch !== " " && ch !== "x" && ch !== "X") return content;
  const next = checked ? "x" : " ";
  return content.slice(0, markerOffset + 1) + next + content.slice(markerOffset + 2);
}

/** Non-image markdown link spans in document order. */
export function findMarkdownLinkSpans(content: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  MD_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK_RE.exec(content)) !== null) {
    if (m.index > 0 && content[m.index - 1] === "!") continue;
    spans.push({ from: m.index, to: m.index + m[0].length });
  }
  return spans;
}

/** Wikilink spans (excludes image wikilinks `![[...]]`). */
export function findWikilinkSpans(content: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    if (m.index > 0 && content[m.index - 1] === "!") continue;
    spans.push({ from: m.index, to: m.index + m[0].length });
  }
  return spans;
}

/** Stamp `data-metis-source-offset` / end on preview checkboxes and markdown links. */
export function tagPreviewInteractiveHtml(
  html: string,
  taskMarkerOffsets: number[],
  linkSpans: SourceSpan[],
): string {
  let taskIdx = 0;
  let linkIdx = 0;

  return html.replace(/<(input|a)\b([^>]*)>/gi, (full, tag: string, attrs: string) => {
    if (tag.toLowerCase() === "input") {
      if (!/\btype\s*=\s*["']?checkbox/i.test(attrs)) return full;
      const offset = taskMarkerOffsets[taskIdx++];
      if (offset === undefined) return full;
      if (/\bdata-metis-source-offset=/i.test(attrs)) return full;
      return `<input${attrs} data-metis-source-offset="${offset}">`;
    }

    if (/\bdata-metis-wikilink=/i.test(attrs) || /\bdata-metis-source-offset=/i.test(attrs)) {
      return full;
    }
    const span = linkSpans[linkIdx++];
    if (!span) return full;
    return `<a${attrs} data-metis-source-offset="${span.from}" data-metis-source-end="${span.to}">`;
  });
}
