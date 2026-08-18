import { usePersonaStore } from "@/store/usePersonaStore";
import { jekyllExportDestinationLabel } from "@/utils/exportDestinations";
import { Hint, Section, SectionAction } from "../shared/ui";

export function InfoExportSection() {
  const jekyllBlogRoot = usePersonaStore((s) => s.settings.jekyllBlogRoot);
  const jekyllDestination = jekyllExportDestinationLabel(jekyllBlogRoot);
  const jekyllConfigured = Boolean(jekyllBlogRoot?.trim());

  return (
    <Section title="Export">
      <div className="space-y-3">
        <div className="rounded border border-border/60 bg-surface-base/30 px-2.5 py-2">
          <p className="text-[10px] font-medium text-text-primary">Save dialog</p>
          <p className="mt-0.5 text-[10px] text-text-muted">PDF · Agent run CSV/JSON</p>
          <Hint>Choose location when you export — no default folder.</Hint>
        </div>

        <div className="rounded border border-border/60 bg-surface-base/30 px-2.5 py-2">
          <p className="text-[10px] font-medium text-text-primary">Jekyll posts</p>
          <p
            className={[
              "mt-0.5 break-all text-[10px] leading-snug",
              jekyllConfigured ? "font-mono text-text-secondary" : "text-text-muted",
            ].join(" ")}
            title={jekyllConfigured ? jekyllDestination : undefined}
          >
            {jekyllDestination}
          </p>
          {!jekyllConfigured && (
            <Hint>Set your blog repo in export settings to enable Convert to Jekyll.</Hint>
          )}
        </div>

        <SectionAction onClick={() => usePersonaStore.getState().openSettings("export")}>
          Export settings…
        </SectionAction>
      </div>
    </Section>
  );
}
