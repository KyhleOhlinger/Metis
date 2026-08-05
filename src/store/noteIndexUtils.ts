import type { AssetMetadata, FileNode, NoteMetadata } from "./useStore";

/**
 * Extract well-known frontmatter fields from note content for the metadata
 * index.  Handles both inline lists (`[a, b]`) and YAML block lists (`- item`).
 * Strips surrounding quotes and [[wikilink]] brackets from values.
 */
export function parseNoteMeta(
  content: string,
): Pick<NoteMetadata, "aliases" | "status" | "date" | "parent" | "related"> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};

  const yaml = match[1];
  const raw: Record<string, string | string[]> = {};
  let currentKey = "";
  let currentItems: string[] = [];
  let inList = false;

  const flush = () => {
    if (currentKey && inList) raw[currentKey] = currentItems;
    currentKey = "";
    currentItems = [];
    inList = false;
  };

  const clean = (s: string) =>
    s.trim().replace(/^['"]|['"]$/g, "").replace(/^\[\[|\]\]$/g, "").trim();

  for (const line of yaml.split(/\r?\n/)) {
    const listMatch = line.match(/^\s+-\s+(.*)/);
    const kvMatch = line.match(/^([\w][\w-]*):\s*(.*)/);

    if (listMatch && inList) {
      currentItems.push(clean(listMatch[1]));
    } else if (kvMatch) {
      flush();
      const [, key, rawVal] = kvMatch;
      const val = rawVal.trim();
      currentKey = key;
      if (val === "" || val === "[]") {
        inList = true;
      } else if (val.startsWith("[") && val.endsWith("]")) {
        raw[key] = val.slice(1, -1).split(",").map(clean).filter(Boolean);
        currentKey = "";
      } else {
        raw[key] = clean(val);
        currentKey = "";
      }
    } else {
      flush();
    }
  }
  flush();

  const out: ReturnType<typeof parseNoteMeta> = {};
  if (typeof raw.status === "string" && raw.status) out.status = raw.status;
  if (typeof raw.date === "string" && raw.date) out.date = raw.date;
  if (typeof raw.parent === "string" && raw.parent) out.parent = raw.parent;
  if (Array.isArray(raw.aliases) && raw.aliases.length) out.aliases = raw.aliases as string[];
  if (Array.isArray(raw.related) && raw.related.length) out.related = raw.related as string[];
  return out;
}

/** Merge freshly-parsed metadata into an existing note index entry. */
export function applyNoteMeta(
  existing: NoteMetadata,
  fresh: ReturnType<typeof parseNoteMeta>,
): NoteMetadata {
  return {
    ...existing,
    status: undefined,
    date: undefined,
    aliases: undefined,
    parent: undefined,
    related: undefined,
    ...fresh,
  };
}

/** Recursively collect every .md file in the file tree into a flat list. */
export function flattenNotes(nodes: FileNode[]): NoteMetadata[] {
  const result: NoteMetadata[] = [];
  function walk(ns: FileNode[]) {
    for (const n of ns) {
      if (!n.is_dir && n.name.endsWith(".md")) {
        result.push({ name: n.name.replace(/\.md$/, ""), path: n.path });
      }
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

/** Recursively collect non-.md vault assets for wikilink image resolution. */
export function flattenAssets(nodes: FileNode[]): AssetMetadata[] {
  const result: AssetMetadata[] = [];
  function walk(ns: FileNode[]) {
    for (const n of ns) {
      if (!n.is_dir && !n.name.endsWith(".md")) {
        result.push({ name: n.name, path: n.path });
      }
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return result;
}
