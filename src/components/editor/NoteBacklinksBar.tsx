import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/store/useStore";
import { backlinkLabels } from "@/utils/linkGraph";
import { openNoteByWikilinkNameFromStore } from "@/utils/vaultNavigation";
import { useCorePluginEnabled } from "@/plugins/usePluginStore";

interface NoteBacklinksBarProps {
  filePath: string | null;
}

/** Compact backlinks row for Visual mode (metadata panel is Source-only). */
export function NoteBacklinksBar({ filePath }: NoteBacklinksBarProps) {
  const backlinksEnabled = useCorePluginEnabled("backlinks");
  const { backlinkIndex } = useStore(
    useShallow((s) => ({ backlinkIndex: s.backlinkIndex })),
  );

  const backlinkPaths = filePath ? backlinkIndex[filePath] ?? [] : [];
  const backlinkNames = useMemo(() => backlinkLabels(backlinkPaths), [backlinkPaths]);

  if (!backlinksEnabled || !filePath || backlinkNames.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border bg-surface-raised/60 px-3 py-1.5">
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted">
        Backlinks
      </p>
      <div className="flex flex-wrap gap-1">
        {backlinkNames.map((name, i) => (
          <button
            key={backlinkPaths[i]}
            type="button"
            onClick={() => openNoteByWikilinkNameFromStore(name)}
            title={`Open [[${name}]]`}
            className="rounded border border-border bg-surface-overlay px-2 py-0.5 text-[10px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            ↩ [[{name}]]
          </button>
        ))}
      </div>
    </div>
  );
}
