import { ChangeSet, EditorSelection, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export function sel(view: EditorView) {
  return view.state.selection.main;
}

export function stripListPrefix(text: string): string {
  return text
    .replace(/^- \[[ xX]\] /, "")
    .replace(/^[-*+] /, "")
    .replace(/^\d+\. /, "");
}

export function linesInSelection(view: EditorView) {
  const { from, to } = sel(view);
  const doc = view.state.doc;
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const first = doc.lineAt(a);
  const last = doc.lineAt(b);
  const out: (typeof first)[] = [];
  for (let n = first.number; n <= last.number; n++) {
    out.push(doc.line(n));
  }
  return out;
}

export function dispatchListChanges(view: EditorView, changes: ChangeSpec[]) {
  const { from, to } = sel(view);
  const cs = ChangeSet.of(changes, view.state.doc.length);
  view.dispatch({
    changes,
    selection: EditorSelection.range(cs.mapPos(from, 1), cs.mapPos(to, 1)),
    scrollIntoView: true,
  });
  view.focus();
}

export function toggleHeading(view: EditorView, level: 1 | 2 | 3) {
  const { from } = sel(view);
  const line = view.state.doc.lineAt(from);
  const prefix = "#".repeat(level) + " ";

  const stripped = line.text.replace(/^#{1,6} /, "");
  const alreadySet = line.text.startsWith(prefix);

  view.dispatch({
    changes: {
      from: line.from,
      to: line.to,
      insert: alreadySet ? stripped : `${prefix}${stripped}`,
    },
    selection: {
      anchor: alreadySet
        ? line.from + stripped.length
        : line.from + prefix.length + stripped.length,
    },
  });
  view.focus();
}

export function insertCodeBlock(view: EditorView) {
  const { from, to } = sel(view);
  const selected = view.state.sliceDoc(from, to);
  const code = selected.length > 0 ? selected : "code";
  const insert = `\`\`\`\n${code}\n\`\`\``;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + 4, head: from + 4 + code.length },
  });
  view.focus();
}

export function insertLink(view: EditorView) {
  const { from, to } = sel(view);
  const label = view.state.sliceDoc(from, to) || "text";
  const insert = `[${label}](url)`;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + label.length + 3, head: from + insert.length - 1 },
  });
  view.focus();
}

export function insertImage(view: EditorView) {
  const { from, to } = sel(view);
  const alt = view.state.sliceDoc(from, to) || "image";
  const insert = `![${alt}](url)`;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + alt.length + 4, head: from + insert.length - 1 },
  });
  view.focus();
}

export function toggleBlockquote(view: EditorView) {
  const { from } = sel(view);
  const line = view.state.doc.lineAt(from);

  if (line.text.startsWith("> ")) {
    view.dispatch({
      changes: { from: line.from, to: line.from + 2, insert: "" },
      selection: { anchor: from - 2 },
    });
  } else {
    view.dispatch({
      changes: { from: line.from, insert: "> " },
      selection: { anchor: from + 2 },
    });
  }
  view.focus();
}

export function insertHRule(view: EditorView) {
  const { from } = sel(view);
  const line = view.state.doc.lineAt(from);
  const insertPos = line.to;
  view.dispatch({
    changes: { from: insertPos, insert: "\n\n---\n" },
    selection: { anchor: insertPos + 6 },
  });
  view.focus();
}

export function insertTable(view: EditorView) {
  const { from } = sel(view);
  const line = view.state.doc.lineAt(from);
  const insertPos = line.to;
  const insert = "\n\n| Header | Header |\n| --- | --- |\n| Cell | Cell |\n";
  view.dispatch({
    changes: { from: insertPos, insert },
    selection: { anchor: insertPos + insert.indexOf("Cell") },
  });
  view.focus();
}
