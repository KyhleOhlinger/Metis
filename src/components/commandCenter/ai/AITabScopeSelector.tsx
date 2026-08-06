import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import type { ExecutionScope } from "@/types/persona";

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
    <div className="shrink-0 border-b border-border px-3 py-2">
      <p className="mb-1 text-[10px] uppercase tracking-widest text-text-muted font-semibold">
        Scope
      </p>
      <div className="flex gap-1 flex-wrap">
        {(["current-file", "specific-folder", "full-vault"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              if (t === "specific-folder" && folders.length > 0) {
                setScope({ type: "specific-folder", folderPath: folders[0].path });
              } else if (t === "current-file") {
                setScope({ type: "current-file" });
              } else if (t === "full-vault") {
                setScope({ type: "full-vault" });
              }
            }}
            className={[
              "rounded px-2 py-0.5 text-[10px] transition-colors",
              scope.type === t || (t === "current-file" && scope.type === "specific-file")
                ? "bg-accent/20 text-accent"
                : "bg-surface-overlay text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {t === "current-file" ? "File" : t === "specific-folder" ? "Folder" : "Vault"}
          </button>
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
            className="mt-1.5 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary focus:border-accent focus:outline-none"
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
          className="mt-1.5 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary focus:border-accent focus:outline-none"
        >
          {folders.map((f) => (
            <option key={f.path} value={f.path}>
              {f.name}
            </option>
          ))}
        </select>
      )}

      <p className="mt-1 text-[10px] text-text-muted">
        Running on: <span className="text-text-secondary font-medium">{scopeLabel}</span>
      </p>
    </div>
  );
}
