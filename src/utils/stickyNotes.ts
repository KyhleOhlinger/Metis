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
  wrap: boolean;
}

export interface StickyBlockSpan {
  startLine: number;
  endLine: number;
  from: number;
  to: number;
  attrs: StickyAttrs;
  body: string;
}

/** Matches `.metis-sticky` font-size × line-height in `index.css`. */
export const STICKY_RENDER_LINE_PX = 15.75 * 1.5;

/** Placeholder body inserted for new sticky notes (handwritten tone). */
export const DEFAULT_STICKY_PLACEHOLDER = "Jot something down…";

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
  wrap: true,
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
    wrap: base.wrap !== false,
  };
}

const STICKY_OPEN_RE = /^:::\s*sticky(?:\s*\{([^}]*)\})?\s*$/i;
const STICKY_CLOSE_RE = /^:::\s*$/;

/** Strip trailing blank / whitespace-only lines inside a sticky body (for render only). */
function normalizeStickyBody(raw: string): string {
  const lines = raw.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

function parseWrapValue(value: string): boolean | undefined {
  const v = value.toLowerCase();
  if (["true", "1", "yes"].includes(v)) return true;
  if (["false", "0", "no"].includes(v)) return false;
  return undefined;
}

/** Parse `{float="right" width="12rem" color="amber" wrap="true"}` attribute string. */
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
    } else if (key === "wrap") {
      const parsed = parseWrapValue(value);
      if (parsed !== undefined) attrs.wrap = parsed;
    }
  }
  return attrs;
}

function stickyWrapEnabled(attrs: StickyAttrs): boolean {
  return attrs.wrap && attrs.float !== "none";
}

let stickyMeasureHost: HTMLElement | null = null;

function getStickyMeasureHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (!stickyMeasureHost) {
    stickyMeasureHost = document.createElement("div");
    stickyMeasureHost.className = "preview-prose metis-sticky-measure-host";
    stickyMeasureHost.setAttribute("aria-hidden", "true");
    document.body.appendChild(stickyMeasureHost);
  }
  return stickyMeasureHost;
}

/** How many editor text lines tall the rendered sticky card is (DOM measure in preview). */
export function stickyRenderedLineCount(attrs: StickyAttrs, body: string): number {
  const normalized = normalizeStickyBody(body.trim());
  if (!normalized) return 1;

  const host = getStickyMeasureHost();
  if (!host) return 1;

  host.innerHTML = buildStickyPreviewHtml(attrs, normalized);
  const el = host.querySelector<HTMLElement>(".metis-sticky");
  if (!el) return 1;

  const height = el.getBoundingClientRect().height;
  return Math.max(1, Math.ceil(height / STICKY_RENDER_LINE_PX));
}

/** Locate complete `:::sticky` … `:::` blocks in a CodeMirror document. */
export function findStickyBlocks(doc: Text): StickyBlockSpan[] {
  const out: StickyBlockSpan[] = [];
  let lineNo = 1;

  while (lineNo <= doc.lines) {
    const openLine = doc.line(lineNo);
    const openMatch = STICKY_OPEN_RE.exec(openLine.text);
    if (!openMatch) {
      lineNo++;
      continue;
    }

    const attrs = parseStickyAttrs(openMatch[1]);
    const bodyLines: string[] = [];
    let closeLineNo = lineNo + 1;

    while (closeLineNo <= doc.lines) {
      const text = doc.line(closeLineNo).text;
      if (STICKY_CLOSE_RE.test(text)) break;
      bodyLines.push(text);
      closeLineNo++;
    }

    if (closeLineNo > doc.lines) {
      lineNo++;
      continue;
    }

    const body = normalizeStickyBody(bodyLines.join("\n"));
    const closeLine = doc.line(closeLineNo);
    out.push({
      startLine: lineNo,
      endLine: closeLineNo,
      from: openLine.from,
      to: closeLine.to,
      attrs,
      body,
    });
    lineNo = closeLineNo + 1;
  }

  return out;
}

function formatStickyAttrs(attrs: StickyAttrs): string {
  return `float="${attrs.float}" width="${attrs.width}" color="${attrs.color}" wrap="${attrs.wrap}"`;
}

/** Default markdown snippet for a new sticky note. */
export function buildStickyMarkdown(
  partial: Partial<StickyAttrs> = {},
  body = DEFAULT_STICKY_PLACEHOLDER,
): string {
  const attrs = { ...getDefaultStickyAttrs(), ...partial };
  const text = normalizeStickyBody(body);
  return (
    `:::sticky {${formatStickyAttrs(attrs)}}\n` +
    `${text}\n` +
    `:::\n`
  );
}

/** Render markdown beside a floated sticky (Visual preview only). */
export function parseStickyAdjacentMarkdown(md: string): string {
  if (!md) return "";
  const raw = parseMarkedWithHighlight(md, { gfm: true, breaks: true });
  return sanitizeMarkdownHtml(raw, { taskLists: true });
}

/** Render sticky body markdown to sanitized HTML. */
export function stickyBodyToHtml(body: string): string {
  const trimmed = normalizeStickyBody(body.trim());
  if (!trimmed) return "";
  const raw = parseMarkedWithHighlight(trimmed, { gfm: true, breaks: true });
  const html = sanitizeMarkdownHtml(raw, { taskLists: true });
  return html.replace(/(?:\s*<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>)+\s*$/gi, "");
}

/** Build preview `<aside>` HTML for source widgets and Visual mode. */
export function buildStickyPreviewHtml(attrs: StickyAttrs, body: string): string {
  const inner = stickyBodyToHtml(body);
  const floatMod =
    attrs.float === "none" ? " metis-sticky--nofloat" : ` metis-sticky--${attrs.float}`;
  const width = escapeHtml(attrs.width);
  return (
    `<aside class="metis-sticky metis-sticky--${attrs.color}${floatMod}" ` +
    `data-metis-sticky-width="${width}" ` +
    `style="--metis-sticky-width:${width}">${inner}</aside>`
  );
}

/** Sticky card + optional wrap-zone markdown + clearfix (Visual). Source uses sticky + clear only. */
export function buildStickyBlockPreviewHtml(
  attrs: StickyAttrs,
  body: string,
  wrapMarkdown?: string,
): string {
  const parts = [buildStickyPreviewHtml(attrs, body)];
  if (wrapMarkdown !== undefined && stickyWrapEnabled(attrs)) {
    parts.push(parseStickyAdjacentMarkdown(wrapMarkdown));
  }
  parts.push('<div class="metis-sticky-clear" aria-hidden="true"></div>');
  return parts.join("\n\n");
}

/** Replace sticky fences (+ wrap-zone lines) before `marked.parse` in Visual preview. */
export function preprocessStickyBlocksForPreview(markdown: string): string {
  const lines = markdown.split("\n");
  const chunks: string[] = [];
  let lineNo = 0;

  while (lineNo < lines.length) {
    const openMatch = STICKY_OPEN_RE.exec(lines[lineNo]);
    if (!openMatch) {
      const start = lineNo;
      while (lineNo < lines.length && !STICKY_OPEN_RE.test(lines[lineNo])) {
        lineNo++;
      }
      chunks.push(lines.slice(start, lineNo).join("\n"));
      continue;
    }

    const attrs = parseStickyAttrs(openMatch[1]);
    const bodyLines: string[] = [];
    let closeIdx = lineNo + 1;
    while (closeIdx < lines.length && !STICKY_CLOSE_RE.test(lines[closeIdx])) {
      bodyLines.push(lines[closeIdx]);
      closeIdx++;
    }
    if (closeIdx >= lines.length) {
      chunks.push(lines[lineNo]);
      lineNo++;
      continue;
    }

    const body = normalizeStickyBody(bodyLines.join("\n"));
    const wrapLineCount = stickyRenderedLineCount(attrs, body);

    let afterSticky = closeIdx + 1;
    let wrapMarkdown: string | undefined;
    if (stickyWrapEnabled(attrs)) {
      const wrapLines = lines.slice(afterSticky, afterSticky + wrapLineCount);
      afterSticky += wrapLines.length;
      wrapMarkdown = wrapLines.join("\n");
    }

    chunks.push(buildStickyBlockPreviewHtml(attrs, body, wrapMarkdown));
    lineNo = afterSticky;
  }

  return chunks.filter((chunk) => chunk.length > 0).join("\n\n");
}

function stickyInsertSelection(insert: string, body: string, basePos: number) {
  const bodyStart = insert.indexOf(body);
  const anchor = basePos + (bodyStart >= 0 ? bodyStart : insert.length - 5);
  return {
    anchor,
    head: anchor + (bodyStart >= 0 ? body.length : 0),
  };
}

/** Insert a sticky block at a document offset (toolbar pointer drag / HTML5 drop). */
export function insertStickyNoteAt(
  view: EditorView,
  pos: number,
  partial: Partial<StickyAttrs> = {},
  body = DEFAULT_STICKY_PLACEHOLDER,
) {
  const insert = `\n\n${buildStickyMarkdown(partial, body)}`;
  view.dispatch({
    changes: { from: pos, insert },
    selection: stickyInsertSelection(insert, body, pos),
  });
  view.focus();
}

/** Insert a sticky block at the current line (toolbar click / slash menu). */
export function insertStickyNote(
  view: EditorView,
  partial: Partial<StickyAttrs> = {},
  body = DEFAULT_STICKY_PLACEHOLDER,
) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const insertPos = line.to;
  const insert = `\n\n${buildStickyMarkdown(partial, body)}`;
  view.dispatch({
    changes: { from: insertPos, insert },
    selection: stickyInsertSelection(insert, body, insertPos),
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

/** Slash-menu / docs snippet using current sticky defaults. */
export function buildDefaultStickySlashInsert(): string {
  return buildStickyMarkdown(getDefaultStickyAttrs());
}
