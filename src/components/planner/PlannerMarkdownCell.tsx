import { useEffect, useState, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { getPlannerFieldHeight } from "@/planner/plannerFieldHeights";
import PlannerCodeMirrorField from "../PlannerCodeMirrorField";
import PlannerMarkdownPreview from "./PlannerMarkdownPreview";
import PlannerResizableEditorShell from "./PlannerResizableEditorShell";

interface Props {
  value: string;
  onChange: (next: string) => void;
  minHeightPx?: number;
  fontSizePx?: number;
  fillHeight?: boolean;
  toolbarViewRef: MutableRefObject<EditorView | null>;
  /** Stable id for click-to-edit focus (weekly, goals, reviews, etc.). */
  fieldKey?: string;
  activeFieldKey?: string | null;
  onActivateField?: (key: string | null) => void;
  /** When set, overrides fieldKey activation (Daily Log cell expansion). */
  editing?: boolean;
  onRequestEdit?: () => void;
  onEditorFocus?: () => void;
  /**
   * Persisted resize id (defaults to `fieldKey`). When set, active editor shows a
   * vertical resize handle and remembers height in localStorage.
   */
  resizeStorageKey?: string;
  /** Initial height when opening editor if nothing stored yet (e.g. expanded daily cell). */
  defaultEditHeightPx?: number;
}

/**
 * Planner markdown field: rendered preview when idle, CodeMirror when editing.
 * Use `editing` for Daily Log grid expansion; otherwise `fieldKey` + `activeFieldKey`.
 */
export default function PlannerMarkdownCell({
  value,
  onChange,
  minHeightPx = 64,
  fontSizePx = 10,
  fillHeight = false,
  toolbarViewRef,
  fieldKey,
  activeFieldKey = null,
  onActivateField,
  editing,
  onRequestEdit,
  onEditorFocus,
  resizeStorageKey,
  defaultEditHeightPx,
}: Props) {
  const [internalEditing, setInternalEditing] = useState(false);

  const isControlled = editing !== undefined;
  const isKeyManaged = !isControlled && fieldKey !== undefined && onActivateField !== undefined;
  const isEditing = isControlled
    ? editing
    : isKeyManaged
      ? activeFieldKey === fieldKey
      : internalEditing;

  const storageKey = resizeStorageKey ?? fieldKey;
  const defaultStoredHeight = defaultEditHeightPx ?? minHeightPx;
  const [editHeightPx, setEditHeightPx] = useState(() =>
    storageKey ? getPlannerFieldHeight(storageKey, defaultStoredHeight) : defaultStoredHeight,
  );

  useEffect(() => {
    if (!isEditing || !storageKey) return;
    setEditHeightPx(getPlannerFieldHeight(storageKey, defaultStoredHeight));
  }, [isEditing, storageKey, defaultStoredHeight]);

  const requestEdit = () => {
    onRequestEdit?.();
    if (isControlled) return;
    if (isKeyManaged && fieldKey) {
      onActivateField!(fieldKey);
      return;
    }
    setInternalEditing(true);
  };

  const endEdit = () => {
    if (isControlled) return;
    if (isKeyManaged) {
      if (activeFieldKey === fieldKey) onActivateField!(null);
      return;
    }
    setInternalEditing(false);
  };

  const previewHeightPx = storageKey
    ? getPlannerFieldHeight(storageKey, defaultStoredHeight)
    : minHeightPx;

  const cmField = (
    <PlannerCodeMirrorField
      value={value}
      onChange={onChange}
      minHeightPx={minHeightPx}
      fontSizePx={fontSizePx}
      fillHeight={storageKey ? true : fillHeight}
      resizable={Boolean(storageKey)}
      toolbarViewRef={toolbarViewRef}
      onEditorFocus={() => {
        onEditorFocus?.();
        if (isKeyManaged && fieldKey) onActivateField!(fieldKey);
      }}
      onEditorBlur={endEdit}
    />
  );

  if (isEditing) {
    if (storageKey) {
      return (
        <PlannerResizableEditorShell
          fieldId={storageKey}
          minHeightPx={minHeightPx}
          heightPx={editHeightPx}
          onHeightPxChange={setEditHeightPx}
        >
          {cmField}
        </PlannerResizableEditorShell>
      );
    }

    return cmField;
  }

  return (
    <PlannerMarkdownPreview
      content={value}
      fontSizePx={fontSizePx}
      minHeightPx={previewHeightPx}
      fillHeight={fillHeight}
      onClick={requestEdit}
    />
  );
}
