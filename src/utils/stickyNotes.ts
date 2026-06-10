import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { usePersonaStore } from "@/store/usePersonaStore";
import { DEFAULT_SETTINGS } from "@/types/persona";
import { sanitizeMarkdownHtml, escapeHtml } from "./markdownHtml";
import { parseMarkedWithHighlight } from "./markedHighlight";

/** Drag-and-drop MIME for toolbar → editor sticky insertion. */
export const METIS_STICKY_MIME = "application/x-metis-sticky";

export type StickyFloat = "left" | "right" | "none";
export type StickyColor =
  | "amber"
  | "yellow"
  | "pink"
  | "blue"
  | "green"
  | "purple"
  | "slate";

export interface StickyAttrs {
  float: StickyFloat;
  width: string;
  color: StickyColor;
}

export interface StickyBlockSpan {
  startLine: number;
  endLine: number;
  from: number;
  to: number;
  attrs: StickyAttrs;
  body: string;
}

export interface StickyWrapBlockSpan {
  startLine: number;
  endLine: number;
  from: number;
  to: number;
  body: string;
}

export interface StickyPair {
  sticky: StickyBlockSpan;
  wrap: StickyWrapBlockSpan | null;
}

/** Source offsets for Visual click-to-edit and preview sidecar maps. */
export interface StickyPairOffsets {
  stickyFrom: number;
  stickyTo: number;
  wrapFrom: number | null;
  wrapTo: number | null;
}

/** Character offsets for a line index (matches CodeMirror `doc.line(n).from/to`). */
function lineCharRange(lines: string[], lineIdx: number): { from: number; to: number } {
  let from = 0;
  for (let i = 0; i < lineIdx; i++) {
    from += lines[i].length + 1;
  }
  return { from, to: from + lines[lineIdx].length };
}

/** Source offsets from raw markdown (no CodeMirror `Text` — safe in Visual preview bundle). */
export function listStickyPairOffsets(markdown: string): StickyPairOffsets[] {
  const lines = markdown.split("\n");
  const out: StickyPairOffsets[] = [];
  let lineNo = 0;

  while (lineNo < lines.length) {
    const stickyParsed = parseFenceBlock(lines, lineNo, STICKY_OPEN_RE);
    if (!stickyParsed) {
      lineNo++;
      continue;
    }

    const stickyOpen = lineCharRange(lines, lineNo);
    const stickyClose = lineCharRange(lines, stickyParsed.closeIdx);
    const wrapParsed = findWrapAfterStickyInLines(lines, stickyParsed.closeIdx);

    out.push({
      stickyFrom: stickyOpen.from,
      stickyTo: stickyClose.to,
      wrapFrom: wrapParsed ? lineCharRange(lines, wrapParsed.startIdx).from : null,
      wrapTo: wrapParsed ? lineCharRange(lines, wrapParsed.closeIdx).to : null,
    });

    lineNo = wrapParsed ? wrapParsed.closeIdx + 1 : stickyParsed.closeIdx + 1;
  }

  return out;
}

/** Placeholder body inserted for new sticky notes (handwritten tone). */
export const DEFAULT_STICKY_PLACEHOLDER = "Jot something down…";
export const DEFAULT_STICKY_WRAP_PLACEHOLDER = "Text beside the sticky…";

export const STICKY_COLOR_PRESETS: {
  color: StickyColor;
  label: string;
  swatch: string;
}[] = [
  { color: "amber", label: "Amber", swatch: "#fbbf24" },
  { color: "yellow", label: "Yellow", swatch: "#facc15" },
  { color: "pink", label: "Pink", swatch: "#f472b6" },
  { color: "blue", label: "Blue", swatch: "#60a5fa" },
  { color: "green", label: "Green", swatch: "#4ade80" },
  { color: "purple", label: "Purple", swatch: "#c084fc" },
  { color: "slate", label: "Slate", swatch: "#94a3b8" },
];

const FALLBACK_ATTRS: StickyAttrs = {
  float: "right",
  width: "12rem",
  color: "amber",
};

const VALID_FLOATS = new Set<StickyFloat>(["left", "right", "none"]);
const VALID_COLORS = new Set<StickyColor>([
  "amber",
  "yellow",
  "pink",
  "blue",
  "green",
  "purple",
  "slate",
]);

const STICKY_OPEN_RE = /^:::\s*sticky(?:\s*\{([^}]*)\})?\s*$/i;
const STICKY_WRAP_OPEN_RE = /^:::\s*stickywrap\s*$/i;
const FENCE_CLOSE_RE = /^:::\s*$/;

/** User-configured defaults from Settings (falls back to shipped presets). */
export function getDefaultStickyAttrs(): StickyAttrs {
  const saved = usePersonaStore.getState().settings.stickyDefaults;
  const base = { ...FALLBACK_ATTRS, ...DEFAULT_SETTINGS.stickyDefaults, ...saved };
  return {
    float: VALID_FLOATS.has(base.float as StickyFloat)
      ? (base.float as StickyFloat)
      : FALLBACK_ATTRS.float,
    width:
      base.width && base.width.length > 0 && base.width.length <= 24
        ? base.width
        : FALLBACK_ATTRS.width,
    color: VALID_COLORS.has(base.color as StickyColor)
      ? (base.color as StickyColor)
      : FALLBACK_ATTRS.color,
  };
}

/** When true, toolbar/slash insert also adds a `:::stickywrap` block after the sticky. */
export function getDefaultIncludeWrapBlock(): boolean {
  const saved = usePersonaStore.getState().settings.stickyDefaults;
  const legacy = saved as { wrap?: boolean; includeWrapBlock?: boolean };
  if (legacy.includeWrapBlock !== undefined) return legacy.includeWrapBlock === true;
  // Migrate legacy `wrap` default (old implicit line-count behaviour).
  if (legacy.wrap !== undefined) return legacy.wrap === true;
  return DEFAULT_SETTINGS.stickyDefaults?.includeWrapBlock === true;
}

/** Strip trailing blank / whitespace-only lines inside a fence body (for render only). */
function normalizeFenceBody(raw: string): string {
  const lines = raw.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

/** Parse `{float="right" width="12rem" color="amber"}` attribute string. */
export function parseStickyAttrs(raw: string | undefined): StickyAttrs {
  const attrs = { ...getDefaultStickyAttrs() };
  if (!raw?.trim()) return attrs;

  const pairRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(raw)) !== null) {
    const key = m[1].toLowerCase();
    const value = (m[2] ?? m[3] ?? "").trim();
    if (key === "float" && VALID_FLOATS.has(value as StickyFloat)) {
      attrs.float = value as StickyFloat;
    } else if (key === "width" && value.length > 0 && value.length <= 24) {
      attrs.width = value;
    } else if (key === "color" && VALID_COLORS.has(value as StickyColor)) {
      attrs.color = value as StickyColor;
    }
    // Legacy `wrap="…"` is ignored — use `:::stickywrap` instead.
  }
  return attrs;
}

function stickyCanFloatBeside(attrs: StickyAttrs): boolean {
  return attrs.float !== "none";
}

function parseFenceBlock(
  lines: string[],
  startIdx: number,
  openRe: RegExp,
): { body: string; closeIdx: number } | null {
  if (startIdx >= lines.length || !openRe.test(lines[startIdx])) return null;
  const bodyLines: string[] = [];
  let closeIdx = startIdx + 1;
  while (closeIdx < lines.length && !FENCE_CLOSE_RE.test(lines[closeIdx])) {
    bodyLines.push(lines[closeIdx]);
    closeIdx++;
  }
  if (closeIdx >= lines.length) return null;
  return { body: normalizeFenceBody(bodyLines.join("\n")), closeIdx };
}

function parseFenceBlockInDoc(
  doc: Text,
  startLineNo: number,
  openRe: RegExp,
): { body: string; endLine: number; from: number; to: number } | null {
  const openLine = doc.line(startLineNo);
  if (!openRe.test(openLine.text)) return null;

  const bodyLines: string[] = [];
  let closeLineNo = startLineNo + 1;
  while (closeLineNo <= doc.lines) {
    const text = doc.line(closeLineNo).text;
    if (FENCE_CLOSE_RE.test(text)) break;
    bodyLines.push(text);
    closeLineNo++;
  }
  if (closeLineNo > doc.lines) return null;

  const closeLine = doc.line(closeLineNo);
  return {
    body: normalizeFenceBody(bodyLines.join("\n")),
    endLine: closeLineNo,
    from: openLine.from,
    to: closeLine.to,
  };
}

/** Index after `closeIdx`, skipping at most one blank line before an optional wrap fence. */
function indexAfterStickyClose(lines: string[], closeIdx: number): number {
  let idx = closeIdx + 1;
  if (idx < lines.length && lines[idx].trim() === "") idx++;
  return idx;
}

function findWrapAfterStickyInLines(
  lines: string[],
  stickyCloseIdx: number,
): { body: string; closeIdx: number; startIdx: number } | null {
  const startIdx = indexAfterStickyClose(lines, stickyCloseIdx);
  const parsed = parseFenceBlock(lines, startIdx, STICKY_WRAP_OPEN_RE);
  if (!parsed) return null;
  return { ...parsed, startIdx };
}

function findWrapAfterStickyInDoc(
  doc: Text,
  stickyEndLine: number,
): StickyWrapBlockSpan | null {
  let lineNo = stickyEndLine + 1;
  if (lineNo <= doc.lines && doc.line(lineNo).text.trim() === "") lineNo++;
  const parsed = parseFenceBlockInDoc(doc, lineNo, STICKY_WRAP_OPEN_RE);
  if (!parsed) return null;
  return {
    startLine: lineNo,
    endLine: parsed.endLine,
    from: parsed.from,
    to: parsed.to,
    body: parsed.body,
  };
}

/** Locate complete `:::sticky` … `:::` blocks in a CodeMirror document. */
export function findStickyBlocks(doc: Text): StickyBlockSpan[] {
  return findStickyPairs(doc).map((p) => p.sticky);
}

/** Sticky + optional following `:::stickywrap` block. */
export function findStickyPairs(doc: Text): StickyPair[] {
  const out: StickyPair[] = [];
  let lineNo = 1;

  while (lineNo <= doc.lines) {
    const parsed = parseFenceBlockInDoc(doc, lineNo, STICKY_OPEN_RE);
    if (!parsed) {
      lineNo++;
      continue;
    }

    const openLine = doc.line(lineNo);
    const openMatch = STICKY_OPEN_RE.exec(openLine.text);
    const attrs = parseStickyAttrs(openMatch?.[1]);

    const sticky: StickyBlockSpan = {
      startLine: lineNo,
      endLine: parsed.endLine,
      from: parsed.from,
      to: parsed.to,
      attrs,
      body: parsed.body,
    };

    const wrap = findWrapAfterStickyInDoc(doc, parsed.endLine);
    out.push({ sticky, wrap });
    lineNo = wrap ? wrap.endLine + 1 : parsed.endLine + 1;
  }

  return out;
}

function formatStickyAttrs(attrs: StickyAttrs): string {
  return `float="${attrs.float}" width="${attrs.width}" color="${attrs.color}"`;
}

/** Default markdown snippet for a new sticky note. */
export function buildStickyMarkdown(
  partial: Partial<StickyAttrs> = {},
  body = DEFAULT_STICKY_PLACEHOLDER,
): string {
  const attrs = { ...getDefaultStickyAttrs(), ...partial };
  const text = normalizeFenceBody(body);
  return `:::sticky {${formatStickyAttrs(attrs)}}\n${text}\n:::\n`;
}

/** Explicit wrap-zone fence — content renders beside the sticky when floated. */
export function buildStickyWrapMarkdown(body = DEFAULT_STICKY_WRAP_PLACEHOLDER): string {
  const text = normalizeFenceBody(body);
  return `:::stickywrap\n${text}\n:::\n`;
}

/** Sticky + optional wrap block for toolbar / slash menu. */
export function buildStickyWithWrapMarkdown(
  partial: Partial<StickyAttrs> = {},
  stickyBody = DEFAULT_STICKY_PLACEHOLDER,
  wrapBody = DEFAULT_STICKY_WRAP_PLACEHOLDER,
): string {
  return buildStickyMarkdown(partial, stickyBody) + buildStickyWrapMarkdown(wrapBody);
}

/** Render markdown beside a floated sticky (Visual / collapsed Source preview). */
export function parseStickyAdjacentMarkdown(md: string): string {
  if (!md) return "";
  const raw = parseMarkedWithHighlight(md, { gfm: true, breaks: true });
  return sanitizeMarkdownHtml(raw, { taskLists: true });
}

/** Render sticky body markdown to sanitized HTML. */
export function stickyBodyToHtml(body: string): string {
  const trimmed = normalizeFenceBody(body.trim());
  if (!trimmed) return "";
  const raw = parseMarkedWithHighlight(trimmed, { gfm: true, breaks: true });
  const html = sanitizeMarkdownHtml(raw, { taskLists: true });
  return html.replace(/(?:\s*<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>)+\s*$/gi, "");
}

/** Build preview `<aside>` HTML for source widgets and Visual mode. */
export function buildStickyPreviewHtml(
  attrs: StickyAttrs,
  body: string,
  stickyIdx?: number,
): string {
  const inner = stickyBodyToHtml(body);
  const floatMod =
    attrs.float === "none" ? " metis-sticky--nofloat" : ` metis-sticky--${attrs.float}`;
  const width = escapeHtml(attrs.width);
  const idxAttr =
    stickyIdx !== undefined ? ` data-metis-sticky-idx="${stickyIdx}"` : "";
  return (
    `<aside class="metis-sticky metis-sticky--${attrs.color}${floatMod}"` +
    `${idxAttr} data-metis-sticky-width="${width}" ` +
    `style="--metis-sticky-width:${width}">${inner}</aside>`
  );
}

/** Sticky card + optional `:::stickywrap` body + clearfix. */
export function buildStickyBlockPreviewHtml(
  attrs: StickyAttrs,
  body: string,
  wrapMarkdown?: string,
  stickyIdx?: number,
): string {
  const parts = [buildStickyPreviewHtml(attrs, body, stickyIdx)];
  const wrap = wrapMarkdown?.trim();
  if (wrap) {
    const inner = parseStickyAdjacentMarkdown(wrap);
    const idxAttr =
      stickyIdx !== undefined ? ` data-metis-sticky-idx="${stickyIdx}"` : "";
    if (stickyCanFloatBeside(attrs)) {
      parts.push(`<div class="metis-sticky-wrap"${idxAttr}>${inner}</div>`);
    } else {
      parts.push(inner);
    }
  }
  parts.push('<div class="metis-sticky-clear" aria-hidden="true"></div>');
  return parts.join("\n\n");
}

/** Replace sticky (+ optional stickywrap) fences before `marked.parse` in Visual preview. */
export function preprocessStickyBlocksForPreview(markdown: string): string {
  const lines = markdown.split("\n");
  const chunks: string[] = [];
  let lineNo = 0;
  let stickyIdx = 0;

  while (lineNo < lines.length) {
    const stickyParsed = parseFenceBlock(lines, lineNo, STICKY_OPEN_RE);
    if (!stickyParsed) {
      const start = lineNo;
      while (lineNo < lines.length && !STICKY_OPEN_RE.test(lines[lineNo])) {
        lineNo++;
      }
      chunks.push(lines.slice(start, lineNo).join("\n"));
      continue;
    }

    const openMatch = STICKY_OPEN_RE.exec(lines[lineNo]);
    const attrs = parseStickyAttrs(openMatch?.[1]);
    const wrapParsed = findWrapAfterStickyInLines(lines, stickyParsed.closeIdx);

    let wrapMarkdown: string | undefined;
    let afterIdx = stickyParsed.closeIdx + 1;
    if (wrapParsed) {
      wrapMarkdown = wrapParsed.body;
      afterIdx = wrapParsed.closeIdx + 1;
    }

    chunks.push(
      buildStickyBlockPreviewHtml(attrs, stickyParsed.body, wrapMarkdown, stickyIdx),
    );
    stickyIdx += 1;
    lineNo = afterIdx;
  }

  return chunks.filter((chunk) => chunk.length > 0).join("\n\n");
}

function stickyInsertSelection(selectFrom: number, selectLen: number) {
  return {
    anchor: selectFrom,
    head: selectFrom + selectLen,
  };
}

export type InsertStickyOptions = {
  /** Insert a `:::stickywrap` block after the sticky (default from Settings). */
  includeWrap?: boolean;
  wrapBody?: string;
};

function buildInsertMarkdown(
  partial: Partial<StickyAttrs>,
  body: string,
  options?: InsertStickyOptions,
): { markdown: string; selectLen: number } {
  const includeWrap = options?.includeWrap ?? getDefaultIncludeWrapBlock();
  if (includeWrap) {
    const wrapBody = options?.wrapBody ?? DEFAULT_STICKY_WRAP_PLACEHOLDER;
    const markdown = buildStickyWithWrapMarkdown(partial, body, wrapBody);
    return { markdown, selectLen: body.length };
  }
  const markdown = buildStickyMarkdown(partial, body);
  return { markdown, selectLen: body.length };
}

/** Insert a sticky block at a document offset (toolbar pointer drag / HTML5 drop). */
export function insertStickyNoteAt(
  view: EditorView,
  pos: number,
  partial: Partial<StickyAttrs> = {},
  body = DEFAULT_STICKY_PLACEHOLDER,
  options?: InsertStickyOptions,
) {
  const { markdown, selectLen } = buildInsertMarkdown(partial, body, options);
  const insert = `\n\n${markdown}`;
  const bodyStart = insert.indexOf(body);
  const selectFrom = pos + (bodyStart >= 0 ? bodyStart : insert.length - 5);
  view.dispatch({
    changes: { from: pos, insert },
    selection: stickyInsertSelection(selectFrom, selectLen),
  });
  view.focus();
}

/** Insert a sticky block at the current line (toolbar click / slash menu). */
export function insertStickyNote(
  view: EditorView,
  partial: Partial<StickyAttrs> = {},
  body = DEFAULT_STICKY_PLACEHOLDER,
  options?: InsertStickyOptions,
) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const insertPos = line.to;
  const { markdown, selectLen } = buildInsertMarkdown(partial, body, options);
  const insert = `\n\n${markdown}`;
  const bodyStart = insert.indexOf(body);
  const selectFrom = insertPos + (bodyStart >= 0 ? bodyStart : insert.length - 5);
  view.dispatch({
    changes: { from: insertPos, insert },
    selection: stickyInsertSelection(selectFrom, selectLen),
  });
  view.focus();
}

/** Payload for drag-and-drop from the formatting toolbar. */
export function stickyDragPayload(partial: Partial<StickyAttrs> = {}): string {
  return JSON.stringify({ ...getDefaultStickyAttrs(), ...partial });
}

export function parseStickyDragPayload(raw: string): Partial<StickyAttrs> {
  try {
    const parsed = JSON.parse(raw) as Partial<StickyAttrs>;
    return parseStickyAttrs(
      Object.entries(parsed)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" "),
    );
  } catch {
    return getDefaultStickyAttrs();
  }
}

/** Slash-menu snippet using current sticky defaults. */
export function buildDefaultStickySlashInsert(includeWrap = false): string {
  return includeWrap
    ? buildStickyWithWrapMarkdown(getDefaultStickyAttrs())
    : buildStickyMarkdown(getDefaultStickyAttrs());
}
