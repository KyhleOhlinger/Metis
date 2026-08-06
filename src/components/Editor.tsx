import { useEffect, useRef, useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { useStore } from "../store/useStore";
import { usePersonaStore } from "../store/usePersonaStore";
import { isVaultImageFile } from "../utils/vaultImages";
import { openNoteByWikilinkNameFromStore } from "../utils/vaultNavigation";
import { EditorEmptyState } from "./editor/EditorEmptyState";
import { EditorHeaderBar } from "./editor/EditorHeaderBar";
import { EditorMainContent } from "./editor/EditorMainContent";
import { applyEditorNavigation } from "./editor/applyEditorNavigation";
import { useDebouncedSave } from "../hooks/useDebouncedSave";
import { useCodeMirrorEditor, useCodeMirrorCompartments } from "../hooks/useCodeMirrorEditor";
import { useEditorPaneMode } from "../hooks/useEditorPaneMode";
import type { BgPreset } from "./editor/bgPresets";
import { resolveBgPreset } from "./editor/bgPresets";

export default function Editor() {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const spellcheckEnabled = usePersonaStore((s) => s.settings.spellcheckEnabled === true);
  const spellcheckLang = usePersonaStore((s) => s.settings.spellcheckLanguage ?? "en_US");
  const updateSettings = usePersonaStore((s) => s.updateSettings);

  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findBarReplace, setFindBarReplace] = useState(false);
  const findBarRef = useRef<HTMLDivElement>(null);
  const bgPresetRef = useRef<BgPreset>(resolveBgPreset("dark"));
  const spellcheckRef = useRef(spellcheckEnabled);
  const spellcheckLangRef = useRef(spellcheckLang);

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

  useCodeMirrorEditor({
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
  });

  useCodeMirrorCompartments(viewRef, bgPreset, spellcheckEnabled, spellcheckLang);

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
    if (!editorNavigateTo || editorNavigateTo.path !== activeFilePath || isImageFile) {
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
  }, [editorNavigateTo, activeFilePath, isImageFile]);

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

  if (!activeFilePath && editorMode !== "planner" && editorMode !== "agent-history") {
    return (
      <EditorEmptyState
        vaultPath={vaultPath}
        onOpenPlanner={() => setEditorMode("planner")}
        onOpenAgentHistory={() => setEditorMode("agent-history")}
        onCreateVault={() => useStore.getState().setPendingMenuAction("new-vault")}
        onOpenVault={() => useStore.getState().setPendingMenuAction("open-vault-picker")}
      />
    );
  }

  const fileName = activeFilePath
    ? activeFilePath.split("/").pop() ?? activeFilePath
    : editorMode === "planner"
      ? "Planner"
      : editorMode === "agent-history"
        ? "Agent Run Log"
        : "Metis";

  return (
    <div
      className="flex h-full min-w-0 flex-col bg-surface-base"
      data-color-scheme={bgPreset.isDark ? "dark" : "light"}
    >
      <EditorHeaderBar
        fileName={fileName}
        isImageFile={isImageFile}
        editorMode={editorMode}
        bgPreset={bgPreset}
        showBgPicker={showBgPicker}
        onShowBgPickerChange={setShowBgPicker}
        onBgPresetChange={setBgPreset}
      />

      <EditorMainContent
        editorMode={editorMode}
        isImageFile={isImageFile}
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
    </div>
  );
}
