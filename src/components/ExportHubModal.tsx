import { useCallback, useEffect, useState } from "react";
import { FileOutput, FileText, FolderOpen, Library, X } from "lucide-react";
import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { toastInfo, toastSuccess } from "@/store/useToastStore";
import {
  exportNotesToPdf,
  type PdfExportProgress,
  type PdfExportScope,
} from "@/services/pdfExportService";
import { isPathWithinVault, normalizePosixPath } from "@/utils/paths";
import {
  jekyllExportDestinationLabel,
} from "@/utils/exportDestinations";
import { SAVE_DIALOG_EXPORT_LABEL } from "@/utils/saveDialogExport";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onClose: () => void;
  onJekyllExport: (notePath: string) => void;
}

export default function ExportHubModal({ onClose, onJekyllExport }: Props) {
  const vaultPath = useStore((s) => s.vaultPath);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const jekyllDestination = usePersonaStore((s) =>
    jekyllExportDestinationLabel(s.settings.jekyllBlogRoot),
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PdfExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPdfExport = useCallback(
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
        const result = await exportNotesToPdf({
          scope,
          filePath: scope === "file" ? activeFilePath ?? undefined : undefined,
          folderPath,
          onProgress: setProgress,
        });
        if (result) {
          toastSuccess(`PDF saved to ${result.savePath.split("/").pop()}`);
          if (result.failedImages > 0) {
            toastInfo(
              `${result.failedImages} image${result.failedImages === 1 ? "" : "s"} could not be embedded in the PDF.`,
            );
          }
          onClose();
        }
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
  const jekyllDisabled = fileDisabled;
  const fileDisabledReason = fileDisabled ? "Open a markdown note first" : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-raised shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Export</h2>
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
          Export notes for publishing or sharing. PDF uses the Visual preview and{" "}
          {SAVE_DIALOG_EXPORT_LABEL.toLowerCase()}. Jekyll writes Chirpy posts to{" "}
          <span className="font-mono text-[10px]">{jekyllDestination}</span>.
        </p>

        <div className="space-y-4 p-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              PDF (Visual)
            </p>
            <div className="flex flex-col gap-2">
              <ExportOption
                icon={<FileText className="h-4 w-4" />}
                title="File"
                description="Export the active markdown note"
                disabled={busy || fileDisabled}
                disabledReason={fileDisabledReason}
                onClick={() => runPdfExport("file")}
              />
              <ExportOption
                icon={<FolderOpen className="h-4 w-4" />}
                title="Folder"
                description="Pick a vault folder — combined into one PDF"
                disabled={busy}
                onClick={() => runPdfExport("folder")}
              />
              <ExportOption
                icon={<Library className="h-4 w-4" />}
                title="Full Vault"
                description="Every markdown note in the vault"
                disabled={busy}
                onClick={() => runPdfExport("vault")}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Jekyll (Chirpy)
            </p>
            <ExportOption
              icon={<FileOutput className="h-4 w-4" />}
              title="Convert to Jekyll"
              description="Active note → _posts/ + copied images"
              disabled={busy || jekyllDisabled}
              disabledReason={fileDisabledReason}
              onClick={() => {
                if (activeFilePath) {
                  onJekyllExport(activeFilePath);
                  onClose();
                }
              }}
            />
          </div>
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
  disabledReason,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : undefined}
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
