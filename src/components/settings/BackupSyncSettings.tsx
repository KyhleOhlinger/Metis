import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PINNED_SPACE_NAMES } from "@/constants/vaultSpaces";
import {
  loadBackupSyncState,
  notifyBackupSyncChanged,
  runBackupSync,
  type BackupSyncState,
} from "@/services/backupSync";
import { useCorePluginEnabled } from "@/plugins/usePluginStore";

const SPACE_LABELS: Record<(typeof PINNED_SPACE_NAMES)[number], string> = {
  daily: "daily/",
  meetings: "meetings/",
  summaries: "summaries/",
  handwritten: "handwritten/ (includes Supernote .note files)",
  assets: "assets/",
};

export function BackupSyncSettings() {
  const plannerOn = useCorePluginEnabled("planner");
  const [state, setState] = useState<BackupSyncState | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await loadBackupSyncState();
      setState(next);
      setRemoteUrl(next.remoteUrl);
      setError("");
    } catch (err) {
      setState(null);
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: BackupSyncState, url = remoteUrl) {
    setBusy(true);
    setError("");
    try {
      const saved = await invoke<BackupSyncState>("backup_sync_set_options", {
        options: {
          enabled: next.enabled,
          github: next.github,
          remoteUrl: url.trim(),
          spaces: next.spaces,
          files: next.files,
          vaultPlanner: next.vaultPlanner,
          scheduleMinutes: next.github ? next.scheduleMinutes : 0,
        },
      });
      setState(saved);
      setRemoteUrl(saved.remoteUrl);
      notifyBackupSyncChanged();
    } catch (err) {
      await load();
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setError("");
    try {
      await runBackupSync({ confirm: true });
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <p className="text-xs leading-relaxed text-text-secondary">
        {error || "Open a vault to configure backup sync."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-text-secondary">
        Turn backup on, then choose GitHub. That makes this vault a Git repository and sync
        commits the selected sections and pushes them. Sync now from here, the command center
        Info tab, the File menu, or ⌘⇧B. A schedule can push on its own. Nothing in the vault is
        deleted. If the remote has commits this vault does not, sync stops without pulling or pushing.
      </p>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) => {
            const enabled = e.target.checked;
            const next = { ...state, enabled, github: enabled ? state.github : false };
            setState(next);
            void save(next);
          }}
        />
        <span className="text-text-primary">Enable backup</span>
      </label>

      {state.enabled && (
        <>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-muted">
        Backup option
        <select
          value={state.github ? "github" : ""}
          disabled={busy}
          onChange={(e) => {
            const next = { ...state, github: e.target.value === "github" };
            setState(next);
            void save(next);
          }}
          className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary"
        >
          <option value="">Choose…</option>
          <option value="github">GitHub</option>
        </select>
      </label>
      <p className="text-[11px] text-text-muted">
        {state.github
          ? "This vault becomes a Git repository, with a .git directory, when you choose GitHub."
          : "No Git repository is created until you choose GitHub."}
      </p>

      {state.github && (
        <>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-muted">
        GitHub remote
        <input
          value={remoteUrl}
          disabled={busy}
          onChange={(e) => setRemoteUrl(e.target.value)}
          onBlur={() => void save(state, remoteUrl)}
          placeholder="https://github.com/owner/repo.git"
          className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1.5 font-mono text-[10px] text-text-primary"
        />
      </label>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-muted">
        Automatic sync
        <select
          value={String(state.scheduleMinutes)}
          disabled={busy}
          onChange={(e) => {
            const next = { ...state, scheduleMinutes: Number(e.target.value) };
            setState(next);
            void save(next);
          }}
          className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary"
        >
          <option value={0}>Off</option>
          <option value={15}>Every 15 minutes</option>
          <option value={30}>Every 30 minutes</option>
          <option value={60}>Hourly</option>
          <option value={360}>Every 6 hours</option>
          <option value={1440}>Daily</option>
        </select>
      </label>
        </>
      )}

      <fieldset className="space-y-1.5">
        <legend className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Spaces
        </legend>
        {PINNED_SPACE_NAMES.map((name) => (
          <label key={name} className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={state.spaces[name]}
              disabled={busy}
              onChange={(e) => {
                const next = {
                  ...state,
                  spaces: { ...state.spaces, [name]: e.target.checked },
                };
                setState(next);
                void save(next);
              }}
            />
            {SPACE_LABELS[name]}
          </label>
        ))}
      </fieldset>

      <label className="flex items-start gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={state.files}
          disabled={busy}
          onChange={(e) => {
            const next = { ...state, files: e.target.checked };
            setState(next);
            void save(next);
          }}
        />
        <span>
          Files — every file and folder in the sidebar Files section. One toggle, not one per
          folder.
        </span>
      </label>

      {plannerOn && (
      <label className="flex items-start gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={state.vaultPlanner}
          disabled={busy}
          onChange={(e) => {
            const next = { ...state, vaultPlanner: e.target.checked };
            setState(next);
            void save(next);
          }}
        />
        <span>This vault’s planner (.metis/planner/).</span>
      </label>
      )}

        </>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        disabled={busy || !state.enabled || !state.github || !remoteUrl.trim()}
        onClick={() => void syncNow()}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? "Working…" : "Sync now"}
      </button>
    </div>
  );
}
