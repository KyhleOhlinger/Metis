/** Source-mode inline preview: images, tables, sticky drop, link clicks. */
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateField, EditorState, EditorSelection, type Text } from "@codemirror/state";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { resolveWikilinkAssetPath } from "@/utils/resolveWikilinkAsset";
import { normalizePosixPath, isPathWithinVault } from "@/utils/paths";
import {
  followVaultHref,
  openNoteByWikilinkNameFromStore,
  revealPlatformLabel,
  revealInFinder,
} from "@/utils/vaultNavigation";
import {
  resolveMarkdownImageAbsPath,
  resolveMarkdownImageSrc,
} from "@/utils/vaultImages";
import { openDomContextMenu } from "@/utils/domContextMenu";
import {
  METIS_STICKY_MIME,
  insertStickyNoteAt,
  parseStickyDragPayload,
} from "@/utils/stickyNotes";
import {
  escapeHtmlCell,
  selectionIntersectsRange,
  sourceImageRevealMenuItems,
  sourceLinkMenuItems,
} from "./editorPluginUtils";

// ── 9. Inline preview for source mode ────────────────────────────────────────
//
// Renders actual <img> elements directly below image markdown lines so the
// user doesn't need to switch to the Visual tab to see images.
// Links already receive blue/underline styling via metisHighlightStyle; here
// we also enable Cmd/Ctrl+Click to follow links without leaving source mode.

class InlineImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly revealAbsPath: string | null,
    readonly vaultPath: string,
  ) {
    super();
  }
  eq(other: InlineImageWidget) {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.revealAbsPath === this.revealAbsPath &&
      other.vaultPath === this.vaultPath
    );
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-inline-img-wrap";
    if (this.revealAbsPath) {
      wrap.dataset.revealPath = this.revealAbsPath;
    }
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    // Constrain size; hide silently if the asset fails to load
    img.style.cssText =
      "display:block;max-width:100%;max-height:280px;" +
      "margin:6px 0 10px;border-radius:6px;object-fit:contain;";
    img.onerror = () => {
      img.style.display = "none";
    };
    if (this.revealAbsPath) {
      wrap.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDomContextMenu(e.clientX, e.clientY, [
          {
            label: revealPlatformLabel(),
            onClick: () => revealInFinder(this.revealAbsPath!, this.vaultPath),
          },
        ]);
      };
    }
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent(event: Event): boolean {
    return event.type === "contextmenu";
  }
}


// Block decorations MUST come from a StateField, not from a ViewPlugin's
// `decorations` facet (CM6 throws "Block decorations may not be specified
// via plugins" otherwise).  We iterate the whole document so the StateField
// doesn't need viewport access; for typical note lengths this is negligible.
function buildInlineImageDecosFromState(
  state: EditorState,
  vaultPath: string,
  fileDir: string,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;

    // Standard markdown image: ![alt](src)
    const stdM = /!\[([^\]]*)\]\(([^)]+)\)/.exec(text);
    if (stdM) {
      const src = resolveMarkdownImageSrc(stdM[2].trim(), vaultPath, fileDir);
      const revealAbsPath = resolveMarkdownImageAbsPath(stdM[2].trim(), vaultPath, fileDir);
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new InlineImageWidget(src, stdM[1], revealAbsPath, vaultPath),
          side: 1,
          block: true,
        }),
      );
      continue;
    }

    // Wikilink image: ![[filename.ext]]
    // Use vault-wide asset resolution (Obsidian-compatible): the file is
    // searched by name across the entire vault, not just the vault root.
    const wikiM = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/i.exec(text);
    if (wikiM) {
      const { assetIndex } = useStore.getState();
      // resolveWikilinkAssetPath already normalises the path; validate it
      // still starts with the vault root before converting to asset:// URL.
      const resolvedPath = resolveWikilinkAssetPath(wikiM[1], assetIndex, vaultPath);
      const normalizedPath = normalizePosixPath(resolvedPath);
      if (!isPathWithinVault(normalizedPath, vaultPath)) continue;
      const src = convertFileSrc(normalizedPath);
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new InlineImageWidget(src, wikiM[1], normalizedPath, vaultPath),
          side: 1,
          block: true,
        }),
      );
    }
  }

  return builder.finish();
}

// StateField that owns the block image decorations and exposes them via the
// EditorView.decorations facet.  filePath / vaultPath are closed over so the
// field is re-created whenever the active file changes (see Editor.tsx).
function makeImageDecosField(vaultPath: string, filePath: string) {
  const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));
  return StateField.define<DecorationSet>({
    create(state) {
      return buildInlineImageDecosFromState(state, vaultPath, fileDir);
    },
    update(decos, tr) {
      // Rebuild on document changes; remap positions otherwise.
      if (tr.docChanged) {
        return buildInlineImageDecosFromState(tr.state, vaultPath, fileDir);
      }
      return decos.map(tr.changes);
    },
    provide(f) {
      return EditorView.decorations.from(f);
    },
  });
}

// ── GFM pipe tables: render preview while unfocused (caret outside table) ─────
//
// Mirrors link-collapse UX: raw markdown is editable whenever the primary
// selection intersects the table; moving the caret away replaces the pipe
// block with a read-only HTML preview widget. Clicking the preview jumps the
// caret back to the table start.

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

interface MdTableSpan {
  startLine: number;
  endLine: number;
}

function findCompleteMarkdownTables(doc: Text): MdTableSpan[] {
  const out: MdTableSpan[] = [];
  let lineNo = 1;
  while (lineNo <= doc.lines) {
    const rowText = doc.line(lineNo).text;
    if (!isPipeTableRow(rowText)) {
      lineNo++;
      continue;
    }
    const startLine = lineNo;
    const rows: string[] = [];
    while (lineNo <= doc.lines && isPipeTableRow(doc.line(lineNo).text)) {
      rows.push(doc.line(lineNo).text);
      lineNo++;
    }
    if (rows.length < 3 || !isPipeTableSeparator(rows[1])) continue;

    const headerCols = splitPipeTableCells(rows[0]);
    const sepCols = splitPipeTableCells(rows[1]);
    if (headerCols.length !== sepCols.length || headerCols.length < 2) continue;

    let consistent = true;
    for (let i = 2; i < rows.length; i++) {
      if (splitPipeTableCells(rows[i]).length !== headerCols.length) {
        consistent = false;
        break;
      }
    }
    if (consistent) {
      out.push({ startLine, endLine: startLine + rows.length - 1 });
    }
  }
  return out;
}

/** Lines that render a block image preview widget below the markdown syntax. */
function findInlineImageLines(doc: Text): number[] {
  const lines: number[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (/!\[([^\]]*)\]\(([^)]+)\)/.test(text)) {
      lines.push(n);
      continue;
    }
    if (/!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/i.test(text)) {
      lines.push(n);
    }
  }
  return lines;
}

function buildTablePreviewHtml(rows: string[]): string {
  const headerCells = splitPipeTableCells(rows[0]);
  const bodyRows = rows.slice(2);
  let html = '<table class="cm-md-table-preview-table"><thead><tr>';
  for (const h of headerCells) {
    html += `<th>${escapeHtmlCell(h)}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (const row of bodyRows) {
    html += "<tr>";
    for (const c of splitPipeTableCells(row)) {
      html += `<td>${escapeHtmlCell(c)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

class CollapsedMarkdownTableWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly tableFrom: number,
    readonly tableTo: number,
  ) {
    super();
  }
  eq(other: CollapsedMarkdownTableWidget) {
    return (
      other.html === this.html &&
      other.tableFrom === this.tableFrom &&
      other.tableTo === this.tableTo
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-preview cm-md-table-preview--collapsed";
    wrap.title = "Click to edit table";
    wrap.innerHTML = this.html;
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.focus();
      view.dispatch({
        selection: EditorSelection.cursor(this.tableFrom),
        scrollIntoView: true,
      });
    });
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function buildMarkdownTableCollapseDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  for (const span of findCompleteMarkdownTables(doc)) {
    const startLine = doc.line(span.startLine);
    const endLine = doc.line(span.endLine);
    const from = startLine.from;
    const to = endLine.to;

    if (selectionIntersectsRange(state.selection, from, to)) {
      continue;
    }

    const rows: string[] = [];
    for (let ln = span.startLine; ln <= span.endLine; ln++) {
      rows.push(doc.line(ln).text);
    }
    const html = buildTablePreviewHtml(rows);

    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new CollapsedMarkdownTableWidget(html, from, to),
        block: true,
      }),
    );
  }

  return builder.finish();
}

function makeMarkdownTableCollapseField() {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildMarkdownTableCollapseDecorations(state);
    },
    update(_decos, tr) {
      // Selection affects collapse vs raw markdown — rebuild each transaction (cheap vs doc size).
      return buildMarkdownTableCollapseDecorations(tr.state);
    },
    provide(f) {
      return EditorView.decorations.from(f);
    },
  });
}

function isStickyDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = [...dt.types];
  return types.includes(METIS_STICKY_MIME) || types.includes("text/plain");
}

function readStickyDragPayload(dt: DataTransfer): string | null {
  const raw = dt.getData(METIS_STICKY_MIME) || dt.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { color?: string };
    if (parsed && typeof parsed.color === "string") return raw;
  } catch {
    /* not our payload */
  }
  return null;
}

function makeStickyDropHandler() {
  return EditorView.domEventHandlers({
    dragenter(event) {
      if (isStickyDrag(event.dataTransfer)) {
        event.preventDefault();
      }
    },
    dragover(event) {
      if (isStickyDrag(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer!.dropEffect = "copy";
      }
    },
    drop(event, view) {
      const raw = readStickyDragPayload(event.dataTransfer!);
      if (!raw) return false;
      event.preventDefault();
      const coords = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (coords === null) return false;
      const attrs = parseStickyDragPayload(raw);
      insertStickyNoteAt(view, coords, attrs);
      return true;
    },
  });
}

/** Collapsed tables and inline image previews are atomic for arrow-key caret motion. */
function makeInlinePreviewAtomicRanges() {
  return EditorView.atomicRanges.of((view) => {
    const { state } = view;
    const builder = new RangeSetBuilder<Decoration>();
    const mark = Decoration.mark({ class: "cm-inline-preview-atomic" });

    for (const span of findCompleteMarkdownTables(state.doc)) {
      const from = state.doc.line(span.startLine).from;
      const to = state.doc.line(span.endLine).to;
      if (!selectionIntersectsRange(state.selection, from, to)) {
        builder.add(from, to, mark);
      }
    }

    for (const lineNo of findInlineImageLines(state.doc)) {
      const line = state.doc.line(lineNo);
      if (!selectionIntersectsRange(state.selection, line.from, line.to)) {
        builder.add(line.from, line.to, mark);
      }
    }

    return builder.finish();
  });
}

function followMarkdownLinkAtColumn(
  text: string,
  col: number,
  fileDir: string,
  vaultPath: string,
  filePath: string,
): boolean {
  const mdLinkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLinkRe.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (col < start || col > end) continue;
    followVaultHref(m[2].trim(), { fileDir, vaultPath, filePath });
    return true;
  }

  const wikiRe = /\[\[([^\]]+)\]\]/g;
  while ((m = wikiRe.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (col < start || col > end) continue;
    openNoteByWikilinkNameFromStore(m[1]);
    return true;
  }

  return false;
}

/** Cmd/Ctrl+Click follows links; plain click places the caret (collapsed links expand for editing). */
function makeLinkClickHandler(vaultPath: string, filePath: string) {
  const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));

  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.metaKey && !event.ctrlKey) return false;

      const el = event.target as HTMLElement;
      const collapsedHref = el
        .closest("[data-md-link-href]")
        ?.getAttribute("data-md-link-href")
        ?.trim();
      if (collapsedHref) {
        event.preventDefault();
        followVaultHref(collapsedHref, { fileDir, vaultPath, filePath });
        return true;
      }

      const coords = { x: event.clientX, y: event.clientY };
      const pos = view.posAtCoords(coords);
      if (pos === null) return false;

      const line = view.state.doc.lineAt(pos);
      const col = pos - line.from;
      if (followMarkdownLinkAtColumn(line.text, col, fileDir, vaultPath, filePath)) {
        event.preventDefault();
        return true;
      }

      return false;
    },
    contextmenu(event, view) {
      const imgWrap = (event.target as HTMLElement | null)?.closest(
        ".cm-inline-img-wrap[data-reveal-path]",
      ) as HTMLElement | null;
      const revealPath = imgWrap?.dataset.revealPath?.trim();
      if (revealPath) {
        event.preventDefault();
        openDomContextMenu(event.clientX, event.clientY, [
          {
            label: revealPlatformLabel(),
            onClick: () => revealInFinder(revealPath, vaultPath),
          },
        ]);
        return true;
      }

      const fromCollapsed = (event.target as HTMLElement | null)?.closest(
        "[data-md-link-href]",
      ) as HTMLElement | null;
      const collapsedHref = fromCollapsed?.dataset.mdLinkHref?.trim();
      if (collapsedHref) {
        event.preventDefault();
        openDomContextMenu(
          event.clientX,
          event.clientY,
          sourceLinkMenuItems(collapsedHref, fileDir, vaultPath),
        );
        return true;
      }

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const col = pos - line.from;

      // Standard image markdown: ![alt](src)
      const mdImageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = mdImageRe.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (col < start || col > end) continue;
        const src = m[2].trim();
        const items = sourceImageRevealMenuItems(src, fileDir, vaultPath);
        if (items) {
          event.preventDefault();
          openDomContextMenu(event.clientX, event.clientY, items);
          return true;
        }
        break;
      }

      // Wikilink image: ![[filename.ext]]
      const wikiImageRe = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/gi;
      while ((m = wikiImageRe.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (col < start || col > end) continue;
        const filename = m[1].trim();
        const { assetIndex } = useStore.getState();
        const resolvedPath = normalizePosixPath(
          resolveWikilinkAssetPath(filename, assetIndex, vaultPath),
        );
        if (!resolvedPath.startsWith(`${vaultPath}/`)) break;
        event.preventDefault();
        openDomContextMenu(event.clientX, event.clientY, [
          {
            label: revealPlatformLabel(),
            onClick: () => revealInFinder(resolvedPath, vaultPath),
          },
        ]);
        return true;
      }

      const mdLinkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
      while ((m = mdLinkRe.exec(text)) !== null) {
        if (m.index > 0 && text[m.index - 1] === "!") continue;
        const start = m.index;
        const end = start + m[0].length;
        if (col < start || col > end) continue;
        const url = m[2].trim();
        event.preventDefault();
        openDomContextMenu(
          event.clientX,
          event.clientY,
          sourceLinkMenuItems(url, fileDir, vaultPath),
        );
        return true;
      }

      const wikiRe = /\[\[([^\]]+)\]\]/g;
      while ((m = wikiRe.exec(text)) !== null) {
        if (m.index > 0 && text[m.index - 1] === "!") continue;
        const start = m.index;
        const end = start + m[0].length;
        if (col < start || col > end) continue;
        const name = m[1].trim();
        event.preventDefault();
        openDomContextMenu(event.clientX, event.clientY, [
          {
            label: "Open Note",
            onClick: () => openNoteByWikilinkNameFromStore(name),
          },
        ]);
        return true;
      }

      return false;
    },
  });
}

/**
 * Call this factory inside the editor's extension list, passing the active
 * vault path and file path so images resolve correctly.
 */
export function makeInlinePreviewExtension(
  vaultPath: string,
  filePath: string,
) {
  return [
    makeImageDecosField(vaultPath, filePath),
    makeMarkdownTableCollapseField(),
    makeInlinePreviewAtomicRanges(),
    makeLinkClickHandler(vaultPath, filePath),
    makeStickyDropHandler(),
  ];
}
