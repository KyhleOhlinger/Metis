import { useState, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import PlannerCodeMirrorField from "../PlannerCodeMirrorField";
import PlannerMarkdownPreview from "./PlannerMarkdownPreview";

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
}: Props) {
  const [internalEditing, setInternalEditing] = useState(false);

  const isControlled = editing !== undefined;
  const isKeyManaged = !isControlled && fieldKey !== undefined && onActivateField !== undefined;
  const isEditing = isControlled
    ? editing
    : isKeyManaged
      ? activeFieldKey === fieldKey
      : internalEditing;

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

  if (isEditing) {
    return (
      <PlannerCodeMirrorField
        value={value}
        onChange={onChange}
        minHeightPx={minHeightPx}
        fontSizePx={fontSizePx}
        fillHeight={fillHeight}
        toolbarViewRef={toolbarViewRef}
        onEditorFocus={() => {
          onEditorFocus?.();
          if (isKeyManaged && fieldKey) onActivateField!(fieldKey);
        }}
        onEditorBlur={endEdit}
      />
    );
  }

  return (
    <PlannerMarkdownPreview
      content={value}
      fontSizePx={fontSizePx}
      minHeightPx={minHeightPx}
      fillHeight={fillHeight}
      onClick={requestEdit}
    />
  );
}
