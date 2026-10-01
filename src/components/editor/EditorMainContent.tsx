import type { MutableRefObject, RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import Toolbar from "@/components/Toolbar";
import MetadataPanel from "@/components/MetadataPanel";
import SelectionToolbar from "@/components/SelectionToolbar";
import EditorFindBar from "@/components/EditorFindBar";
import MarkdownPreview from "@/components/MarkdownPreview";
import VaultImageViewer from "@/components/VaultImageViewer";
import { SupernoteNoteViewer } from "@/components/SupernoteNoteViewer";
import DailyTaskGrid from "@/components/DailyTaskGrid";
import AgentRunHistoryPage from "@/components/agentHistory/AgentRunHistoryPage";
import { NoteBacklinksBar } from "@/components/editor/NoteBacklinksBar";
import { type BgPreset } from "@/components/editor/bgPresets";

interface EditorMainContentProps {
  editorMode: string;
  isImageFile: boolean;
  isNoteBinaryFile: boolean;
  activeFilePath: string | null;
  activeFileContent: string;
  vaultPath: string | null;
  bgPreset: BgPreset;
  visualScrollAnchor: number | null;
  editorHostRef: RefObject<HTMLDivElement | null>;
  viewRef: MutableRefObject<EditorView | null>;
  findBarOpen: boolean;
  findBarReplace: boolean;
  findBarRef: RefObject<HTMLDivElement | null>;
  spellcheckEnabled: boolean;
  onToggleSpellcheck: () => void;
  onFindBarClose: () => void;
  onPreviewSourceActivate: (sourceOffset: number, matchEnd?: number) => void;
  onPreviewTaskToggle: (markerOffset: number, checked: boolean) => void;
  onDismissSelectionToolbar: () => void;
  onMetadataChange: (newContent: string) => void;
  onWikilinkClick: (name: string) => void;
}

export function EditorMainContent({
  editorMode,
  isImageFile,
  isNoteBinaryFile,
  activeFilePath,
  activeFileContent,
  vaultPath,
  bgPreset,
  visualScrollAnchor,
  editorHostRef,
  viewRef,
  findBarOpen,
  findBarReplace,
  findBarRef,
  spellcheckEnabled,
  onToggleSpellcheck,
  onFindBarClose,
  onPreviewSourceActivate,
  onPreviewTaskToggle,
  onDismissSelectionToolbar,
  onMetadataChange,
  onWikilinkClick,
}: EditorMainContentProps) {
  return (
    <>
      {findBarOpen && editorMode === "source" && (
        <div ref={findBarRef as RefObject<HTMLDivElement>}>
          <EditorFindBar
            viewRef={viewRef}
            onClose={onFindBarClose}
            initialShowReplace={findBarReplace}
          />
        </div>
      )}

      {editorMode === "source" && !isImageFile && !isNoteBinaryFile && (
        <Toolbar
          viewRef={viewRef}
          spellcheck={spellcheckEnabled}
          onToggleSpellcheck={onToggleSpellcheck}
        />
      )}

      {editorMode === "source" && !isImageFile && !isNoteBinaryFile && (
        <MetadataPanel
          content={activeFileContent}
          filePath={activeFilePath}
          onContentChange={onMetadataChange}
          onLinkClick={onWikilinkClick}
        />
      )}

      {editorMode === "source" && !isImageFile && !isNoteBinaryFile && (
        <SelectionToolbar onDismiss={onDismissSelectionToolbar} />
      )}

      <div className="relative z-0 min-h-0 flex-1 overflow-hidden">
        <div
          ref={editorHostRef as RefObject<HTMLDivElement>}
          className="absolute inset-0"
          style={{
            display: editorMode === "source" && !isImageFile && !isNoteBinaryFile ? "block" : "none",
          }}
        />

        {isImageFile && activeFilePath && vaultPath && (
          <VaultImageViewer
            filePath={activeFilePath}
            vaultPath={vaultPath}
            bgColor={bgPreset.bg}
          />
        )}

        {isNoteBinaryFile && activeFilePath && vaultPath && (
          <SupernoteNoteViewer
            key={activeFilePath}
            filePath={activeFilePath}
            vaultPath={vaultPath}
            bgColor={bgPreset.bg}
          />
        )}

        {editorMode === "visual" && activeFilePath && vaultPath && !isImageFile && !isNoteBinaryFile && (
          <div className="flex h-full min-h-0 flex-col">
            <NoteBacklinksBar filePath={activeFilePath} />
            <div className="min-h-0 flex-1 overflow-hidden">
              <MarkdownPreview
                content={activeFileContent}
                filePath={activeFilePath}
                vaultPath={vaultPath}
                bgColor={bgPreset.bg}
                textColor={bgPreset.fg}
                scrollAnchorOffset={visualScrollAnchor}
                onSourceActivate={onPreviewSourceActivate}
                onTaskToggle={onPreviewTaskToggle}
              />
            </div>
          </div>
        )}

        {editorMode === "planner" && (
          <div className="h-full min-h-0">
            <DailyTaskGrid />
          </div>
        )}

        {editorMode === "agent-history" && (
          <div className="h-full min-h-0">
            <AgentRunHistoryPage />
          </div>
        )}
      </div>
    </>
  );
}
