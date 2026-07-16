import { useStore } from "@/store/useStore";

export function EditorSaveIndicator() {
  const isDirty = useStore((s) => s.isDirty);
  const saveStatus = useStore((s) => s.saveStatus);
  const saveError = useStore((s) => s.saveError);
  const activeFilePath = useStore((s) => s.activeFilePath);

  if (!activeFilePath) return null;

  let label = "Saved";
  let className = "text-text-muted";

  if (saveStatus === "saving") {
    label = "Saving…";
    className = "text-amber-400/90";
  } else if (saveStatus === "error") {
    label = saveError ? `Save failed` : "Save failed";
    className = "text-red-400";
  } else if (isDirty) {
    label = "Unsaved";
    className = "text-amber-400/90";
  }

  return (
    <span
      className={`shrink-0 text-[10px] font-medium ${className}`}
      title={saveError ?? undefined}
    >
      {label}
    </span>
  );
}
