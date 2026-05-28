import { useMemo, useEffect, useRef, useDeferredValue } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store/useStore";
import type { NoteMetadata } from "../store/useStore";
import { resolveWikilinkAssetPath } from "../utils/resolveWikilinkAsset";
import { openDomContextMenu } from "../utils/domContextMenu";

interface Props {
  content: string;
  filePath: string;
  vaultPath: string;
  bgColor?: string;
  textColor?: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

function normalizePath(raw: string): string {
  const isAbs = raw.startsWith("/");
  const stack: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "..") stack.pop();
    else if (seg && seg !== ".") stack.push(seg);
  }
  return (isAbs ? "/" : "") + stack.join("/");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openWikilinkFromIndex(
  encodedName: string,
  noteIndex: NoteMetadata[],
  setActiveFile: (path: string, content: string) => void,
) {
  const name = decodeURIComponent(encodedName);
  const note = noteIndex.find(
    (n) =>
      n.name === name ||
      n.name.toLowerCase() === name.toLowerCase() ||
      n.name.replace(/\.md$/i, "").toLowerCase() === name.replace(/\.md$/i, "").toLowerCase(),
  );
  if (!note) return;
  invoke<string>("get_file_content", { path: note.path })
    .then((c) => setActiveFile(note.path, c))
    .catch(console.error);
}

function openHrefInVault(
  href: string,
  fileDir: string,
  vaultPath: string,
  setActiveFile: (path: string, content: string) => void,
) {
  if (/^https?:\/\//i.test(href)) {
    invoke("open_url", { url: href }).catch(console.error);
    return;
  }
  if (!href || href === "#") return;

  let abs: string;
  if (href.startsWith("/")) {
    abs = normalizePath(href);
  } else {
    abs = normalizePath(`${fileDir}/${href.split("#")[0]}`);
  }
  if (!abs.startsWith(`${vaultPath}/`)) return;

  invoke<string>("get_file_content", { path: abs })
    .then((c) => setActiveFile(abs, c))
    .catch(console.error);
}

type PreviewContext = {
  noteIndex: NoteMetadata[];
  setActiveFile: (path: string, content: string) => void;
  fileDir: string;
  vaultPath: string;
  imagePaths: string[];
  revealLabel: string;
};

export default function MarkdownPreview({ content, filePath, vaultPath, bgColor, textColor }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<PreviewContext>({
    noteIndex: [],
    setActiveFile: () => {},
    fileDir: "",
    vaultPath: "",
    imagePaths: [],
    revealLabel: "Reveal in Finder",
  });

  const { noteIndex, assetIndex, setActiveFile } = useStore(
    useShallow((s) => ({
      noteIndex: s.noteIndex,
      assetIndex: s.assetIndex,
      setActiveFile: s.setActiveFile,
    })),
  );

  const deferredContent = useDeferredValue(content);

  const fileDir = useMemo(
    () => filePath.substring(0, filePath.lastIndexOf("/")),
    [filePath],
  );

  const preview = useMemo(() => {
    const imagePaths: string[] = [];

    const resolveImageAbsPath = (src: string): string | null => {
      if (!src || /^(https?:|data:|blob:|asset:)/i.test(src)) return null;

      if (IMAGE_EXT.test(src) && !src.includes("/")) {
        return resolveWikilinkAssetPath(src, assetIndex, vaultPath);
      }

      if (src.startsWith("assets/") || (src.includes("/") && !/^https?:/i.test(src))) {
        const normalized = normalizePath(`${vaultPath}/${src.replace(/^\.\//, "")}`);
        if (!normalized.startsWith(`${vaultPath}/`)) return null;
        return normalized;
      }

      if (src.startsWith("/")) {
        const normalized = normalizePath(src);
        if (!normalized.startsWith(`${vaultPath}/`) && normalized !== vaultPath) return null;
        return normalized;
      }

      const normalized = normalizePath(`${fileDir}/${src}`);
      if (!normalized.startsWith(`${vaultPath}/`) && normalized !== vaultPath) return null;
      return normalized;
    };

    const resolveImageSrc = (src: string): string => {
      const abs = resolveImageAbsPath(src);
      if (!abs) {
        if (/^(https?:|data:|asset:|blob:)/i.test(src)) return src;
        return "";
      }
      return convertFileSrc(abs);
    };

    // ![[wiki-image.ext]] → standard markdown with filename target (resolved below).
    let md = deferredContent.replace(
      /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/gi,
      (_, filename) => `![${filename}](${filename})`,
    );

    // [[wikilinks]] → raw HTML so DOMPurify keeps data-metis-wikilink (marked passes HTML through).
    md = md.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
      const trimmed = name.trim();
      const encoded = encodeURIComponent(trimmed);
      return `<a href="#" data-metis-wikilink="${encoded}">${escapeHtml(trimmed)}</a>`;
    });

    let raw = marked.parse(md, { gfm: true }) as string;

    // Stash asset:// URLs in data-src — DOMPurify strips non-http(s) img src values.
    raw = raw.replace(
      /(<img\b[^>]*?)\bsrc="([^"]+)"/gi,
      (_, before, src) => {
        const resolved = resolveImageSrc(src);
        const absPath = resolveImageAbsPath(src);
        const idx = imagePaths.length;
        if (absPath) imagePaths.push(absPath);
        const idxAttr = absPath ? ` data-image-idx="${idx}"` : "";
        return `${before}data-src="${resolved}" loading="lazy"${idxAttr}`;
      },
    );

    const html = DOMPurify.sanitize(raw, {
      ADD_TAGS: ["input"],
      ADD_ATTR: [
        "type",
        "checked",
        "disabled",
        "data-src",
        "data-metis-wikilink",
        "data-image-idx",
        "loading",
      ],
    });

    return { html, imagePaths };
  }, [deferredContent, filePath, vaultPath, fileDir, assetIndex]);

  const revealLabel =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
      ? "Reveal in Finder"
      : "Reveal in File Explorer";

  ctxRef.current = {
    noteIndex,
    setActiveFile,
    fileDir,
    vaultPath,
    imagePaths: preview.imagePaths,
    revealLabel,
  };

  // Native capture listeners — reliable in Tauri webviews with dangerouslySetInnerHTML.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onClick = (e: MouseEvent) => {
      const ctx = ctxRef.current;
      const target = e.target as HTMLElement;

      if (target.closest("img[data-image-idx]")) {
        e.preventDefault();
        return;
      }

      const a = target.closest("a") as HTMLAnchorElement | null;
      if (!a || !root.contains(a)) return;

      e.preventDefault();
      e.stopPropagation();

      const wiki = a.dataset.metisWikilink;
      if (wiki) {
        openWikilinkFromIndex(wiki, ctx.noteIndex, ctx.setActiveFile);
        return;
      }
      openHrefInVault(a.getAttribute("href") ?? "", ctx.fileDir, ctx.vaultPath, ctx.setActiveFile);
    };

    const onContextMenu = (e: MouseEvent) => {
      const ctx = ctxRef.current;
      const target = e.target as HTMLElement;

      const img = target.closest("img[data-image-idx]") as HTMLImageElement | null;
      const imgIdx = img?.dataset.imageIdx;
      if (img && imgIdx !== undefined && root.contains(img)) {
        const absPath = ctx.imagePaths[Number(imgIdx)];
        if (absPath) {
          e.preventDefault();
          e.stopPropagation();
          openDomContextMenu(e.clientX, e.clientY, [
            {
              label: ctx.revealLabel,
              onClick: () => {
                invoke("reveal_in_finder", { path: absPath, vaultPath: ctx.vaultPath }).catch(
                  console.error,
                );
              },
            },
          ]);
        }
        return;
      }

      const a = target.closest("a") as HTMLAnchorElement | null;
      if (!a || !root.contains(a)) return;

      const wiki = a.dataset.metisWikilink;
      if (wiki) {
        e.preventDefault();
        e.stopPropagation();
        openDomContextMenu(e.clientX, e.clientY, [
          {
            label: "Open Note",
            onClick: () => openWikilinkFromIndex(wiki, ctx.noteIndex, ctx.setActiveFile),
          },
        ]);
        return;
      }

      const href = a.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      openDomContextMenu(e.clientX, e.clientY, [
        {
          label: "Open Link",
          onClick: () => {
            invoke("open_url", { url: href }).catch(console.error);
          },
        },
      ]);
    };

    root.addEventListener("click", onClick, true);
    root.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, []);

  // Restore img src after sanitisation (asset:// URLs cannot live in sanitized HTML).
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => {
      const src = img.dataset.src;
      if (src) {
        img.src = src;
        img.loading = "lazy";
        delete img.dataset.src;
      }
    });
  }, [preview.html]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.html]);

  return (
    <div
      ref={rootRef}
      className="preview-prose pointer-events-auto absolute inset-0 z-20 h-full min-h-0 overflow-y-auto"
      style={bgColor ? { backgroundColor: bgColor, color: textColor } : undefined}
    >
      <div ref={contentRef} dangerouslySetInnerHTML={{ __html: preview.html }} />
    </div>
  );
}
