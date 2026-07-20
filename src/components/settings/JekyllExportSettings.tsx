import type { Settings } from "@/types/persona";
import { pickJekyllBlogRoot } from "@/services/jekyllExportService";

const inputCls =
  "mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary";

export function JekyllExportSettings({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-text-secondary">
        Defaults for sidebar or export hub Convert to Jekyll….
        Posts are written to <code className="text-[10px]">_posts/</code> with images under{" "}
        <code className="text-[10px]">assets/img/</code>. Leave fields blank until you configure
        your blog.
      </p>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Blog repository
        </label>
        <div className="mt-1 flex gap-2">
          <input
            value={settings.jekyllBlogRoot ?? ""}
            onChange={(e) => onUpdate({ jekyllBlogRoot: e.target.value })}
            placeholder="/path/to/your-blog.github.io"
            className={`${inputCls} min-w-0 flex-1 font-mono text-[10px]`}
          />
          <button
            type="button"
            onClick={async () => {
              const picked = await pickJekyllBlogRoot();
              if (picked) onUpdate({ jekyllBlogRoot: picked });
            }}
            className="shrink-0 rounded border border-border px-2 py-1.5 text-xs text-text-secondary hover:bg-surface-overlay"
          >
            Browse
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Author
          </label>
          <input
            value={settings.jekyllAuthor ?? ""}
            onChange={(e) => onUpdate({ jekyllAuthor: e.target.value })}
            placeholder="your-username"
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Image subfolder
          </label>
          <input
            value={settings.jekyllImageSubfolder ?? ""}
            onChange={(e) => onUpdate({ jekyllImageSubfolder: e.target.value })}
            placeholder="exports"
            className={`${inputCls} font-mono`}
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Default categories
        </label>
        <input
          value={(settings.jekyllDefaultCategories ?? []).join(", ")}
          onChange={(e) =>
            onUpdate({
              jekyllDefaultCategories: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="e.g. Technical, Notes"
          className={inputCls}
        />
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Site URL (wikilinks)
        </label>
        <input
          value={settings.jekyllSiteUrl ?? ""}
          onChange={(e) => onUpdate({ jekyllSiteUrl: e.target.value })}
          placeholder="https://example.com"
          className={`${inputCls} font-mono`}
        />
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Description boilerplate
        </label>
        <textarea
          value={settings.jekyllDescription ?? ""}
          onChange={(e) => onUpdate({ jekyllDescription: e.target.value })}
          placeholder="Optional default description for exported posts"
          rows={3}
          className={`${inputCls} resize-y`}
        />
      </div>
    </div>
  );
}
