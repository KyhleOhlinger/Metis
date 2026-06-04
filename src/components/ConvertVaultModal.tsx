// Copyright (c) 2026 Kyhle Öhlinger. Licensed under the MIT License.
// See the LICENSE file in the repository root for the full license text.

/**
 * ConvertVaultModal
 *
 * Shown when the user opens a folder that is NOT a Metis vault (no
 * `.metis/vault.json` marker).  Lets the user either:
 *   • Open As-Is — use the folder without modification
 *   • Convert    — write the marker, create default folders, and
 *                  optionally back-fill minimal frontmatter
 *
 * During conversion a live progress bar is updated via the
 * `convert-vault-progress` Tauri event.
 */

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore, VaultData } from "../store/useStore";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConvertProgress {
  step: string;
  current: number;
  total: number;
}

interface Props {
  vaultPath: string;
  vaultHint?: string; // "obsidian" | "markdown"
  onDismiss: () => void; // user chose "Open As-Is"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hintLabel(hint?: string): string {
  if (hint === "obsidian") return "Obsidian vault";
  return "Markdown vault";
}

function hintDescription(hint?: string): string {
  if (hint === "obsidian") {
    return "An Obsidian configuration folder (.obsidian/) was detected. Metis can open this vault as-is, or convert it so you can take full advantage of Metis features.";
  }
  return "This folder contains Markdown files but no Metis vault marker. You can open it as-is or convert it to a Metis vault.";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ConvertVaultModal({ vaultPath, vaultHint, onDismiss }: Props) {
  const [addMetadata, setAddMetadata]   = useState(true);
  const [converting, setConverting]     = useState(false);
  const [progress, setProgress]         = useState<ConvertProgress | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | undefined>(undefined);

  // Attach progress listener when converting begins; tear it down when done.
  useEffect(() => {
    if (!converting) return;

    listen<ConvertProgress>("convert-vault-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      unlistenRef.current = fn;
    });

    return () => {
      unlistenRef.current?.();
    };
  }, [converting]);

  const vaultName = vaultPath.split("/").filter(Boolean).pop() ?? vaultPath;

  const handleConvert = async () => {
    setError(null);
    setConverting(true);
    try {
      const data = await invoke<VaultData>("convert_vault_to_metis", {
        vaultPath,
        addMetadata,
      });
      // Apply the converted vault — `setVault` updates `isMetisVault` to true,
      // which closes this modal from the parent component.
      useStore.getState().setVault(data);
    } catch (e) {
      setError(typeof e === "string" ? e : "Conversion failed. Please try again.");
      setConverting(false);
    }
  };

  const handleOpenAsIs = () => {
    onDismiss();
  };

  const pct = progress
    ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-xl border border-border bg-surface-base shadow-2xl overflow-hidden">

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-500/15">
              <span className="text-base">⚠️</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text-primary">
                Non-Metis Vault Detected
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                <span className="font-medium text-yellow-400">{hintLabel(vaultHint)}</span>
                {" · "}
                <span className="truncate">{vaultName}</span>
              </p>
            </div>
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-text-muted leading-relaxed">
            {hintDescription(vaultHint)}
          </p>

          {/* What conversion will do */}
          {!converting && (
            <div className="rounded-lg border border-border bg-surface-overlay p-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-faint">
                Conversion will
              </p>
              <ul className="space-y-1.5">
                {[
                  "Write a .metis/vault.json identification marker",
                  "Create default folders: daily/, meetings/, summaries/, handwritten/, assets/",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-text-muted">
                    <span className="mt-0.5 text-green-400 shrink-0">✓</span>
                    <span>{item}</span>
                  </li>
                ))}

                {/* Optional frontmatter step with checkbox */}
                <li className="flex items-start gap-2">
                  <button
                    onClick={() => setAddMetadata((v) => !v)}
                    className="mt-0.5 shrink-0 flex h-3.5 w-3.5 items-center justify-center rounded border border-border bg-surface-base hover:border-accent transition-colors"
                    aria-label="Toggle frontmatter option"
                  >
                    {addMetadata && (
                      <span className="text-[9px] leading-none text-accent font-bold">✓</span>
                    )}
                  </button>
                  <div>
                    <span className="text-xs text-text-muted">
                      Add{" "}
                      <code className="rounded bg-surface-overlay px-1 py-px text-[10px] font-mono text-text-secondary">
                        parent
                      </code>
                      {" "}and{" "}
                      <code className="rounded bg-surface-overlay px-1 py-px text-[10px] font-mono text-text-secondary">
                        date
                      </code>
                      {" "}metadata to notes
                    </span>
                    <p className="text-[10px] text-text-faint mt-0.5">
                      Only adds missing fields — never overwrites existing metadata
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          )}

          {/* Progress bar (shown while converting) */}
          {converting && (
            <div className="space-y-3">
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-text-muted truncate max-w-[80%]">
                  {progress?.step ?? "Starting…"}
                </p>
                <p className="text-[11px] tabular-nums text-text-faint shrink-0 ml-2">
                  {pct}%
                </p>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <p className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="px-6 pb-5 flex items-center justify-end gap-2">
          {!converting && (
            <button
              onClick={handleOpenAsIs}
              className="rounded-md px-3 py-1.5 text-xs text-text-muted border border-border hover:border-border-hover hover:text-text-primary transition-colors"
            >
              Open As-Is
            </button>
          )}
          <button
            onClick={handleConvert}
            disabled={converting}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {converting ? "Converting…" : "Convert to Metis Vault"}
          </button>
        </div>

      </div>
    </div>
  );
}
