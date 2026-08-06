import type { ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  dispatchListChanges,
  linesInSelection,
  stripListPrefix,
} from "./toolbarBlockFormat";

export function toggleBulletList(view: EditorView) {
  const lines = linesInSelection(view);
  const allBulleted = lines.length > 0 && lines.every((l) => /^- /.test(l.text));
  const changes: ChangeSpec[] = [];

  if (allBulleted) {
    for (const line of lines) {
      const m = line.text.match(/^- /);
      if (!m) continue;
      changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
    }
  } else {
    for (const line of lines) {
      const body = stripListPrefix(line.text);
      const oldPrefixLen = line.text.length - body.length;
      changes.push({ from: line.from, to: line.from + oldPrefixLen, insert: "- " });
    }
  }

  dispatchListChanges(view, changes);
}

export function toggleOrderedList(view: EditorView) {
  const lines = linesInSelection(view);
  const allOrdered = lines.length > 0 && lines.every((l) => /^\d+\. /.test(l.text));
  const changes: ChangeSpec[] = [];

  if (allOrdered) {
    for (const line of lines) {
      const m = line.text.match(/^\d+\. /);
      if (!m) continue;
      changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
    }
  } else {
    let n = 1;
    for (const line of lines) {
      const body = stripListPrefix(line.text);
      const oldPrefixLen = line.text.length - body.length;
      changes.push({ from: line.from, to: line.from + oldPrefixLen, insert: `${n}. ` });
      n += 1;
    }
  }

  dispatchListChanges(view, changes);
}

export function toggleTaskList(view: EditorView) {
  const lines = linesInSelection(view);
  const taskRe = /^- \[[ xX]\] /;
  const allTask = lines.length > 0 && lines.every((l) => taskRe.test(l.text));
  const changes: ChangeSpec[] = [];

  if (allTask) {
    for (const line of lines) {
      const m = line.text.match(taskRe);
      if (!m) continue;
      changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
    }
  } else {
    for (const line of lines) {
      const body = stripListPrefix(line.text);
      const oldPrefixLen = line.text.length - body.length;
      changes.push({ from: line.from, to: line.from + oldPrefixLen, insert: "- [ ] " });
    }
  }

  dispatchListChanges(view, changes);
}
