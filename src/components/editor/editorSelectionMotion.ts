import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { firstBodyLineNumber } from "./frontmatterUtils";

function setSelection(view: EditorView, selection: EditorSelection): boolean {
  if (selection.eq(view.state.selection, true)) return false;
  view.dispatch(
    view.state.update({ selection, scrollIntoView: true, userEvent: "select" }),
  );
  return true;
}

/**
 * Move by document line (not visual/wrapped line). Avoids broken vertical motion
 * when frontmatter is hidden or inline preview widgets alter layout height.
 */
function moveByDocumentLine(
  view: EditorView,
  range: EditorSelection["main"],
  forward: boolean,
): EditorSelection["main"] {
  const state = view.state;
  const line = state.doc.lineAt(range.head);
  const minLine = firstBodyLineNumber(state);
  const targetLineNum = line.number + (forward ? 1 : -1);

  if (targetLineNum < minLine) {
    const clampPos = state.doc.line(minLine).from;
    if (range.head === clampPos) return range;
    return EditorSelection.cursor(clampPos, 1);
  }
  if (targetLineNum > state.doc.lines) return range;

  const targetLine = state.doc.line(targetLineNum);
  const col = range.head - line.from;
  const targetPos = Math.min(targetLine.from + col, targetLine.to);
  return EditorSelection.cursor(targetPos, targetPos < range.head ? 1 : -1);
}

function moveVertically(view: EditorView, forward: boolean, extend: boolean): boolean {
  const updateRange = (range: EditorSelection["main"]) => {
    const headRange = extend
      ? moveByDocumentLine(view, EditorSelection.cursor(range.head), forward)
      : moveByDocumentLine(view, range, forward);

    if (headRange.head === range.head && headRange.assoc === range.assoc) return range;

    if (extend) {
      return EditorSelection.range(
        range.anchor,
        headRange.head,
        headRange.goalColumn,
        headRange.bidiLevel ?? undefined,
        headRange.assoc,
      );
    }
    return headRange;
  };

  const ranges = view.state.selection.ranges.map(updateRange);
  const selection = EditorSelection.create(ranges, view.state.selection.mainIndex);
  return setSelection(view, selection);
}

export function metisCursorLineUp(view: EditorView): boolean {
  return moveVertically(view, false, false);
}

export function metisCursorLineDown(view: EditorView): boolean {
  return moveVertically(view, true, false);
}

export function metisSelectLineUp(view: EditorView): boolean {
  return moveVertically(view, false, true);
}

export function metisSelectLineDown(view: EditorView): boolean {
  return moveVertically(view, true, true);
}

function moveToDocumentLineEdge(
  view: EditorView,
  range: EditorSelection["main"],
  toStart: boolean,
  extend: boolean,
): EditorSelection["main"] {
  const state = view.state;
  const line = state.doc.lineAt(range.head);
  const minLine = firstBodyLineNumber(state);
  let pos = toStart ? line.from : line.to;
  if (toStart && line.number < minLine) {
    pos = state.doc.line(minLine).from;
  }

  if (extend) {
    if (pos === range.head) return range;
    return EditorSelection.range(
      range.anchor,
      pos,
      range.goalColumn,
      range.bidiLevel ?? undefined,
      toStart ? 1 : -1,
    );
  }
  if (pos === range.head) return range;
  return EditorSelection.cursor(pos, toStart ? 1 : -1);
}

function moveHorizontally(view: EditorView, toStart: boolean, extend: boolean): boolean {
  const updateRange = (range: EditorSelection["main"]) =>
    moveToDocumentLineEdge(view, range, toStart, extend);

  const ranges = view.state.selection.ranges.map(updateRange);
  const selection = EditorSelection.create(ranges, view.state.selection.mainIndex);
  return setSelection(view, selection);
}

export function metisCursorLineStart(view: EditorView): boolean {
  return moveHorizontally(view, true, false);
}

export function metisCursorLineEnd(view: EditorView): boolean {
  return moveHorizontally(view, false, false);
}

export function metisSelectLineStart(view: EditorView): boolean {
  return moveHorizontally(view, true, true);
}

export function metisSelectLineEnd(view: EditorView): boolean {
  return moveHorizontally(view, false, true);
}
