import type { AssetMetadata, NoteMetadata } from "@/store/useStore";
import { collectImagePathsFromMarkdown } from "@/utils/noteImages";
import { resolveMarkdownImageAbsPath } from "@/utils/vaultImages";
import { resolveWikilinkAssetPath } from "@/utils/resolveWikilinkAsset";
import { findNoteByWikilinkName, normalizeWikilinkTarget } from "@/utils/vaultNavigation";
import { normalizePosixPath } from "@/utils/paths";

const WIKI_IMAGE_RE = /!\[\[([^\]]+)\]\]/g;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const WIKI_LINK_RE = /(?<!!)\[\[([^\]]+)\]\]/g;
const STICKY_OPEN_RE = /^:::\s*sticky(?:\s*\{[^}]*\})?\s*$/i;
const STICKY_WRAP_OPEN_RE = /^:::\s*stickywrap\s*$/i;
const FENCE_CLOSE_RE = /^:::\s*$/;

export interface JekyllConvertOptions {
  title?: string;
  slug?: string;
  /** YYYY-MM-DD */
  date?: string;
  author: string;
  categories: string[];
  description: string;
  imageSubfolder: string;
  siteUrl: string;
  notePath: string;
  vaultPath: string;
  assetIndex: AssetMetadata[];
  noteIndex: NoteMetadata[];
}

export interface JekyllImageCopy {
  sourceAbsPath: string;
  destFileName: string;
  blogPath: string;
}

export interface JekyllConvertResult {
  filename: string;
  content: string;
  title: string;
  slug: string;
  date: string;
  imageCopies: JekyllImageCopy[];
  heroImagePath: string | null;
}

interface ParsedFrontmatter {
  fields: Record<string, string | string[]>;
  body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { fields: {}, body: content };

  const fields: Record<string, string | string[]> = {};
  const yaml = match[1];
  let currentKey = "";
  let currentItems: string[] = [];
  let inList = false;

  const flush = () => {
    if (!currentKey) return;
    if (inList) fields[currentKey] = [...currentItems];
    currentKey = "";
    currentItems = [];
    inList = false;
  };

  for (const line of yaml.split(/\r?\n/)) {
    const listMatch = line.match(/^\s+-\s+(.*)/);
    const kvMatch = line.match(/^([\w][\w-]*):\s*(.*)/);

    if (listMatch && inList) {
      currentItems.push(listMatch[1].trim().replace(/^['"]|['"]$/g, ""));
    } else if (kvMatch) {
      flush();
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === "" || val === "[]") {
        inList = true;
      } else if (val.startsWith("[") && val.endsWith("]")) {
        fields[currentKey] = val
          .slice(1, -1)
          .split(",")
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
        currentKey = "";
      } else {
        fields[currentKey] = val.replace(/^['"]|['"]$/g, "");
        currentKey = "";
      }
    } else {
      flush();
    }
  }
  flush();

  return { fields, body: content.slice(match[0].length) };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "post";
}

function noteStem(notePath: string): string {
  const name = notePath.split("/").pop() ?? "note.md";
  return name.replace(/\.md$/i, "");
}

function fieldString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function fieldList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractTitle(fields: Record<string, string | string[]>, body: string, notePath: string): string {
  const fromYaml = fieldString(fields.title).trim();
  if (fromYaml) return fromYaml;

  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return h1[1].trim();

  return noteStem(notePath);
}

function extractDate(fields: Record<string, string | string[]>, override?: string): string {
  if (override) return override.slice(0, 10);
  for (const key of ["date", "created", "updated"]) {
    const raw = fieldString(fields[key]).trim();
    if (!raw) continue;
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractCategories(
  fields: Record<string, string | string[]>,
  defaults: string[],
): string[] {
  const fromTags = fieldList(fields.tags);
  if (fromTags.length) return fromTags;
  const fromCategories = fieldList(fields.categories);
  if (fromCategories.length) return fromCategories;
  return defaults.length ? defaults : ["Technical"];
}

function postSlugForNote(note: NoteMetadata): string {
  return slugify(note.name.replace(/\.md$/i, ""));
}

function wikilinkToUrl(
  raw: string,
  siteUrl: string,
  noteIndex: NoteMetadata[],
  vaultPath: string,
): { label: string; href: string } {
  const pipe = raw.indexOf("|");
  const target = normalizeWikilinkTarget(pipe >= 0 ? raw.slice(0, pipe) : raw);
  const label = pipe >= 0 ? raw.slice(pipe + 1).trim() : target;

  const note = findNoteByWikilinkName(target, noteIndex, vaultPath);
  const slug = note ? postSlugForNote(note) : slugify(target);
  const base = siteUrl.replace(/\/$/, "");
  return { label, href: `${base}/posts/${slug}/` };
}

function stripMetisSyntax(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "&nbsp;") {
      i++;
      continue;
    }

    if (STICKY_OPEN_RE.test(line) || STICKY_WRAP_OPEN_RE.test(line)) {
      i++;
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        out.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      continue;
    }

    out.push(line);
    i++;
  }

  return out.join("\n");
}

function stripDuplicateTitle(body: string, title: string): string {
  const trimmed = body.trimStart();
  const match = trimmed.match(/^#\s+(.+)(?:\r?\n|$)/);
  if (!match) return body;
  if (match[1].trim().toLowerCase() !== title.trim().toLowerCase()) return body;
  return trimmed.slice(match[0].length).trimStart();
}

function buildImageMap(
  body: string,
  options: JekyllConvertOptions,
): { rewrittenBody: string; imageCopies: JekyllImageCopy[]; heroImagePath: string | null } {
  const fileDir = options.notePath.substring(0, options.notePath.lastIndexOf("/"));
  const imageCopies: JekyllImageCopy[] = [];
  const seenSources = new Map<string, JekyllImageCopy>();
  let heroImagePath: string | null = null;

  const registerImage = (sourceAbsPath: string, fileName: string): string => {
    const normalized = normalizePosixPath(sourceAbsPath);
    const existing = seenSources.get(normalized);
    if (existing) return existing.blogPath;

    const sub = options.imageSubfolder.replace(/^\/+|\/+$/g, "");
    const blogPath = `/assets/img/${sub}/${fileName}`;
    const entry: JekyllImageCopy = {
      sourceAbsPath: normalized,
      destFileName: fileName,
      blogPath,
    };
    seenSources.set(normalized, entry);
    imageCopies.push(entry);
    if (!heroImagePath) heroImagePath = blogPath;
    return blogPath;
  };

  let rewritten = body;

  rewritten = rewritten.replace(WIKI_IMAGE_RE, (_full, raw: string) => {
    const name = raw.trim();
    const abs = resolveWikilinkAssetPath(name, options.assetIndex, options.vaultPath);
    const fileName = name.split("/").pop() ?? name;
    const blogPath = registerImage(abs, fileName);
    const alt = fileName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    return `![${alt}](${blogPath})`;
  });

  rewritten = rewritten.replace(MD_IMAGE_RE, (full, alt: string, src: string) => {
    const trimmed = src.trim();
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/assets/")) {
      if (!heroImagePath && trimmed.startsWith("/assets/")) heroImagePath = trimmed;
      return full;
    }
    const abs = resolveMarkdownImageAbsPath(trimmed, options.vaultPath, fileDir, options.assetIndex);
    if (!abs) return full;
    const fileName = trimmed.split("/").pop() ?? trimmed;
    const blogPath = registerImage(abs, fileName);
    return `![${alt || fileName.replace(/\.[^.]+$/, "")}](${blogPath})`;
  });

  return { rewrittenBody: rewritten, imageCopies, heroImagePath };
}

function convertWikilinks(body: string, options: JekyllConvertOptions): string {
  return body.replace(WIKI_LINK_RE, (_full, raw: string) => {
    const { label, href } = wikilinkToUrl(raw, options.siteUrl, options.noteIndex, options.vaultPath);
    return `[${label}](${href})`;
  });
}

function serializeChirpyFrontmatter(args: {
  title: string;
  author: string;
  date: string;
  categories: string[];
  description: string;
  heroImagePath: string | null;
}): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${args.title}`);
  lines.push(`author: ${args.author}`);
  lines.push(`date: ${args.date} 12:00:00 +0200`);
  lines.push(
    `categories: [${args.categories.map((c) => (c.includes(" ") ? `"${c}"` : c)).join(", ")}]`,
  );
  lines.push(`description: ${args.description}`);
  if (args.heroImagePath) {
    lines.push("image:");
    lines.push(`  path: ${args.heroImagePath}`);
    lines.push("  width: 800");
    lines.push("  height: 500");
  }
  lines.push("---");
  return lines.join("\n");
}

export function convertNoteToJekyll(
  rawContent: string,
  options: JekyllConvertOptions,
): JekyllConvertResult {
  const { fields, body: rawBody } = parseFrontmatter(rawContent);

  const title = options.title?.trim() || extractTitle(fields, rawBody, options.notePath);
  const slug = options.slug?.trim() || slugify(noteStem(options.notePath));
  const date = extractDate(fields, options.date);
  const categories = options.categories.length
    ? options.categories
    : extractCategories(fields, ["Technical"]);

  let body = rawBody;
  body = stripMetisSyntax(body);
  body = stripDuplicateTitle(body, title);
  body = convertWikilinks(body, options);

  const { rewrittenBody, imageCopies, heroImagePath } = buildImageMap(body, options);
  body = rewrittenBody.trim();

  const frontmatter = serializeChirpyFrontmatter({
    title,
    author: options.author,
    date,
    categories,
    description: options.description,
    heroImagePath,
  });

  const filename = `${date}-${slug}.markdown`;
  const content = `${frontmatter}\n\n${body}\n`;

  return {
    filename,
    content,
    title,
    slug,
    date,
    imageCopies,
    heroImagePath,
  };
}

/** Collect vault image paths referenced in the note (for validation). */
export function listVaultImagesInNote(
  content: string,
  notePath: string,
  vaultPath: string,
  assetIndex: AssetMetadata[],
): string[] {
  return collectImagePathsFromMarkdown(content, notePath, vaultPath, assetIndex);
}
