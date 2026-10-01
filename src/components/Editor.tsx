import { useEffect, useRef, useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { useStore } from "../store/useStore";
import { usePersonaStore } from "../store/usePersonaStore";
import { isVaultImageFile } from "../utils/vaultImages";
import { isSupernoteNoteFile } from "@/constants/supernote";
import { openNoteByWikilinkNameFromStore } from "../utils/vaultNavigation";
import { EditorEmptyState } from "./editor/EditorEmptyState";
import { EditorHeaderBar } from "./editor/EditorHeaderBar";
import { EditorMainContent } from "./editor/EditorMainContent";
import { applyEditorNavigation } from "./editor/applyEditorNavigation";
import { useDebouncedSave } from "../hooks/useDebouncedSave";
import type { EditorKeymapOpts } from "@/components/editor/editorKeymaps";
import { useCodeMirrorEditor, useCodeMirrorCompartments } from "../hooks/useCodeMirrorEditor";
import { useCorePluginEnabled } from "@/plugins/usePluginStore";
import { useEditorPaneMode } from "../hooks/useEditorPaneMode";
import type { BgPreset } from "./editor/bgPresets";
import { resolveBgPreset } from "./editor/bgPresets";

export default function Editor() {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const spellcheckSetting = usePersonaStore((s) => s.settings.spellcheckEnabled === true);
  const spellcheckPlugin = useCorePluginEnabled("spellcheck");
  const spellcheckEnabled = spellcheckSetting && spellcheckPlugin;
  const spellcheckLang = usePersonaStore((s) => s.settings.spellcheckLanguage ?? "en_US");
  const keybindingOverrides = usePersonaStore((s) => s.settings.keybindingOverrides);
  const updateSettings = usePersonaStore((s) => s.updateSettings);

  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findBarReplace, setFindBarReplace] = useState(false);
  const findBarRef = useRef<HTMLDivElement>(null);
  const bgPresetRef = useRef<BgPreset>(resolveBgPreset("dark"));
  const spellcheckRef = useRef(spellcheckEnabled);
  const spellcheckLangRef = useRef(spellcheckLang);
  const keymapOptsRef = useRef<EditorKeymapOpts>({
    activeFilePath: null,
    markSaved: () => {},
    setFindBarOpen: () => {},
    setFindBarReplace: () => {},
    findBarRef,
  });

  const {
    activeFilePath,
    activeFileContent,
    setActiveFileContent,
    markSaved,
    setSaveStatus,
    vaultPath,
    editorTab: editorMode,
    setEditorTab: setEditorMode,
    editorNavigateTo,
  } = useStore(
    useShallow((s) => ({
      activeFilePath: s.activeFilePath,
      activeFileContent: s.activeFileContent,
      setActiveFileContent: s.setActiveFileContent,
      markSaved: s.markSaved,
      setSaveStatus: s.setSaveStatus,
      vaultPath: s.vaultPath,
      editorTab: s.editorTab,
      setEditorTab: s.setEditorTab,
      editorNavigateTo: s.editorNavigateTo,
    })),
  );

  const { bgPreset, setBgPreset, showBgPicker, setShowBgPicker, visualScrollAnchor } =
    useEditorPaneMode(editorMode, viewRef);

  useEffect(() => {
    bgPresetRef.current = bgPreset;
  }, [bgPreset]);

  useEffect(() => {
    spellcheckRef.current = spellcheckEnabled;
    spellcheckLangRef.current = spellcheckLang;
  }, [spellcheckEnabled, spellcheckLang]);

  useEffect(() => {
    keymapOptsRef.current = {
      activeFilePath,
      markSaved,
      setFindBarOpen,
      setFindBarReplace,
      findBarRef,
    };
  }, [activeFilePath, markSaved, setFindBarOpen, setFindBarReplace, findBarRef]);

  const scheduleSave = useDebouncedSave(markSaved, setSaveStatus);

  const dismissSelectionToolbar = useCallback(() => {
    useStore.getState().clearSelection();
    const view = viewRef.current;
    if (view && !view.state.selection.main.empty) {
      const head = view.state.selection.main.head;
      view.dispatch({ selection: EditorSelection.cursor(head) });
    }
  }, []);

  useEffect(() => {
    dismissSelectionToolbar();
  }, [activeFilePath, editorMode, dismissSelectionToolbar]);

  const activeFileName = activeFilePath?.split("/").pop() ?? "";
  const isImageFile = Boolean(activeFilePath && isVaultImageFile(activeFileName));
  const isNoteBinaryFile = Boolean(activeFilePath && isSupernoteNoteFile(activeFileName));
  const skipMarkdownEditor = isImageFile || isNoteBinaryFile;

  useCodeMirrorEditor({
    editorHostRef,
    viewRef,
    activeFilePath,
    activeFileContent,
    isImageFile: skipMarkdownEditor,
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
  });

  useCodeMirrorCompartments(
    viewRef,
    bgPreset,
    spellcheckEnabled,
    spellcheckLang,
    keymapOptsRef,
    keybindingOverrides,
  );

  const handlePreviewSourceActivate = useCallback(
    (sourceOffset: number, matchEnd?: number) => {
      setEditorMode("source");
      let attempts = 0;
      const tryNavigate = () => {
        const view = viewRef.current;
        if (view) {
          applyEditorNavigation(view, sourceOffset, matchEnd);
          return;
        }
        if (attempts++ < 24) requestAnimationFrame(tryNavigate);
      };
      requestAnimationFrame(tryNavigate);
    },
    [setEditorMode],
  );

  const handlePreviewTaskToggle = useCallback((markerOffset: number, checked: boolean) => {
    const view = viewRef.current;
    if (!view) return;
    const insert = checked ? "x" : " ";
    view.dispatch({
      changes: { from: markerOffset + 1, to: markerOffset + 2, insert },
    });
  }, []);

  useEffect(() => {
    if (!editorNavigateTo || editorNavigateTo.path !== activeFilePath || skipMarkdownEditor) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const tryApply = () => {
      if (cancelled) return;
      const view = viewRef.current;
      if (!view) {
        if (attempts++ < 24) requestAnimationFrame(tryApply);
        return;
      }
      applyEditorNavigation(view, editorNavigateTo.offset, editorNavigateTo.matchEnd);
      useStore.getState().clearEditorNavigateTo();
    };

    tryApply();
    return () => {
      cancelled = true;
    };
  }, [editorNavigateTo, activeFilePath, skipMarkdownEditor]);

  useEffect(() => {
    if (editorMode !== "source") setFindBarOpen(false);
  }, [editorMode]);

  const handleMetadataChange = useCallback((newContent: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newContent },
    });
  }, []);

  const showEmpty =
    !activeFilePath && editorMode !== "planner" && editorMode !== "agent-history";

  const fileName = activeFilePath
    ? activeFilePath.split("/").pop() ?? activeFilePath
    : editorMode === "planner"
      ? "Planner"
      : editorMode === "agent-history"
        ? "Agent Run Log"
        : "Metis";

  return (
    <div className="flex h-full min-w-0 flex-col">
      <EditorHeaderBar
        fileName={showEmpty ? "No note open" : fileName}
        isImageFile={skipMarkdownEditor}
        editorMode={editorMode}
        bgPreset={bgPreset}
        showBgPicker={showBgPicker}
        onShowBgPickerChange={setShowBgPicker}
        onBgPresetChange={setBgPreset}
        hideModeToggle={
          showEmpty ||
          skipMarkdownEditor ||
          editorMode === "planner" ||
          editorMode === "agent-history"
        }
      />

      {showEmpty ? (
        <EditorEmptyState
          vaultPath={vaultPath}
          onOpenPlanner={() => setEditorMode("planner")}
          onCreateVault={() => useStore.getState().setPendingMenuAction("new-vault")}
          onOpenVault={() => useStore.getState().setPendingMenuAction("open-vault-picker")}
        />
      ) : (
        <EditorMainContent
          editorMode={editorMode}
          isImageFile={isImageFile}
          isNoteBinaryFile={isNoteBinaryFile}
          activeFilePath={activeFilePath}
          activeFileContent={activeFileContent}
          vaultPath={vaultPath}
          bgPreset={bgPreset}
          visualScrollAnchor={visualScrollAnchor}
          editorHostRef={editorHostRef}
          viewRef={viewRef}
          findBarOpen={findBarOpen}
          findBarReplace={findBarReplace}
          findBarRef={findBarRef}
          spellcheckEnabled={spellcheckEnabled}
          onToggleSpellcheck={() => updateSettings({ spellcheckEnabled: !spellcheckEnabled })}
          onFindBarClose={() => setFindBarOpen(false)}
          onPreviewSourceActivate={handlePreviewSourceActivate}
          onPreviewTaskToggle={handlePreviewTaskToggle}
          onDismissSelectionToolbar={dismissSelectionToolbar}
          onMetadataChange={handleMetadataChange}
          onWikilinkClick={openNoteByWikilinkNameFromStore}
        />
      )}
    </div>
  );
}
