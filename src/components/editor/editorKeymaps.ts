import type { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { useStore } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";
import { toggleInline } from "../toolbarActions";
import type { EditorView } from "@codemirror/view";

export function buildEditorKeymaps(opts: {
  activeFilePath: string | null;
  markSaved: () => void;
  setFindBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setFindBarReplace: React.Dispatch<React.SetStateAction<boolean>>;
  findBarRef: RefObject<HTMLDivElement | null>;
}) {
  const { activeFilePath, markSaved, setFindBarOpen, setFindBarReplace, findBarRef } = opts;

  return [
    {
      key: "Tab",
      run(view: EditorView) {
        const { state } = view;
        if (state.selection.main.empty) {
          const pos = state.selection.main.from;
          const line = state.doc.lineAt(pos);
          const isListItem = /^\s*([-*+]|\d+\.)\s/.test(line.text);
          if (isListItem) {
            view.dispatch({
              changes: { from: line.from, insert: "    " },
            });
          } else {
            view.dispatch({
              changes: { from: pos, insert: "    " },
              selection: { anchor: pos + 4 },
            });
          }
          return true;
        }
        const changes: { from: number; insert: string }[] = [];
        const touched = new Set<number>();
        for (const range of state.selection.ranges) {
          const fLine = state.doc.lineAt(range.from).number;
          const tLine = state.doc.lineAt(range.to).number;
          for (let n = fLine; n <= tLine; n++) {
            if (!touched.has(n)) {
              touched.add(n);
              changes.push({ from: state.doc.line(n).from, insert: "    " });
            }
          }
        }
        view.dispatch({ changes });
        return true;
      },
    },
    {
      key: "Shift-Tab",
      run(view: EditorView) {
        const { state } = view;

        if (state.selection.main.empty) {
          const pos = state.selection.main.from;
          const line = state.doc.lineAt(pos);
          const LIST_RE = /^(\s*)([-*+])\s+(\[[ xX]\] )?|^(\s*)(\d+)\.\s/;
          const listMatch = LIST_RE.exec(line.text);

          if (listMatch) {
            const leadingWS = listMatch[1] ?? listMatch[4] ?? "";
            const indent = leadingWS.length;

            if (indent === 0) {
              const markerRE = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s?)?|\d+\.\s)/;
              const mm = markerRE.exec(line.text);
              const contentAfterMarker = mm ? line.text.slice(mm[0].length).trim() : "";
              const colInLine = pos - line.from;

              if (colInLine > 0 && contentAfterMarker.length > 0) {
                return true;
              }
              if (mm) {
                view.dispatch({
                  changes: { from: line.from, to: line.from + mm[0].length },
                  selection: { anchor: line.from },
                });
              }
              return true;
            }

            const lineNum = line.number;
            let lastChild = lineNum;
            for (let n = lineNum + 1; n <= state.doc.lines; n++) {
              const l = state.doc.line(n);
              if (l.text.trim() === "") {
                lastChild = n;
                continue;
              }
              const childIndent = l.text.match(/^(\s*)/)![1].length;
              if (childIndent > indent) lastChild = n;
              else break;
            }

            const spacesToRemove = Math.min(4, indent);
            const changes: { from: number; to: number }[] = [];
            for (let n = lineNum; n <= lastChild; n++) {
              const l = state.doc.line(n);
              let rm = 0;
              while (rm < spacesToRemove && l.text[rm] === " ") rm++;
              if (rm > 0) {
                changes.push({ from: l.from, to: l.from + rm });
              }
            }
            if (changes.length) {
              view.dispatch({ changes });
            }
            return true;
          }
        }

        const changes: { from: number; to: number }[] = [];
        const touched = new Set<number>();
        for (const range of state.selection.ranges) {
          const fLine = state.doc.lineAt(range.from).number;
          const tLine = state.doc.lineAt(range.to).number;
          for (let n = fLine; n <= tLine; n++) {
            if (!touched.has(n)) {
              touched.add(n);
              const l = state.doc.line(n);
              let spaces = 0;
              while (spaces < 4 && l.text[spaces] === " ") spaces++;
              if (spaces > 0) {
                changes.push({ from: l.from, to: l.from + spaces });
              }
            }
          }
        }
        if (changes.length) {
          view.dispatch({ changes });
        }
        return true;
      },
    },
    {
      key: "Mod-f",
      run() {
        if (useStore.getState().editorTab !== "source") return false;
        setFindBarOpen((prev) => {
          if (!prev) {
            setFindBarReplace(false);
            return true;
          }
          findBarRef.current?.querySelector<HTMLInputElement>("input")?.focus();
          return true;
        });
        return true;
      },
    },
    {
      key: "Mod-r",
      run() {
        if (useStore.getState().editorTab !== "source") return false;
        setFindBarOpen((prev) => {
          if (!prev) {
            setFindBarReplace(true);
            return true;
          }
          setFindBarReplace(true);
          setTimeout(() => {
            const inputs = findBarRef.current?.querySelectorAll<HTMLInputElement>("input");
            if (inputs && inputs.length > 1) inputs[1].focus();
            else inputs?.[0]?.focus();
          }, 0);
          return true;
        });
        return true;
      },
    },
    ...defaultKeymap,
    ...historyKeymap,
    {
      key: "Mod-s",
      run(view: EditorView) {
        invoke("save_note", {
          path: activeFilePath,
          content: view.state.doc.toString(),
        })
          .then(() => markSaved())
          .catch((err) => toastError(`Save failed: ${formatError(err)}`));
        return true;
      },
    },
    {
      key: "Mod-b",
      run(view: EditorView) {
        toggleInline(view, "**");
        return true;
      },
    },
    {
      key: "Mod-i",
      run(view: EditorView) {
        toggleInline(view, "_");
        return true;
      },
    },
  ];
}
