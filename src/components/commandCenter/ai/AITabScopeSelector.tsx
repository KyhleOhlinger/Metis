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
  includeImages: boolean;
  setIncludeImages: (value: boolean) => void;
  showIncludeImages: boolean;
}

export function AITabScopeSelector({
  scope,
  setScope,
  scopeLabel,
  activeFilePath,
  folders,
  noteFiles,
  includeImages,
  setIncludeImages,
  showIncludeImages,
}: AITabScopeSelectorProps) {
  return (
    <div className="shrink-0 border-b border-border px-3 py-2.5">
      <div className="rounded-md border border-border bg-surface-overlay p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SubsectionLabel>Scope</SubsectionLabel>
          {showIncludeImages && scope.type !== "none" && scope.type !== "planner" && (
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[10px] text-text-muted"
              title="When checked, vault images referenced in scoped notes are sent so a vision model can see them"
            >
              <input
                type="checkbox"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
                className="rounded border-border"
              />
              <span>Include images</span>
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { type: "none", label: "No Selection" },
              { type: "current-file", label: "File" },
              { type: "specific-folder", label: "Folder" },
              { type: "full-vault", label: "Vault" },
              { type: "planner", label: "Planner" },
            ] as const
          ).map((seg) => (
            <SegmentButton
              key={seg.type}
              title={
                seg.type === "none"
                  ? "Prompt only — no vault notes attached"
                  : seg.type === "planner"
                    ? "Active planner — every tab unless excluded in Settings → Planner"
                    : undefined
              }
              active={
                scope.type === seg.type ||
                (seg.type === "current-file" && scope.type === "specific-file")
              }
              onClick={() => {
                if (seg.type === "none") {
                  setScope({ type: "none" });
                } else if (seg.type === "specific-folder" && folders.length > 0) {
                  setScope({ type: "specific-folder", folderPath: folders[0].path });
                } else if (seg.type === "current-file") {
                  setScope({ type: "current-file" });
                } else if (seg.type === "full-vault") {
                  setScope({ type: "full-vault" });
                } else if (seg.type === "planner") {
                  setScope({ type: "planner" });
                }
              }}
            >
              {seg.label}
            </SegmentButton>
          ))}
        </div>

        {scope.type === "planner" && (
          <>
            <Hint>
              All planner tabs (Daily Log through PTO & Events). Exclude sections in Settings → Planner.
            </Hint>
            {activeFilePath && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-[10px] text-text-muted"
                title="Append the open note after the planner"
              >
                <input
                  type="checkbox"
                  checked={Boolean(scope.includeCurrentFile)}
                  onChange={(e) =>
                    setScope({
                      type: "planner",
                      includeCurrentFile: e.target.checked,
                    })
                  }
                  className="rounded border-border"
                />
                <span>Also attach current note</span>
              </label>
            )}
            {showIncludeImages && scope.includeCurrentFile && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-[10px] text-text-muted"
                title="When checked, vault images referenced in the attached note are sent"
              >
                <input
                  type="checkbox"
                  checked={includeImages}
                  onChange={(e) => setIncludeImages(e.target.checked)}
                  className="rounded border-border"
                />
                <span>Include images</span>
              </label>
            )}
          </>
        )}

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
