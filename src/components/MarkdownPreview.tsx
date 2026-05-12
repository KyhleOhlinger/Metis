import { useMemo, useEffect, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useStore } from "../store/useStore";
import { resolveWikilinkAssetSrc } from "../utils/resolveWikilinkAsset";

interface Props {
  content: string;
  filePath: string;
  vaultPath: string;
  bgColor?: string;
  textColor?: string;
}

export default function MarkdownPreview({ content, filePath, vaultPath, bgColor, textColor }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { noteIndex, assetIndex, setActiveFile } = useStore();

  const fileDir = useMemo(
    () => filePath.substring(0, filePath.lastIndexOf("/")),
    [filePath],
  );

  // ── Build sanitized HTML ───────────────────────────────────────────────────
  const html = useMemo(() => {
    /**
     * Normalize a POSIX-style path by resolving `.` and `..` segments.
     * Used before vault-boundary validation to prevent path traversal attacks.
     */
    const normalizePath = (raw: string): string => {
      const isAbs = raw.startsWith("/");
      const stack: string[] = [];
      for (const seg of raw.split("/")) {
        if (seg === "..") stack.pop();
        else if (seg && seg !== ".") stack.push(seg);
      }
      return (isAbs ? "/" : "") + stack.join("/");
    };

    /**
     * Resolve an image src to a fully-qualified Tauri asset:// URL.
     *
     * Priority:
     *  1. Already has a scheme (https, data, asset, blob) → pass through
     *  2. Starts with "assets/" → vault-root-relative
     *  3. Absolute path starting with "/" → normalise and resolve directly
     *  4. Anything else → relative to the note's own directory
     *
     * SECURITY: For cases 2 and 4 the resolved path is normalised and
     * validated to stay within the vault.  This prevents `../` traversal
     * that could expose sensitive files via the Tauri asset protocol.
     */
    const resolveImageSrc = (src: string): string => {
      if (!src || /^(https?:|data:|asset:|blob:)/i.test(src)) return src;

      if (src.startsWith("assets/")) {
        const normalized = normalizePath(`${vaultPath}/${src}`);
        if (!normalized.startsWith(`${vaultPath}/`)) return "";
        return convertFileSrc(normalized);
      }

      if (src.startsWith("/")) {
        // SECURITY: validate vault containment before serving absolute paths
        // via asset://. Without this check, notes containing ![](/etc/passwd)
        // would load arbitrary filesystem files through Tauri's asset protocol.
        const normalized = normalizePath(src);
        if (!normalized.startsWith(`${vaultPath}/`) && normalized !== vaultPath) {
          return "";
        }
        return convertFileSrc(normalized);
      }

      const normalized = normalizePath(`${fileDir}/${src}`);
      // Reject relative paths that escape the vault
      if (!normalized.startsWith(`${vaultPath}/`) && normalized !== vaultPath) {
        return "";
      }
      return convertFileSrc(normalized);
    };

    // ── Pre-process ![[wiki-image.ext]] ───────────────────────────────────
    // Use vault-wide asset resolution so Obsidian vaults work out-of-the-box:
    // ![[photo.jpg]] finds the file anywhere in the vault, not just the root.
    let md = content.replace(
      /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/gi,
      (_, filename) =>
        `![${filename}](${resolveWikilinkAssetSrc(filename, assetIndex, vaultPath)})`,
    );

    // ── Pre-process [[wikilinks]] ─────────────────────────────────────────
    md = md.replace(
      /\[\[([^\]]+)\]\]/g,
      (_, name) => `[${name}](metis://open/${encodeURIComponent(name)})`,
    );

    // ── Parse markdown → HTML ─────────────────────────────────────────────
    const raw = marked.parse(md, { gfm: true }) as string;

    // ── Resolve image src and stash it in data-src ────────────────────────
    //
    // DOMPurify v3 strips non-standard URI schemes (including asset://) from
    // src attributes even with a custom ALLOWED_URI_REGEXP.  We work around
    // this by storing the resolved URL in data-src before sanitization and
    // then moving it back to src after the component renders (see useEffect).
    const withDataSrc = raw.replace(
      /(<img\b[^>]*?)\bsrc="([^"]+)"/gi,
      (_, before, src) => `${before}data-src="${resolveImageSrc(src)}"`,
    );

    // ── Sanitize ──────────────────────────────────────────────────────────
    return DOMPurify.sanitize(withDataSrc, {
      ADD_TAGS: ["input"],
      ADD_ATTR: ["type", "checked", "disabled", "data-src"],
    });
  }, [content, filePath, vaultPath, fileDir, assetIndex]);

  // ── Restore image sources after each render ────────────────────────────────
  // DOMPurify preserved data-src; now we move it to src so the browser loads
  // the image.  We also add loading="lazy" for free performance.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => {
      const src = img.dataset.src;
      if (src) {
        img.src = src;
        img.loading = "lazy";
        delete img.dataset.src;
      }
    });
  }, [html]);

  // ── Scroll to bottom when Visual preview mounts / updates ─────────────────
  // Page transitions prefer anchoring at the end of the document viewport.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const raf = requestAnimationFrame(() => {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    });

    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  // ── Unified link click handler ─────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
      if (!a) return;

      e.preventDefault();
      const href = a.getAttribute("href") ?? "";

      if (href.startsWith("metis://open/")) {
        const name = decodeURIComponent(href.slice("metis://open/".length));
        const note = noteIndex.find(
          (n) =>
            n.name === name ||
            n.name.toLowerCase() === name.toLowerCase(),
        );
        if (!note) return;
        invoke<string>("get_file_content", { path: note.path })
          .then((c) => setActiveFile(note.path, c))
          .catch(console.error);
      } else if (/^https?:\/\//i.test(href)) {
        invoke("open_url", { url: href }).catch(console.error);
      }
    };

    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [noteIndex, setActiveFile]);

  return (
    <div
      ref={containerRef}
      className="preview-prose h-full min-h-0 overflow-y-auto"
      style={bgColor ? { backgroundColor: bgColor, color: textColor } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
