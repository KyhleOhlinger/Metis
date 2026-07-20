import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, type FileNode } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { toastError } from "@/store/useToastStore";
import { listVaultFolderOptions } from "@/utils/noteImages";
import metisIconUrl from "@/assets/metis_icon.png";
import { KV, Section } from "../shared/ui";
import { PlannerInfoSection } from "./PlannerInfoSection";

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
  const settings = usePersonaStore((s) => s.settings);
  const { defaultImageFolder, setDefaultImageFolder } = useStore(
    useShallow((s) => ({
      defaultImageFolder: s.defaultImageFolder,
      setDefaultImageFolder: s.setDefaultImageFolder,
    })),
  );

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
                    toastError(String(err));
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
        {vaultPath && (
          <Section title="Export">
            <KV
              label="Jekyll blog"
              value={settings.jekyllBlogRoot?.split("/").pop() ?? "Not set"}
              mono
            />
            <button
              type="button"
              onClick={() => usePersonaStore.getState().openSettings("export")}
              className="mt-2 text-[10px] text-accent hover:underline"
            >
              Configure export settings (⌘,)
            </button>
            <p className="mt-1 text-[9px] text-text-muted">
              Right-click a note or use Export… from the command palette ({">"} export).
            </p>
          </Section>
        )}
        <PlannerInfoSection />
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

      <div className="flex flex-1 min-h-[96px] items-center justify-center px-3 py-4">
        <img
          src={metisIconUrl}
          alt=""
          className="aspect-square w-4/5 max-w-[168px] rounded-2xl border border-border object-cover shadow-md shadow-black/20"
        />
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 flex justify-end">
        <p className="text-[10px] text-text-muted/50 select-none">
          © 2026 Kyhle Öhlinger — MIT License
        </p>
      </div>
    </div>
  );
}
