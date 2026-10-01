import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CORE_PLUGINS, type CommunityCatalogEntry, type CorePluginId } from "@/plugins/corePlugins";
import { isCoreEnabled } from "@/plugins/corePlugins";
import { usePluginStore } from "@/plugins/usePluginStore";
import { fetchCommunityCatalog, fetchOfficialPluginFiles } from "@/plugins/communityCatalog";
import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { appConfirm, toastError, toastInfo } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";
import { ensureSupernoteFolder } from "@/services/supernoteSync";
import {
  SUPERNOTE_DEFAULT_INTERVAL_MIN,
  SUPERNOTE_DEFAULT_PORT,
} from "@/constants/supernote";

function Toggle({
  on,
  disabled,
  onClick,
  title,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 ${
        on ? "bg-accent" : "border border-border bg-surface-raised"
      }`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function PluginsSettingsSection() {
  const vaultPath = useStore((s) => s.vaultPath);
  const core = usePluginStore((s) => s.core);
  const restrictedMode = usePluginStore((s) => s.restrictedMode);
  const enabled = usePluginStore((s) => s.enabled);
  const installed = usePluginStore((s) => s.installed);
  const setCoreEnabled = usePluginStore((s) => s.setCoreEnabled);
  const setRestrictedMode = usePluginStore((s) => s.setRestrictedMode);
  const setCommunityEnabled = usePluginStore((s) => s.setCommunityEnabled);
  const uninstall = usePluginStore((s) => s.uninstall);
  const installFromFolder = usePluginStore((s) => s.installFromFolder);
  const installFiles = usePluginStore((s) => s.installFiles);

  const [browseOpen, setBrowseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const supernotePort = usePersonaStore((s) => s.settings.supernoteDevicePort ?? SUPERNOTE_DEFAULT_PORT);
  const supernoteInterval = usePersonaStore(
    (s) => s.settings.supernoteSyncIntervalMinutes ?? SUPERNOTE_DEFAULT_INTERVAL_MIN,
  );
  const updateSettings = usePersonaStore((s) => s.updateSettings);

  if (!vaultPath) {
    return (
      <p className="text-[11px] text-text-muted">
        Open a vault to manage plugins. Core and community lists are stored under{" "}
        <code className="font-mono text-[10px]">.metis/</code> in that folder.
      </p>
    );
  }

  const enabledSet = useMemo(() => new Set(enabled), [enabled]);
  const detail = installed.find((p) => p.id === detailId) ?? null;

  const onToggleCore = async (id: CorePluginId, next: boolean) => {
    if (id === "planner" && !next && useStore.getState().editorTab === "planner") {
      useStore.getState().setEditorTab("source");
    }
    await setCoreEnabled(id, next);
    if (id === "supernote" && next) {
      try {
        await ensureSupernoteFolder();
        await useStore.getState().refreshVault();
      } catch (err) {
        toastError(`Could not create handwritten/Supernote/: ${formatError(err)}`);
      }
    }
  };

  const turnOnCommunity = async () => {
    const ok = await appConfirm(
      "Community plugins can change how this vault looks. Metis never runs plugin JavaScript. Only enable packages you trust. Restricted Mode stays per vault.",
      {
        title: "Turn on community plugins?",
        confirmLabel: "Turn on",
        danger: true,
      },
    );
    if (!ok) return;
    await setRestrictedMode(false);
  };

  const installFolder = async () => {
    setBusy(true);
    try {
      const selected = await invoke<string | null>("pick_folder");
      if (!selected) return;
      await installFromFolder(selected);
      toastInfo("Plugin installed in this vault.");
    } catch (err) {
      toastError(`Install failed: ${formatError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-[11px] text-text-muted">
      <p>
        Plugins are <strong className="font-medium text-text-secondary">per vault</strong> (
        <code className="font-mono text-[10px]">.metis/core-plugins.json</code>,{" "}
        <code className="font-mono text-[10px]">community-plugins.json</code>,{" "}
        <code className="font-mono text-[10px]">plugins/&lt;id&gt;/</code>
        ). Secrets stay in app settings, not in plugin folders.
      </p>

      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Core plugins
        </h4>
        <p>Built-in Metis features. Turning one off hides its UI in this vault only.</p>
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {CORE_PLUGINS.map((plugin) => {
            const on = isCoreEnabled(core, plugin.id);
            return (
              <li
                key={plugin.id}
                className="flex items-start gap-2 bg-surface-overlay px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-primary">{plugin.name}</p>
                  <p className="mt-0.5 text-[10px] leading-snug">{plugin.description}</p>
                </div>
                <Toggle
                  on={on}
                  disabled={plugin.required}
                  title={
                    plugin.required
                      ? "Required for Metis to run"
                      : on
                        ? `Disable ${plugin.name}`
                        : `Enable ${plugin.name}`
                  }
                  onClick={() => void onToggleCore(plugin.id, !on)}
                />
              </li>
            );
          })}
        </ul>
        {isCoreEnabled(core, "supernote") && (
          <div className="space-y-2 rounded-md border border-border bg-surface-overlay px-2.5 py-2">
            <p className="text-xs font-medium text-text-primary">Supernote pull</p>
            <p className="text-[10px] leading-snug">
              Nomad IP is set on the <code className="font-mono">Supernote</code> folder (sync icon).
              Device must be on the same LAN with Browse &amp; Access on. Files land in{" "}
              <code className="font-mono">handwritten/Supernote/</code> as markdown notes (the{" "}
              <code className="font-mono">.note</code> binaries stay on disk, hidden in the tree).
            </p>
            <label className="flex items-center justify-between gap-2 text-[10px]">
              Sync interval (minutes)
              <input
                type="number"
                min={0}
                max={1440}
                value={supernoteInterval}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  updateSettings({ supernoteSyncIntervalMinutes: Math.max(0, Math.min(1440, Math.floor(n))) });
                }}
                className="w-16 rounded border border-border bg-surface-base px-1.5 py-0.5 font-mono text-[10px] text-text-primary"
              />
            </label>
            <p className="text-[9px] text-text-muted">0 = manual only. Values under 5 wait at least 5 minutes.</p>
            <label className="flex items-center justify-between gap-2 text-[10px]">
              Browse &amp; Access port
              <input
                type="number"
                min={1024}
                max={65535}
                value={supernotePort}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  updateSettings({ supernoteDevicePort: Math.max(1024, Math.min(65535, Math.floor(n))) });
                }}
                className="w-16 rounded border border-border bg-surface-base px-1.5 py-0.5 font-mono text-[10px] text-text-primary"
              />
            </label>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Community plugins
        </h4>
        {restrictedMode ? (
          <div className="space-y-2 rounded-md border border-border bg-surface-overlay px-2.5 py-2.5">
            <p className="text-xs font-medium text-text-primary">Restricted Mode is on</p>
            <p>
              Third-party packages in this vault are not loaded. Metis still will not execute plugin
              JavaScript if you turn this off — only reviewed CSS from{" "}
              <code className="font-mono text-[10px]">styles.css</code> is applied.
            </p>
            <button
              type="button"
              onClick={() => void turnOnCommunity()}
              className="rounded border border-accent/50 bg-accent/15 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/25"
            >
              Turn on community plugins
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setBrowseOpen(true)}
                className="rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-primary hover:border-accent/40"
              >
                Browse
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void installFolder()}
                className="rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-primary hover:border-accent/40 disabled:opacity-40"
              >
                Install from folder…
              </button>
              <button
                type="button"
                onClick={() => void setRestrictedMode(true)}
                className="rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-muted hover:text-text-primary"
              >
                Restrict
              </button>
            </div>
            <p>
              {installed.length} installed · {enabled.filter((id) => installed.some((p) => p.id === id)).length}{" "}
              enabled
            </p>
            {installed.length === 0 ? (
              <p>No community plugins in this vault yet. Browse the official list or install a folder that contains manifest.json.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                {installed.map((plugin) => {
                  const on = enabledSet.has(plugin.id);
                  return (
                    <li key={plugin.id} className="flex items-start gap-2 bg-surface-overlay px-2.5 py-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setDetailId(plugin.id)}
                      >
                        <p className="text-xs font-medium text-text-primary">{plugin.name}</p>
                        <p className="mt-0.5 text-[10px] leading-snug">
                          {plugin.author} · v{plugin.version}
                          {plugin.hasUnsupportedJs ? " · JS not loaded" : ""}
                        </p>
                      </button>
                      <Toggle
                        on={on}
                        title={on ? `Disable ${plugin.name}` : `Enable ${plugin.name}`}
                        onClick={() => void setCommunityEnabled(plugin.id, !on)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {detail && (
              <div className="space-y-2 rounded-md border border-border bg-surface-base px-2.5 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-text-primary">{detail.name}</p>
                    <p className="font-mono text-[10px] text-text-muted">{detail.id}</p>
                  </div>
                  <button
                    type="button"
                    className="text-[10px] text-text-muted hover:text-text-primary"
                    onClick={() => setDetailId(null)}
                  >
                    Close
                  </button>
                </div>
                <p>{detail.description || "No description."}</p>
                {detail.hasUnsupportedJs && (
                  <p className="text-[10px] text-amber-500/90">
                    This package includes main.js. Metis ignores plugin JavaScript.
                  </p>
                )}
                {!detail.hasStyles && (
                  <p>No styles.css — enabling this plugin has no visual effect until a stylesheet is added.</p>
                )}
                <button
                  type="button"
                  className="rounded border border-red-500/40 px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10"
                  onClick={() => {
                    void (async () => {
                      const ok = await appConfirm(`Uninstall ${detail.name} from this vault?`, {
                        confirmLabel: "Uninstall",
                        danger: true,
                      });
                      if (!ok) return;
                      await uninstall(detail.id);
                      setDetailId(null);
                    })();
                  }}
                >
                  Uninstall
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {browseOpen && (
        <BrowseOverlay
          installedIds={new Set(installed.map((p) => p.id))}
          onClose={() => setBrowseOpen(false)}
          onInstall={async (entry) => {
            const files = await fetchOfficialPluginFiles(entry.id);
            await installFiles(files.manifestJson, files.stylesCss);
            toastInfo(`Installed ${entry.name} in this vault.`);
          }}
        />
      )}
    </div>
  );
}

function BrowseOverlay({
  installedIds,
  onClose,
  onInstall,
}: {
  installedIds: Set<string>;
  onClose: () => void;
  onInstall: (entry: CommunityCatalogEntry) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CommunityCatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCommunityCatalog()
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(formatError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = catalog ?? [];
    if (!q) return rows;
    return rows.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    );
  }, [catalog, query]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="dialog">
      <div className="flex max-h-[min(32rem,80vh)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-xs font-semibold text-text-primary">Community plugins</p>
          <button type="button" className="text-[10px] text-text-muted hover:text-text-primary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="border-b border-border px-3 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search official catalog…"
            className="w-full rounded border border-border bg-surface-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error && <p className="px-1 py-2 text-[10px] text-red-400">{error}</p>}
          {!error && catalog === null && (
            <p className="px-1 py-2 text-[10px] text-text-muted">Loading catalog from GitHub…</p>
          )}
          {!error && catalog && catalog.length === 0 && (
            <p className="px-1 py-2 text-[10px] text-text-muted">
              No official community plugins are listed yet. You can still install a local folder with
              manifest.json and optional styles.css.
            </p>
          )}
          {filtered.map((entry) => {
            const already = installedIds.has(entry.id);
            return (
              <div
                key={entry.id}
                className="mb-1 flex items-start gap-2 rounded border border-border/70 bg-surface-overlay px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-primary">{entry.name}</p>
                  <p className="text-[10px] text-text-muted">
                    {entry.author} · {entry.id}
                  </p>
                  {entry.description && <p className="mt-0.5 text-[10px] leading-snug">{entry.description}</p>}
                </div>
                <button
                  type="button"
                  disabled={already || installing === entry.id}
                  onClick={() => {
                    setInstalling(entry.id);
                    void onInstall(entry)
                      .catch((err) => toastError(`Install failed: ${formatError(err)}`))
                      .finally(() => setInstalling(null));
                  }}
                  className="shrink-0 rounded border border-accent/40 px-2 py-0.5 text-[10px] text-accent disabled:opacity-40"
                >
                  {already ? "Installed" : installing === entry.id ? "…" : "Install"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
