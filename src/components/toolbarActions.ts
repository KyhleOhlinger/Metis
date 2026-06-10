import { EditorView } from "@codemirror/view";

/** Returns the primary selection range from the view. */
function sel(view: EditorView) {
  return view.state.selection.main;
}

/**
 * Wrap/unwrap inline syntax (e.g. **bold**, _italic_, `code`).
 * - With selection  → wraps or unwraps
 * - No selection    → inserts markers and places cursor in the middle
 */
export function toggleInline(view: EditorView, marker: string) {
  const { from, to } = sel(view);
  const selected = view.state.sliceDoc(from, to);
  const len = marker.length;

  const before = view.state.sliceDoc(Math.max(0, from - len), from);
  const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + len));

  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: from - len, to: from, insert: "" },
        { from: to, to: to + len, insert: "" },
      ],
      selection: { anchor: from - len, head: to - len },
    });
  } else if (selected.length > 0) {
    view.dispatch({
      changes: { from, to, insert: `${marker}${selected}${marker}` },
      selection: { anchor: from + len, head: to + len },
    });
  } else {
    view.dispatch({
      changes: { from, insert: `${marker}${marker}` },
      selection: { anchor: from + len },
    });
  }
  view.focus();
}

/**
 * Insert (or wrap the current line in) a `> [!TYPE]` callout block.
 * If the current line has text it becomes the callout body; otherwise
 * an empty body line is created and the cursor placed there.
 */
export function insertCallout(view: EditorView, type: string) {
  const { from } = sel(view);
  const line = view.state.doc.lineAt(from);
  const header = `> [!${type}]\n`;
  const body = `> ${line.text}`;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: `${header}${body}` },
    selection: { anchor: line.from + header.length + body.length },
  });
  view.focus();
}
