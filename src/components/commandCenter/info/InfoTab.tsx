import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, type FileNode } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";
import { listVaultFolderOptions } from "@/utils/noteImages";
import metisIconUrl from "@/assets/metis_icon.png";
import { FieldLabel, Hint, KV, Section, StatGrid, ccSelectCls } from "../shared/ui";
import { InfoExportSection } from "./InfoExportSection";
import { PlannerInfoSection } from "./PlannerInfoSection";

function vaultDisplayName(vaultPath: string): string {
  const parts = vaultPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? vaultPath;
}

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

  const imageFolderOptions = useMemo(() => {
    if (!vaultPath) return [];
    const base = listVaultFolderOptions(files, vaultPath);
    if (defaultImageFolder && !base.some((o) => o.relativePath === defaultImageFolder)) {
      return [{ relativePath: defaultImageFolder, label: defaultImageFolder }, ...base];
    }
    return base;
  }, [files, vaultPath, defaultImageFolder]);

  const activeFileName = activeFilePath ? (activeFilePath.split("/").pop() ?? "—") : "—";
  const activeStatus = !activeFilePath
    ? "No file open"
    : isDirty
      ? "Unsaved changes"
      : "Saved";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 shrink space-y-4 overflow-y-auto p-3" data-cc-scroll-region>
        {vaultPath && (
          <Section title="Active Note">
            <KV label="File" value={activeFileName} mono stacked={activeFileName.length > 28} />
            <KV label="Status" value={activeStatus} highlight={isDirty} />
            {activeFilePath && (
              <StatGrid
                items={[
                  { label: "Words", value: wordCount.toLocaleString() },
                  { label: "Lines", value: lineCount.toLocaleString() },
                  { label: "Chars", value: charCount.toLocaleString() },
                ]}
              />
            )}
          </Section>
        )}

        <Section title="Vault">
          {vaultPath ? (
            <>
              <KV label="Name" value={vaultDisplayName(vaultPath)} />
              <KV label="Path" value={vaultPath} mono stacked />
              <div>
                <FieldLabel>Default image folder</FieldLabel>
                <select
                  value={defaultImageFolder}
                  onChange={async (e) => {
                    try {
                      await setDefaultImageFolder(e.target.value);
                    } catch (err) {
                      toastError(String(err));
                    }
                  }}
                  className={ccSelectCls}
                >
                  {imageFolderOptions.map((opt) => (
                    <option key={opt.relativePath} value={opt.relativePath}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1.5">
                  <Hint>
                    Pasted images save here. Default is <code className="text-[9px]">assets</code>{" "}
                    until you pick a folder in the sidebar or below.
                  </Hint>
                </div>
              </div>
            </>
          ) : (
            <Hint>Open a vault to see path and image folder settings.</Hint>
          )}
        </Section>

        {vaultPath && <InfoExportSection />}

        <PlannerInfoSection />

        <Section title="About">
          <div className="flex flex-col items-center gap-2.5 py-1 text-center">
            <img
              src={metisIconUrl}
              alt=""
              className="aspect-square w-16 rounded-xl border border-border object-cover shadow-sm shadow-black/15"
            />
            <div>
              <p className="text-[11px] font-semibold text-text-primary">Metis</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">
                A local-first, AI-augmented personal knowledge ecosystem.
              </p>
            </div>
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 justify-end border-t border-border px-3 py-2">
        <p className="select-none text-[9px] text-text-muted/50">© 2026 Kyhle Öhlinger — MIT</p>
      </div>
    </div>
  );
}
