import type { Settings } from "@/types/persona";
import { jekyllExportDestinationLabel } from "@/utils/exportDestinations";
import { SAVE_DIALOG_EXPORT_LABEL } from "@/utils/saveDialogExport";
import { JekyllExportSettings } from "./JekyllExportSettings";

export function ExportSettings({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-[11px] font-semibold text-text-primary">Export</h4>
        <p className="text-xs leading-relaxed text-text-secondary">
          Visual PDF exports and agent run log CSV/JSON use a native save dialog each time —
          destination:{" "}
          <span className="font-mono text-[10px] text-text-muted">{SAVE_DIALOG_EXPORT_LABEL}</span>
        </p>
      </section>

      <section className="space-y-3 border-t border-border pt-4">
        <div>
          <h4 className="text-[11px] font-semibold text-text-primary">Jekyll (Chirpy)</h4>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            Convert to Jekyll writes posts and images into your blog repo — destination:{" "}
            <span className="font-mono text-[10px] text-text-muted">
              {jekyllExportDestinationLabel(settings.jekyllBlogRoot)}
            </span>
          </p>
        </div>
        <JekyllExportSettings settings={settings} onUpdate={onUpdate} embedded />
      </section>
    </div>
  );
}
