import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { EditorView } from "@codemirror/view";
import { useStore } from "@/store/useStore";
import { useAppTheme } from "@/hooks/useAppTheme";

/** Background preset, visual scroll anchor, and mode-transition effects for the editor pane. */
export function useEditorPaneMode(
  editorMode: string,
  viewRef: MutableRefObject<EditorView | null>,
) {
  const bgPreset = useAppTheme();
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [visualScrollAnchor, setVisualScrollAnchor] = useState<number | null>(null);
  const prevEditorModeRef = useRef(editorMode);
  const activeFilePath = useStore((s) => s.activeFilePath);

  useEffect(() => {
    setShowBgPicker(false);
  }, [editorMode, activeFilePath]);

  useEffect(() => {
    if (editorMode === "source") {
      const t = setTimeout(() => {
        viewRef.current?.requestMeasure();
        viewRef.current?.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [editorMode, viewRef]);

  useEffect(() => {
    const prev = prevEditorModeRef.current;
    prevEditorModeRef.current = editorMode;

    if (editorMode === "visual") {
      if (prev !== "visual") {
        setVisualScrollAnchor(useStore.getState().cursorOffset);
      }
      return;
    }

    setVisualScrollAnchor(null);

    if (prev === "visual" && editorMode === "source") {
      const id = requestAnimationFrame(() => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
        });
      });
      return () => cancelAnimationFrame(id);
    }
  }, [editorMode, viewRef]);

  return { bgPreset, showBgPicker, setShowBgPicker, visualScrollAnchor };
}
