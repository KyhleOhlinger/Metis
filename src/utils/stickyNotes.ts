import { marked } from "marked";
import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sanitizeMarkdownHtml, escapeHtml } from "./markdownHtml";

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

const DEFAULT_ATTRS: StickyAttrs = {
  float: "right",
  width: "12rem",
  color: "amber",
};

const STICKY_OPEN_RE = /^:::\s*sticky(?:\s*\{([^}]*)\})?\s*$/i;
const STICKY_CLOSE_RE = /^:::\s*$/;

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

/** Parse `{float="right" width="12rem" color="amber"}` attribute string. */
export function parseStickyAttrs(raw: string | undefined): StickyAttrs {
  const attrs: StickyAttrs = { ...DEFAULT_ATTRS };
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
  }
  return attrs;
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

    const closeLine = doc.line(closeLineNo);
    out.push({
      startLine: lineNo,
      endLine: closeLineNo,
      from: openLine.from,
      to: closeLine.to,
      attrs,
      body: bodyLines.join("\n"),
    });
    lineNo = closeLineNo + 1;
  }

  return out;
}

/** Default markdown snippet for a new sticky note. */
export function buildStickyMarkdown(
  partial: Partial<StickyAttrs> = {},
  body = DEFAULT_STICKY_PLACEHOLDER,
): string {
  const attrs = { ...DEFAULT_ATTRS, ...partial };
  return (
    `:::sticky {float="${attrs.float}" width="${attrs.width}" color="${attrs.color}"}\n` +
    `${body}\n` +
    `:::\n`
  );
}

/** Render sticky body markdown to sanitized HTML. */
export function stickyBodyToHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  const raw = marked.parse(trimmed, { gfm: true, breaks: true }) as string;
  return sanitizeMarkdownHtml(raw, { taskLists: true });
}

/** Build preview `<aside>` HTML for source widgets and Visual mode. */
export function buildStickyPreviewHtml(attrs: StickyAttrs, body: string): string {
  const inner = stickyBodyToHtml(body);
  const floatMod = attrs.float === "none" ? "" : ` metis-sticky--${attrs.float}`;
  const width = escapeHtml(attrs.width);
  return (
    `<aside class="metis-sticky metis-sticky--${attrs.color}${floatMod}" ` +
    `style="width:${width}">${inner}</aside>`
  );
}

const STICKY_BLOCK_MD_RE =
  /:::sticky(?:\s*\{([^}]*)\})?\s*\n([\s\S]*?)\n:::/gi;

/** Replace sticky fences with HTML before `marked.parse` in Visual preview. */
export function preprocessStickyBlocksForPreview(markdown: string): string {
  return markdown.replace(STICKY_BLOCK_MD_RE, (_, attrRaw, body) =>
    buildStickyPreviewHtml(parseStickyAttrs(attrRaw), body),
  );
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
  return JSON.stringify({ ...DEFAULT_ATTRS, ...partial });
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
    return DEFAULT_ATTRS;
  }
}
