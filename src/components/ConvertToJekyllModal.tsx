import { useCallback, useEffect, useMemo, useState } from "react";
import { FileOutput, FolderOpen, X } from "lucide-react";
import { usePersonaStore } from "@/store/usePersonaStore";
import { DEFAULT_SETTINGS } from "@/types/persona";
import {
  exportNoteToJekyll,
  loadNoteContentForJekyll,
  pickJekyllBlogRoot,
  previewJekyllConversion,
} from "@/services/jekyllExportService";
import { slugify } from "@/utils/jekyllConverter";

interface Props {
  notePath: string;
  onClose: () => void;
}

export default function ConvertToJekyllModal({ notePath, onClose }: Props) {
  const settings = usePersonaStore((s) => s.settings);
  const updateSettings = usePersonaStore((s) => s.updateSettings);

  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [date, setDate] = useState("");
  const [categoriesText, setCategoriesText] = useState("");
  const [blogRoot, setBlogRoot] = useState(settings.jekyllBlogRoot ?? "");
  const [imageSubfolder, setImageSubfolder] = useState(
    settings.jekyllImageSubfolder ?? DEFAULT_SETTINGS.jekyllImageSubfolder ?? "Metis",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const defaultCategories =
    settings.jekyllDefaultCategories ?? DEFAULT_SETTINGS.jekyllDefaultCategories ?? ["Technical"];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await loadNoteContentForJekyll(notePath);
        if (cancelled) return;
        setContent(body);
        const initial = previewJekyllConversion({
          notePath,
          content: body,
          categories: defaultCategories,
          imageSubfolder,
          blogRoot: blogRoot || undefined,
        });
        setTitle(initial.title);
        setSlug(initial.slug);
        setDate(initial.date);
        setCategoriesText(defaultCategories.join(", "));
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notePath]);

  const categories = useMemo(
    () =>
      categoriesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [categoriesText],
  );

  const preview = useMemo(() => {
    if (!content) return null;
    try {
      return previewJekyllConversion({
        notePath,
        content,
        title,
        slug,
        date,
        categories,
        imageSubfolder,
        blogRoot: blogRoot || undefined,
      });
    } catch {
      return null;
    }
  }, [content, notePath, title, slug, date, categories, imageSubfolder, blogRoot]);

  const refreshPreview = useCallback(() => {
    if (!content) return;
    try {
      const next = previewJekyllConversion({
        notePath,
        content,
        title,
        slug,
        date,
        categories,
        imageSubfolder,
        blogRoot: blogRoot || undefined,
      });
      setSlug(next.slug);
      setDate(next.date);
    } catch {
      /* user may be mid-edit */
    }
  }, [content, notePath, title, slug, date, categories, imageSubfolder, blogRoot]);

  const pickBlogRoot = async () => {
    const picked = await pickJekyllBlogRoot();
    if (!picked) return;
    setBlogRoot(picked);
    updateSettings({ jekyllBlogRoot: picked });
  };

  const runExport = async () => {
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    setSavedPath(null);
    try {
      if (!blogRoot.trim()) throw new Error("Select your Jekyll blog repository folder.");
      const path = await exportNoteToJekyll({
        notePath,
        content,
        title: title.trim(),
        slug: slug.trim() || slugify(title),
        date,
        categories,
        blogRoot: blogRoot.trim(),
        imageSubfolder: imageSubfolder.trim(),
      });
      setSavedPath(path);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const noteName = notePath.split("/").pop() ?? notePath;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface-raised shadow-2xl"
        role="dialog"
        aria-labelledby="jekyll-export-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FileOutput className="h-4 w-4 text-accent" />
            <h2 id="jekyll-export-title" className="text-sm font-semibold text-text-primary">
              Convert to Jekyll
            </h2>
          </div>
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

        <div className="min-h-0 flex-1 overflow-y-auto space-y-3 px-4 py-3">
          <p className="text-xs text-text-secondary">
            Converts <span className="font-mono text-text-primary">{noteName}</span> to a Chirpy
            post in <span className="font-mono">_posts/</span>, copies images to{" "}
            <span className="font-mono">assets/img/</span>, and rewrites wikilinks for your blog.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={refreshPreview}
                className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary"
              />
            </Field>
            <Field label="Slug">
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1.5 font-mono text-xs text-text-primary"
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary"
              />
            </Field>
            <Field label="Categories (comma-separated)">
              <input
                value={categoriesText}
                onChange={(e) => setCategoriesText(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary"
              />
            </Field>
            <Field label="Image subfolder">
              <input
                value={imageSubfolder}
                onChange={(e) => setImageSubfolder(e.target.value)}
                placeholder="Metis"
                className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1.5 font-mono text-xs text-text-primary"
              />
            </Field>
            <Field label="Blog repository">
              <div className="mt-1 flex gap-2">
                <input
                  value={blogRoot}
                  onChange={(e) => setBlogRoot(e.target.value)}
                  placeholder="…/KyhleOhlinger.github.io"
                  className="min-w-0 flex-1 rounded border border-border bg-surface-overlay px-2 py-1.5 font-mono text-[10px] text-text-primary"
                />
                <button
                  type="button"
                  onClick={pickBlogRoot}
                  disabled={busy}
                  className="shrink-0 rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-overlay"
                  title="Pick blog folder"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              </div>
            </Field>
          </div>

          {preview && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                Preview
              </p>
              <p className="mt-1 font-mono text-xs text-accent">_posts/{preview.filename}</p>
              {preview.imageCopies.length > 0 && (
                <p className="mt-2 text-[10px] text-text-secondary">
                  {preview.imageCopies.length} image
                  {preview.imageCopies.length === 1 ? "" : "s"} → assets/img/{imageSubfolder}/
                </p>
              )}
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-overlay p-2 font-mono text-[10px] leading-relaxed text-text-secondary">
                {preview.content.slice(0, 2400)}
                {preview.content.length > 2400 ? "\n…" : ""}
              </pre>
            </div>
          )}

          {savedPath && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-300">
              Saved to <span className="break-all font-mono">{savedPath}</span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-overlay disabled:opacity-40"
          >
            {savedPath ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={runExport}
            disabled={busy || !content || !preview}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? "Exporting…" : "Export to _posts"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}
