import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, VaultData } from "../store/useStore";

interface CreateVaultModalProps {
  onClose: () => void;
}

export default function CreateVaultModal({ onClose }: CreateVaultModalProps) {
  const [name, setName] = useState("My Vault");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const setVault = useStore((s) => s.setVault);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handlePickLocation = async () => {
    // Use the Rust-side picker so the dialog sheet is attached to THIS window.
    const selected = await invoke<string | null>("pick_folder");
    if (selected) setParentPath(selected);
  };

  const handleCreate = async () => {
    if (!parentPath) {
      setError("Please choose a location first.");
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Vault name cannot be empty.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await invoke<VaultData>("create_vault", {
        parentPath,
        name: trimmed,
      });
      setVault(data);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") onClose();
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="z-50 w-[420px] rounded-xl border border-border bg-surface-raised p-5 shadow-2xl shadow-black/60">
        {/* Title */}
        <h2 className="mb-4 text-sm font-semibold text-text-primary">
          Create New Vault
        </h2>

        {/* Name field */}
        <label className="mb-1 block text-[11px] text-text-muted">Vault name</label>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="My Vault"
          className="mb-3 w-full rounded-md border border-border bg-surface-overlay px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />

        {/* Location picker */}
        <label className="mb-1 block text-[11px] text-text-muted">Location</label>
        <button
          onClick={handlePickLocation}
          className="mb-4 flex w-full items-center gap-2 rounded-md border border-border bg-surface-overlay px-3 py-2 text-left text-sm transition-colors hover:border-accent/50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-muted">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className={parentPath ? "truncate text-text-primary" : "text-text-muted"}>
            {parentPath ?? "Choose location…"}
          </span>
        </button>

        {/* Preview path */}
        {parentPath && name.trim() && (
          <p className="mb-3 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-[10px] text-text-muted">
            {parentPath}/{name.trim()}
          </p>
        )}

        {/* Error */}
        {error && (
          <p className="mb-3 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !parentPath || !name.trim()}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create Vault"}
          </button>
        </div>
      </div>
    </div>
  );
}
