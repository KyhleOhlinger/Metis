import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import { useStore, type FileNode } from "@/store/useStore";
import { listVaultFolderOptions } from "@/utils/noteImages";
import metisIconUrl from "@/assets/metis_icon.png";
import { KV, Section } from "../shared/ui";

export function InfoTab({
  vaultPath,
  files,
  activeFilePath,
  isDirty,
  wordCount,
  lineCount,
  charCount,
}: {
  vaultPath: string | null;
  files: FileNode[];
  activeFilePath: string | null;
  isDirty: boolean;
  wordCount: number;
  lineCount: number;
  charCount: number;
}) {
  const { defaultImageFolder, setDefaultImageFolder } = useStore(
    useShallow((s) => ({
      defaultImageFolder: s.defaultImageFolder,
      setDefaultImageFolder: s.setDefaultImageFolder,
    })),
  );
  const [plannerStorageDir, setPlannerStorageDir] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("get_planner_storage_dir")
      .then(setPlannerStorageDir)
      .catch(() => setPlannerStorageDir(null));
  }, []);

  const imageFolderOptions = useMemo(() => {
    if (!vaultPath) return [];
    const base = listVaultFolderOptions(files, vaultPath);
    if (defaultImageFolder && !base.some((o) => o.relativePath === defaultImageFolder)) {
      return [{ relativePath: defaultImageFolder, label: defaultImageFolder }, ...base];
    }
    return base;
  }, [files, vaultPath, defaultImageFolder]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Scrollable metadata — content-sized; remaining height centers the icon below */}
      <div className="min-h-0 shrink overflow-y-auto p-3 space-y-3" data-cc-scroll-region>
        <Section title="Vault">
          <KV label="Path" value={vaultPath ?? "—"} mono />
          {vaultPath && (
            <div className="mt-2">
              <label className="block text-[10px] text-text-muted">Default image folder</label>
              <select
                value={defaultImageFolder}
                onChange={async (e) => {
                  try {
                    await setDefaultImageFolder(e.target.value);
                  } catch (err) {
                    alert(String(err));
                  }
                }}
                className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-primary"
              >
                {imageFolderOptions.map((opt) => (
                  <option key={opt.relativePath} value={opt.relativePath}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[9px] text-text-muted">
                Pasted images save here. Default is <code className="text-[9px]">assets</code> until
                you choose a folder (sidebar right-click or this dropdown).
              </p>
            </div>
          )}
        </Section>
        <Section title="Planner">
          <KV label="Path" value={plannerStorageDir ?? "—"} mono />
        </Section>
        <Section title="Active Note">
          <KV label="File" value={activeFilePath ? (activeFilePath.split("/").pop() ?? "—") : "—"} mono />
          <KV
            label="Status"
            value={!activeFilePath ? "No file open" : isDirty ? "Unsaved changes" : "Saved"}
            highlight={isDirty}
          />
        </Section>
        {activeFilePath && (
          <Section title="Stats">
            <KV label="Words" value={String(wordCount)} />
            <KV label="Lines" value={String(lineCount)} />
            <KV label="Chars" value={String(charCount)} />
          </Section>
        )}

        <div className="border-t border-border pt-3 mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2">
            About
          </p>
          <div>
            <p className="text-[11px] font-semibold text-text-primary">Metis</p>
            <p className="text-[10px] text-text-muted mt-0.5">
              A local-first, AI-augmented personal knowledge ecosystem.
            </p>
          </div>
        </div>
      </div>

      {/* Icon floats centered in the remaining panel space */}
      <div className="flex flex-1 min-h-[96px] items-center justify-center px-3 py-4">
        <img
          src={metisIconUrl}
          alt=""
          className="aspect-square w-4/5 max-w-[168px] rounded-2xl border border-border object-cover shadow-md shadow-black/20"
        />
      </div>

      {/* Copyright — pinned to bottom-right, outside the scroll area */}
      <div className="shrink-0 border-t border-border px-3 py-2 flex justify-end">
        <p className="text-[10px] text-text-muted/50 select-none">
          © 2026 Kyhle Öhlinger — MIT License
        </p>
      </div>
    </div>
  );
}
