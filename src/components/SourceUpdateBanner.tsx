import { useSourceUpdateStore } from "@/store/useSourceUpdateStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { openExternalUrl } from "@/utils/vaultNavigation";

export function SourceUpdateBanner() {
  const status = useSourceUpdateStore((s) => s.status);
  const currentVersion = useSourceUpdateStore((s) => s.currentVersion);
  const latestVersion = useSourceUpdateStore((s) => s.latestVersion);
  const sourceUrl = useSourceUpdateStore((s) => s.sourceUrl);
  const dismiss = useSourceUpdateStore((s) => s.dismiss);
  const enabled = usePersonaStore((s) => s.settings.sourceUpdateCheckEnabled !== false);

  if (!enabled || status !== "available" || !latestVersion) return null;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] text-text-primary"
      role="status"
    >
      <p>
        Update available: <span className="font-semibold">v{latestVersion}</span> is on GitHub
        {currentVersion ? ` (you’re on v${currentVersion})` : ""}. Pull the source and rebuild —
        Metis does not download installers.
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openExternalUrl(sourceUrl)}
          className="rounded border border-accent/40 bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/30"
        >
          View on GitHub
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded border border-border px-2 py-0.5 text-[10px] text-text-muted hover:text-text-primary"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
