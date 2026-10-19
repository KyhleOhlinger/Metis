import { useMemo } from "react";
import { usePersonaStore } from "@/store/usePersonaStore";
import { resolveBgPreset, type BgPreset } from "@/components/editor/bgPresets";
import { DEFAULT_APP_THEME_ID } from "@/utils/themeColors";

/** The App theme saved in settings. Sidebar, editor, and Command Center all read this. */
export function useAppTheme(): BgPreset {
  const editorBgPresetId = usePersonaStore(
    (s) => s.settings.editorBgPresetId ?? DEFAULT_APP_THEME_ID,
  );
  const editorBgCustomColor = usePersonaStore((s) => s.settings.editorBgCustomColor);
  return useMemo(
    () => resolveBgPreset(editorBgPresetId, editorBgCustomColor),
    [editorBgPresetId, editorBgCustomColor],
  );
}
