import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";

/**
 * Per-vault folders that file summaries, note reads, and persona scans skip.
 * Stored in app data, keyed by the open vault, so the vault itself cannot turn it off.
 */
export function NeverSendFolders() {
  const vaultPath = useStore((s) => s.vaultPath);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!vaultPath) {
      setText("");
      return;
    }
    try {
      const folders = await invoke<string[]>("get_never_send_folders");
      setText(folders.join("\n"));
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }, [vaultPath]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!vaultPath) return;
    const folders = text
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      const saved = await invoke<string[]>("set_never_send_folders", { folders });
      setText(saved.join("\n"));
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-secondary">
        Notes inside these vault folders are left out of AI scans and file reads.
        One folder per line, relative to this vault.
      </p>
      <textarea
        value={text}
        disabled={!vaultPath}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        rows={4}
        placeholder={vaultPath ? "private\njournal/archive" : "Open a vault first"}
        className="w-full rounded border border-border bg-surface-base px-2 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
