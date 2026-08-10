import type { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultKeymap, historyKeymap, selectLine } from "@codemirror/commands";
import { Compartment } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";
import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { toastError } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";
import { toggleInline } from "../toolbarActions";
import type { EditorView } from "@codemirror/view";
import type { KeybindingCommandId } from "@/config/keybindingRegistry";
import { chordToCmKey } from "@/utils/keyChord";
import { getChordsForCommand } from "@/services/keybindingRuntime";
import {
  metisCursorLineDown,
  metisCursorLineEnd,
  metisCursorLineStart,
  metisCursorLineUp,
  metisSelectLineDown,
  metisSelectLineEnd,
  metisSelectLineStart,
  metisSelectLineUp,
} from "./editorSelectionMotion";

export const editorKeymapCompartment = new Compartment();

export type EditorKeymapOpts = {
  activeFilePath: string | null;
  markSaved: () => void;
  setFindBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setFindBarReplace: React.Dispatch<React.SetStateAction<boolean>>;
  findBarRef: RefObject<HTMLDivElement | null>;
};

function cmBindingsForCommand(
  id: KeybindingCommandId,
  spec: {
    run: (view: EditorView) => boolean;
    shift?: (view: EditorView) => boolean;
  },
): KeyBinding[] {
  const settings = usePersonaStore.getState().settings;
  const chords = getChordsForCommand(id, settings);
  const bindings: KeyBinding[] = [];

  for (const chord of chords) {
    if (chord.shift && spec.shift) {
      bindings.push({
        key: chordToCmKey(chord),
        run: spec.shift,
        preventDefault: true,
      });
      continue;
    }
    if (!chord.shift) {
      bindings.push({
        key: chordToCmKey(chord),
        run: spec.run,
        shift: spec.shift,
        preventDefault: true,
      });
      continue;
    }
    bindings.push({
      key: chordToCmKey(chord),
      run: spec.shift ?? spec.run,
      preventDefault: true,
    });
  }

  return bindings;
}

function tabBinding(): KeyBinding {
  return {
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
  };
}

function shiftTabBinding(): KeyBinding {
  return {
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
  };
}

export function buildEditorKeymaps(opts: EditorKeymapOpts): KeyBinding[] {
  const { activeFilePath, markSaved, setFindBarOpen, setFindBarReplace, findBarRef } = opts;

  const findRun = () => {
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
  };

  const replaceRun = () => {
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
  };

  const saveRun = (view: EditorView) => {
    invoke("save_note", {
      path: activeFilePath,
      content: view.state.doc.toString(),
    })
      .then(() => markSaved())
      .catch((err) => toastError(`Save failed: ${formatError(err)}`));
    return true;
  };

  const dynamic: KeyBinding[] = [
    ...cmBindingsForCommand("indent", { run: tabBinding().run! }),
    ...cmBindingsForCommand("outdent", { run: shiftTabBinding().run! }),
    ...cmBindingsForCommand("find", { run: findRun }),
    ...cmBindingsForCommand("find-replace", { run: replaceRun }),
    ...cmBindingsForCommand("line-up", {
      run: metisCursorLineUp,
      shift: metisSelectLineUp,
    }),
    ...cmBindingsForCommand("line-down", {
      run: metisCursorLineDown,
      shift: metisSelectLineDown,
    }),
    ...cmBindingsForCommand("line-start", {
      run: metisCursorLineStart,
      shift: metisSelectLineStart,
    }),
    ...cmBindingsForCommand("line-end", {
      run: metisCursorLineEnd,
      shift: metisSelectLineEnd,
    }),
    ...cmBindingsForCommand("save", { run: saveRun }),
    ...cmBindingsForCommand("bold", {
      run: (view) => {
        toggleInline(view, "**");
        return true;
      },
    }),
    ...cmBindingsForCommand("italic", {
      run: (view) => {
        toggleInline(view, "_");
        return true;
      },
    }),
    ...cmBindingsForCommand("select-line", { run: selectLine }),
  ];

  const settings = usePersonaStore.getState().settings;
  const hasIndent = getChordsForCommand("indent", settings).length > 0;
  const hasOutdent = getChordsForCommand("outdent", settings).length > 0;
  const staticIndent = [
    ...(hasIndent ? [] : [tabBinding()]),
    ...(hasOutdent ? [] : [shiftTabBinding()]),
  ];

  return [
    ...staticIndent,
    ...dynamic,
    ...defaultKeymap,
    ...historyKeymap,
  ];
}

export function editorKeymapExtension(opts: EditorKeymapOpts) {
  return editorKeymapCompartment.of(keymap.of(buildEditorKeymaps(opts)));
}
