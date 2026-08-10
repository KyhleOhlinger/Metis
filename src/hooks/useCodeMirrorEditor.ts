import { useEffect, type MutableRefObject, type RefObject } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { history } from "@codemirror/commands";
import { search } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { indentUnit } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { useStore } from "@/store/useStore";
import {
  metisLineNumbers,
  codeBlockPlugin,
  copyButtonPlugin,
  calloutPlugin,
  markdownAutoComplete,
  wikilinkExtensions,
  markdownLinkCollapseExtension,
  markdownCaretAtomicExtension,
  taskListClickExtension,
  listContinuationKeymap,
  smartPasteExtension,
  makeInlinePreviewExtension,
  hideFrontmatterField,
} from "@/components/editorExtensions";
import {
  buildEditorKeymaps,
  editorKeymapCompartment,
  editorKeymapExtension,
  type EditorKeymapOpts,
} from "@/components/editor/editorKeymaps";
import { makeSpellcheckExt } from "@/components/editor/editorSpellcheck";
import {
  bgCompartment,
  highlightCompartment,
  highlightForPreset,
  makeBgTheme,
  metisTheme,
  spellcheckCompartment,
  type BgPreset,
} from "@/components/editor/bgPresets";
import type { Settings } from "@/types/persona";

interface Options {
  editorHostRef: RefObject<HTMLDivElement | null>;
  viewRef: MutableRefObject<EditorView | null>;
  activeFilePath: string | null;
  activeFileContent: string;
  isImageFile: boolean;
  vaultPath: string | null;
  bgPresetRef: MutableRefObject<BgPreset>;
  spellcheckRef: MutableRefObject<boolean>;
  spellcheckLangRef: MutableRefObject<string>;
  setActiveFileContent: (content: string) => void;
  scheduleSave: (path: string | null, content: string) => void;
  markSaved: () => void;
  setFindBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setFindBarReplace: React.Dispatch<React.SetStateAction<boolean>>;
  findBarRef: RefObject<HTMLDivElement | null>;
}

/** Create / destroy CodeMirror when the active file changes; sync external content updates. */
export function useCodeMirrorEditor({
  editorHostRef,
  viewRef,
  activeFilePath,
  activeFileContent,
  isImageFile,
  vaultPath,
  bgPresetRef,
  spellcheckRef,
  spellcheckLangRef,
  setActiveFileContent,
  scheduleSave,
  markSaved,
  setFindBarOpen,
  setFindBarReplace,
  findBarRef,
}: Options) {
  useEffect(() => {
    if (!editorHostRef.current) return;

    viewRef.current?.destroy();
    viewRef.current = null;

    if (isImageFile) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const content = update.state.doc.toString();
        setActiveFileContent(content);
        scheduleSave(activeFilePath, content);
      }
      if (update.selectionSet || update.docChanged) {
        useStore.getState().setCursorOffset(update.state.selection.main.head);

        const { from, to } = update.state.selection.main;
        if (from !== to) {
          const text = update.state.sliceDoc(from, to);
          const coords = update.view.coordsAtPos(from);
          useStore.getState().setSelection(
            text,
            coords ? { top: coords.top, left: coords.left } : null,
            to,
          );
        } else {
          useStore.getState().clearSelection();
        }
      }
    });

    const state = EditorState.create({
      doc: activeFileContent,
      extensions: [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorState.tabSize.of(4),
        indentUnit.of("    "),
        oneDark,
        metisTheme,
        highlightCompartment.of(highlightForPreset(bgPresetRef.current)),
        metisLineNumbers,
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        search({
          createPanel: () => {
            const dom = document.createElement("span");
            dom.style.display = "none";
            return { dom };
          },
        }),
        codeBlockPlugin,
        copyButtonPlugin,
        calloutPlugin,
        ...wikilinkExtensions,
        ...markdownLinkCollapseExtension,
        markdownCaretAtomicExtension,
        ...taskListClickExtension,
        listContinuationKeymap,
        markdownAutoComplete,
        smartPasteExtension,
        hideFrontmatterField,
        ...(activeFilePath && vaultPath
          ? makeInlinePreviewExtension(vaultPath, activeFilePath)
          : []),
        spellcheckCompartment.of(
          makeSpellcheckExt(spellcheckRef.current, spellcheckLangRef.current),
        ),
        bgCompartment.of(makeBgTheme(bgPresetRef.current)),
        editorKeymapExtension({
          activeFilePath,
          markSaved,
          setFindBarOpen,
          setFindBarReplace,
          findBarRef,
        }),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: editorHostRef.current });
    viewRef.current = view;
    view.focus();

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || isImageFile) return;
    const current = view.state.doc.toString();
    if (current === activeFileContent) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: activeFileContent },
    });
  }, [activeFileContent, isImageFile, viewRef]);
}

/** Hot-swap spellcheck, background, and keybindings without rebuilding the editor. */
export function useCodeMirrorCompartments(
  viewRef: MutableRefObject<EditorView | null>,
  bgPreset: BgPreset,
  spellcheckEnabled: boolean,
  spellcheckLang: string,
  keymapOptsRef: MutableRefObject<EditorKeymapOpts>,
  keybindingOverrides: Settings["keybindingOverrides"],
) {
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        bgCompartment.reconfigure(makeBgTheme(bgPreset)),
        highlightCompartment.reconfigure(highlightForPreset(bgPreset)),
      ],
    });
  }, [bgPreset, viewRef]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: spellcheckCompartment.reconfigure(
        makeSpellcheckExt(spellcheckEnabled, spellcheckLang),
      ),
    });
  }, [spellcheckEnabled, spellcheckLang, viewRef]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editorKeymapCompartment.reconfigure(
        keymap.of(buildEditorKeymaps(keymapOptsRef.current)),
      ),
    });
  }, [keybindingOverrides, keymapOptsRef, viewRef]);
}
