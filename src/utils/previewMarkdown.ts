/** Visual preview: preserve source blank lines before rendered blocks (marked collapses them). */

const STICKY_OPEN_RE = /^:::\s*sticky(?:\s*\{([^}]*)\})?\s*$/i;
const STICKY_WRAP_OPEN_RE = /^:::\s*stickywrap\s*$/i;
const MD_IMAGE_LINE_RE = /!\[([^\]]*)\]\(([^)]+)\)/;
const WIKI_IMAGE_LINE_RE = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/i;

/** Markdown paragraph line — marked parses it; raw HTML spacers break GFM tables/images. */
const PREVIEW_SPACER_LINE = "&nbsp;";

function splitPipeTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isPipeTableRow(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && t.length >= 3;
}

function isPipeTableSeparator(line: string): boolean {
  const cells = splitPipeTableCells(line);
  return cells.length >= 2 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function isPipeTableStart(lines: string[], idx: number): boolean {
  if (idx + 1 >= lines.length) return false;
  if (!isPipeTableRow(lines[idx])) return false;
  if (!isPipeTableSeparator(lines[idx + 1])) return false;
  return splitPipeTableCells(lines[idx]).length >= 2;
}

function isImageLine(line: string): boolean {
  const t = line.trim();
  return MD_IMAGE_LINE_RE.test(t) || WIKI_IMAGE_LINE_RE.test(t);
}

function isRenderedBlockStart(lines: string[], idx: number): boolean {
  const line = lines[idx];
  if (STICKY_OPEN_RE.test(line) || STICKY_WRAP_OPEN_RE.test(line)) return true;
  if (isImageLine(line)) return true;
  if (isPipeTableStart(lines, idx)) return true;
  return false;
}

function countPrecedingBlankLines(lines: string[], blockIdx: number): number {
  let count = 0;
  for (let i = blockIdx - 1; i >= 0 && lines[i].trim() === ""; i--) {
    count++;
  }
  return count;
}

/** Replace blank lines immediately above stickies, tables, and images with spacer HTML. */
export function preserveBlankLinesBeforeRenderedBlocks(markdown: string): string {
  if (!markdown) return markdown;

  const lines = markdown.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!isRenderedBlockStart(lines, i)) {
      out.push(lines[i]);
      continue;
    }

    const blanks = countPrecedingBlankLines(lines, i);
    for (let removed = 0; removed < blanks && out.length > 0; removed++) {
      if (out[out.length - 1].trim() !== "") break;
      out.pop();
    }
    for (let b = 0; b < blanks; b++) {
      out.push("");
      out.push(PREVIEW_SPACER_LINE);
    }
    out.push(lines[i]);
  }

  return out.join("\n");
}
