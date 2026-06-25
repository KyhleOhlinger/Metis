import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, FolderOpen, Library, X } from "lucide-react";
import { useStore } from "@/store/useStore";
import {
  exportNotesToPdf,
  type PdfExportProgress,
  type PdfExportScope,
} from "@/services/pdfExportService";
import { isPathWithinVault, normalizePosixPath } from "@/utils/paths";

interface Props {
  onClose: () => void;
}

export default function ExportPdfModal({ onClose }: Props) {
  const vaultPath = useStore((s) => s.vaultPath);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PdfExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runExport = useCallback(
    async (scope: PdfExportScope) => {
      if (!vaultPath || busy) return;
      setBusy(true);
      setError(null);
      setProgress(null);

      try {
        let folderPath: string | undefined;
        if (scope === "folder") {
          const picked = await invoke<string | null>("pick_folder");
          if (!picked) return;
          if (!isPathWithinVault(normalizePosixPath(picked), vaultPath)) {
            throw new Error("Choose a folder inside the open vault.");
          }
          folderPath = picked;
        }

        const saved = await exportNotesToPdf({
          scope,
          filePath: scope === "file" ? activeFilePath ?? undefined : undefined,
          folderPath,
          onProgress: setProgress,
        });

        if (saved) onClose();
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [activeFilePath, busy, onClose, vaultPath],
  );

  const fileDisabled = !activeFilePath?.toLowerCase().endsWith(".md");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface-raised shadow-2xl"
        role="dialog"
        aria-labelledby="export-pdf-title"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="export-pdf-title" className="text-sm font-semibold text-text-primary">
            Export PDF (Visual)
          </h2>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-overlay hover:text-text-primary disabled:opacity-40"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="px-4 pt-3 text-xs leading-relaxed text-text-secondary">
          Exports the rendered Visual preview — stickies, tables, syntax highlighting, and
          images included. Unsaved edits in the active note are included when exporting that
          note or the full vault.
        </p>

        <div className="flex flex-col gap-2 p-4">
          <ExportOption
            icon={<FileText className="h-4 w-4" />}
            title="File"
            description="Export the active markdown note"
            disabled={busy || fileDisabled}
            onClick={() => runExport("file")}
          />
          <ExportOption
            icon={<FolderOpen className="h-4 w-4" />}
            title="Folder"
            description="Pick a vault folder — all notes inside are combined into one PDF"
            disabled={busy}
            onClick={() => runExport("folder")}
          />
          <ExportOption
            icon={<Library className="h-4 w-4" />}
            title="Full Vault"
            description="Every markdown note in the vault, in one PDF"
            disabled={busy}
            onClick={() => runExport("vault")}
          />
        </div>

        {progress && (
          <div className="border-t border-border px-4 py-3 text-xs text-text-secondary">
            <p className="font-medium text-text-primary">{progress.label}</p>
            {progress.total > 1 && (
              <p className="mt-1">
                {progress.current} / {progress.total}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="border-t border-border px-4 py-3 text-xs text-red-400">{error}</div>
        )}
      </div>
    </div>
  );
}

function ExportOption({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition hover:border-accent/40 hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="mt-0.5 text-accent">{icon}</span>
      <span>
        <span className="block text-sm font-medium text-text-primary">{title}</span>
        <span className="mt-0.5 block text-xs text-text-secondary">{description}</span>
      </span>
    </button>
  );
}
