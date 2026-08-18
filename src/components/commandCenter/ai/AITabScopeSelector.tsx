import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import type { ExecutionScope } from "@/types/persona";
import { ccSelectCls, Hint, SegmentButton, SubsectionLabel } from "../shared/ui";

interface AITabScopeSelectorProps {
  scope: ExecutionScope;
  setScope: (scope: ExecutionScope) => void;
  scopeLabel: string;
  activeFilePath: string | null;
  folders: { path: string; name: string }[];
  noteFiles: { path: string; label: string }[];
}

export function AITabScopeSelector({
  scope,
  setScope,
  scopeLabel,
  activeFilePath,
  folders,
  noteFiles,
}: AITabScopeSelectorProps) {
  return (
    <div className="shrink-0 border-b border-border px-3 py-2.5">
      <div className="rounded-md border border-border bg-surface-overlay p-2.5 space-y-2">
        <SubsectionLabel>Scope</SubsectionLabel>
        <div className="flex flex-wrap gap-1">
          {(["current-file", "specific-folder", "full-vault"] as const).map((t) => (
            <SegmentButton
              key={t}
              active={
                scope.type === t || (t === "current-file" && scope.type === "specific-file")
              }
              onClick={() => {
                if (t === "specific-folder" && folders.length > 0) {
                  setScope({ type: "specific-folder", folderPath: folders[0].path });
                } else if (t === "current-file") {
                  setScope({ type: "current-file" });
                } else if (t === "full-vault") {
                  setScope({ type: "full-vault" });
                }
              }}
            >
              {t === "current-file" ? "File" : t === "specific-folder" ? "Folder" : "Vault"}
            </SegmentButton>
          ))}
        </div>

        {(scope.type === "current-file" || scope.type === "specific-file") &&
          noteFiles.length > 0 && (
            <select
              value={scope.type === "specific-file" ? scope.filePath : (activeFilePath ?? "")}
              onChange={async (e) => {
                const selected = e.target.value;
                try {
                  const content = await invoke<string>("get_file_content", { path: selected });
                  useStore.getState().setActiveFile(selected, content);
                } catch {
                  // If the read fails, still update the scope so the AI can try.
                }
                if (selected === activeFilePath) {
                  setScope({ type: "current-file" });
                } else {
                  setScope({ type: "specific-file", filePath: selected });
                }
              }}
              className={ccSelectCls}
            >
              {noteFiles.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.label}
                </option>
              ))}
            </select>
          )}

        {scope.type === "specific-folder" && folders.length > 0 && (
          <select
            value={scope.folderPath}
            onChange={(e) => setScope({ type: "specific-folder", folderPath: e.target.value })}
            className={ccSelectCls}
          >
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name}
              </option>
            ))}
          </select>
        )}

        <Hint>
          Running on: <span className="text-text-secondary">{scopeLabel}</span>
        </Hint>
      </div>
    </div>
  );
}
