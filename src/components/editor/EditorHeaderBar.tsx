import { usePersonaStore } from "@/store/usePersonaStore";
import { useStore } from "@/store/useStore";
import EditorBgPicker from "@/components/editor/EditorBgPicker";
import { EditorSaveIndicator } from "@/components/EditorWorkspaceHeader";
import { CUSTOM_PRESET_ID, type BgPreset } from "@/components/editor/bgPresets";

interface EditorHeaderBarProps {
  fileName: string;
  isImageFile: boolean;
  editorMode: string;
  bgPreset: BgPreset;
  showBgPicker: boolean;
  onShowBgPickerChange: (open: boolean) => void;
  onBgPresetChange: (preset: BgPreset) => void;
  hideModeToggle?: boolean;
}

export function EditorHeaderBar({
  fileName,
  isImageFile,
  editorMode,
  bgPreset,
  showBgPicker,
  onShowBgPickerChange,
  onBgPresetChange,
  hideModeToggle = false,
}: EditorHeaderBarProps) {
  const updateSettings = usePersonaStore((s) => s.updateSettings);
  const setEditorMode = useStore((s) => s.setEditorTab);

  const showModeToggle =
    !hideModeToggle &&
    !isImageFile &&
    editorMode !== "planner" &&
    editorMode !== "agent-history";

  const persistPreset = (p: BgPreset) => {
    onBgPresetChange(p);
    if (p.id === CUSTOM_PRESET_ID) {
      updateSettings({ editorBgPresetId: CUSTOM_PRESET_ID, editorBgCustomColor: p.bg });
    } else {
      updateSettings({ editorBgPresetId: p.id });
    }
  };

  return (
    <div className="relative z-30 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-raised/70 px-4 py-1.5 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs text-text-secondary">{fileName}</span>
        <EditorSaveIndicator />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="relative">
          <EditorBgPicker
            bgPreset={bgPreset}
            open={showBgPicker}
            onOpenChange={onShowBgPickerChange}
            onSelectPreset={persistPreset}
          />
        </div>

        {showModeToggle && (
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
            {(["source", "visual"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setEditorMode(mode)}
                className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                  editorMode === mode
                    ? "bg-accent text-on-accent"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
