import DOMPurify from "dompurify";
import { parseMarkedWithHighlight } from "./markedHighlight";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** GitHub-style heading slug for in-page anchor links. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function addHeadingIds(html: string): string {
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/gi, (match, level, inner) => {
    const plain = inner.replace(/<[^>]+>/g, "").trim();
    if (!plain) return match;
    const id = headingSlug(plain);
    return `<h${level} id="${escapeHtml(id)}">${inner}</h${level}>`;
  });
}

export type SanitizeMarkdownOptions = {
  /** Allow task-list checkbox inputs (GFM). */
  taskLists?: boolean;
  /** Allow `id` on headings after `addHeadingIds`. */
  headingIds?: boolean;
  /** Extra attributes for preview images (`data-src`, wikilinks, etc.). */
  previewAttrs?: boolean;
  /** Allow Metis sticky-note `<aside>` wrappers from `preprocessStickyBlocksForPreview`. */
  stickyNotes?: boolean;
};

const PREVIEW_EXTRA_ATTR = [
  "data-src",
  "data-metis-wikilink",
  "data-metis-sticky-width",
  "data-metis-sticky-idx",
  "data-metis-source-offset",
  "data-metis-source-end",
  "data-image-idx",
  "data-export-abs-path",
  "loading",
  "id",
] as const;

let purifyHooksInstalled = false;

function installPurifyHooks(): void {
  if (purifyHooksInstalled) return;
  purifyHooksInstalled = true;
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "input") return;
    const type = node instanceof Element ? node.getAttribute("type")?.toLowerCase() : "";
    if (type !== "checkbox") node.parentNode?.removeChild(node);
  });
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName === "background") {
      data.keepAttr = false;
      return;
    }
    if (data.attrName === "style" && /url\s*\(/i.test(data.attrValue)) {
      const onlyVars = data.attrValue
        .split(/url\s*\(/i)
        .slice(1)
        .every((part) => part.trimStart().startsWith("var(--"));
      if (!onlyVars) data.keepAttr = false;
    }
  });
}

/** Sanitize marked HTML for React `dangerouslySetInnerHTML`. */
export function sanitizeMarkdownHtml(
  rawHtml: string,
  options: SanitizeMarkdownOptions = {},
): string {
  installPurifyHooks();
  const addTags: string[] = options.taskLists ? ["input"] : [];
  if (options.stickyNotes) addTags.push("aside", "div");
  const addAttr: string[] = ["type", "checked", "disabled"];
  if (options.stickyNotes) addAttr.push("class", "style", "aria-hidden");
  if (options.previewAttrs) addAttr.push(...PREVIEW_EXTRA_ATTR);
  else if (options.headingIds) addAttr.push("id");

  const clean = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: [...addTags],
    ADD_ATTR: addAttr,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "picture", "source", "audio", "video", "svg", "image"],
    FORBID_ATTR: ["srcset", "background"],
    // Full http(s)/mailto URLs, fragments, and vault-relative paths — not bare scheme prefixes.
    ALLOWED_URI_REGEXP:
      /^(?:https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|#(?:[^\s<>"']*)?|\/[^\s<>"']*|\.\/[^\s<>"']*|[^:\s<>"']+(?:\/[^\s<>"']*)*)$/i,
  });
  return stripRemoteImageSrc(clean);
}

/** Remote image URLs are removed. Vault images use `asset:` or `data:`. */
function stripRemoteImageSrc(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    if (/^https?:/i.test(src)) return "";
    return tag;
  });
}

export type ParseMarkdownOptions = {
  gfm?: boolean;
  breaks?: boolean;
  headingIds?: boolean;
  sanitize?: SanitizeMarkdownOptions;
};

/** marked.parse + optional heading ids + DOMPurify in one pass. */
export function parseMarkdownToHtml(
  markdown: string,
  options: ParseMarkdownOptions = {},
): string {
  if (!markdown.trim()) return "";
  const raw = parseMarkedWithHighlight(markdown, {
    gfm: options.gfm ?? true,
    breaks: options.breaks ?? false,
  });
  const withIds = options.headingIds ? addHeadingIds(raw) : raw;
  return sanitizeMarkdownHtml(withIds, options.sanitize ?? { taskLists: true });
}

/** Scroll a preview container to approximate a source cursor offset. */
export function scrollPreviewToSourceOffset(
  container: HTMLElement,
  content: string,
  offset: number,
): void {
  const clamped = Math.max(0, Math.min(offset, content.length));
  const before = content.slice(0, clamped);
  const line = before.split("\n").length;
  const totalLines = Math.max(1, content.split("\n").length);
  const ratio = (line - 1) / totalLines;
  container.scrollTop = ratio * Math.max(0, container.scrollHeight - container.clientHeight);
}

/** Scroll preview to a `#fragment` / heading slug. */
export function scrollPreviewToFragment(root: HTMLElement, fragment: string): void {
  const raw = decodeURIComponent(fragment.replace(/^#/, "")).trim();
  if (!raw) return;

  const slug = headingSlug(raw);
  const candidates = [raw, slug, raw.toLowerCase()];
  let target: HTMLElement | null = null;
  for (const id of candidates) {
    try {
      target = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    } catch {
      target = root.querySelector<HTMLElement>(`[id="${id}"]`);
    }
    if (target) break;
  }
  if (!target) {
    const headings = root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
    for (const h of headings) {
      if (
        headingSlug(h.textContent ?? "") === slug ||
        h.textContent?.trim().toLowerCase() === raw.toLowerCase()
      ) {
        target = h;
        break;
      }
    }
  }
  if (!target) return;
  const containerRect = root.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  root.scrollTop += targetRect.top - containerRect.top - root.clientHeight * 0.15;
}
