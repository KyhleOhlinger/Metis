import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { pathsEqual } from "../utils/paths";

/**
 * UI components should subscribe with **selectors** or `useShallow` from `zustand/react/shallow`
 * when reading multiple fields — avoid `useStore()` with no arguments (re-renders on *any* slice change).
 * Use `useStore.getState()` inside callbacks/effects when a subscription is not needed.
 */

export interface FileNode {
  name: string;
  /** Absolute path on the local filesystem */
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface VaultData {
  path: string;
  files: FileNode[];
  is_metis_vault: boolean;
  vault_hint?: string; // "obsidian" | "markdown" — only present for non-Metis vaults
  /** Vault-relative folder for pasted/saved images (default `assets`). */
  default_image_dir?: string;
}

/**
 * Lightweight metadata for a single note, cached in memory.
 * Avoids re-scanning the vault on every `[[` keystroke.
 * Fields beyond name/path are populated lazily: on vault open (enrichNoteIndex)
 * and whenever a note is opened in the editor (setActiveFile).
 */
export interface NoteMetadata {
  /** Display name — filename stem without the .md extension */
  name: string;
  /** Absolute path on disk */
  path: string;
  /** YAML `aliases:` list — searched by wikilink autocomplete */
  aliases?: string[];
  /** YAML `status:` field — e.g. draft | in-progress | review | done */
  status?: string;
  /** YAML `date:` field — ISO date string (YYYY-MM-DD) */
  date?: string;
  /** YAML `parent:` field — canonical name of the parent note */
  parent?: string;
  /** YAML `related:` list — names of related notes */
  related?: string[];
}

/**
 * Lightweight metadata for a non-markdown vault asset (image, PDF, etc.).
 * Used for Obsidian-compatible ![[image.png]] wikilink resolution:
 * Obsidian searches the entire vault by filename, not just the vault root.
 */
export interface AssetMetadata {
  /** Filename with extension, e.g. "photo.jpg" */
  name: string;
  /** Absolute path on disk */
  path: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract well-known frontmatter fields from note content for the metadata
 * index.  Handles both inline lists (`[a, b]`) and YAML block lists (`- item`).
 * Strips surrounding quotes and [[wikilink]] brackets from values.
 */
function parseNoteMeta(content: string): Pick<NoteMetadata, "aliases" | "status" | "date" | "parent" | "related"> {
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
    const kvMatch   = line.match(/^([\w][\w-]*):\s*(.*)/);

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
  if (typeof raw.date   === "string" && raw.date)   out.date   = raw.date;
  if (typeof raw.parent === "string" && raw.parent) out.parent = raw.parent;
  if (Array.isArray(raw.aliases)  && raw.aliases.length)  out.aliases  = raw.aliases  as string[];
  if (Array.isArray(raw.related)  && raw.related.length)  out.related  = raw.related  as string[];
  return out;
}

/**
 * Merge freshly-parsed metadata into an existing NoteMetadata entry.
 * Explicitly clears smart fields that are absent from the new parse result so
 * that removing a field (e.g. clearing status) is immediately reflected rather
 * than leaving a stale value from the previous spread.
 */
function applyMeta(existing: NoteMetadata, fresh: ReturnType<typeof parseNoteMeta>): NoteMetadata {
  return {
    ...existing,
    // Reset every smart field to undefined first, then overlay the fresh values.
    status:  undefined,
    date:    undefined,
    aliases: undefined,
    parent:  undefined,
    related: undefined,
    ...fresh,
  };
}

/** Recursively collect every .md file in the file tree into a flat list. */
function flattenNotes(nodes: FileNode[]): NoteMetadata[] {
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

/**
 * Recursively collect every non-directory, non-.md file (images, PDFs, etc.)
 * into a flat asset index.  This mirrors Obsidian's vault-wide attachment
 * resolution: `![[image.png]]` finds the file anywhere in the vault.
 */
function flattenAssets(nodes: FileNode[]): AssetMetadata[] {
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

/** One file written on disk by AI tasks or batch sync operations. */
export type DiskWrite = { path: string; content?: string };

/** Pending scroll/selection target for search results and similar deep links. */
export type EditorNavigateTarget = {
  path: string;
  offset: number;
  matchEnd?: number;
};

/**
 * Refresh the vault tree and push new content into the open editor / visual
 * preview when a written file is currently active. Optionally open a different
 * path (e.g. agent-created note) without requiring a manual sidebar click.
 */
export async function syncUiAfterDiskWrites(
  writes: DiskWrite[],
  options?: { openPath?: string },
): Promise<void> {
  const { activeFilePath, setActiveFile, refreshVault } = useStore.getState();
  await refreshVault();

  const openPath = options?.openPath;
  if (openPath) {
    const match = writes.find((w) => pathsEqual(w.path, openPath));
    const content =
      match?.content ??
      (await invoke<string>("get_file_content", { path: openPath }));
    setActiveFile(openPath, content);
    return;
  }

  if (!activeFilePath) return;
  const activeWrite = writes.find((w) => pathsEqual(w.path, activeFilePath));
  if (!activeWrite) return;

  const content =
    activeWrite.content ??
    (await invoke<string>("get_file_content", { path: activeFilePath }));
  setActiveFile(activeFilePath, content);
}

// ── State interface ───────────────────────────────────────────────────────────

interface MetisState {
  // Vault
  vaultPath: string | null;
  /** True when a `.metis/vault.json` marker is present — false for foreign vaults. */
  isMetisVault: boolean;
  files: FileNode[];

  // Editor
  activeFilePath: string | null;
  activeFileContent: string;
  isDirty: boolean;
  /**
   * Character offset of the cursor (CodeMirror `selection.main.head`) in the
   * active document.  Updated on every cursor move so the AI agent can insert
   * content at the correct position.  0 when no file is open.
   */
  cursorOffset: number;
  /** Currently selected text in the editor (empty string when nothing is selected). */
  selectedText: string;
  /**
   * Viewport-relative coordinates for the start of the selection, used to
   * position the floating AI toolbar above the highlighted text.
   * Null when nothing is selected.
   */
  selectionCoords: { top: number; left: number } | null;
  /**
   * Character offset of the END of the current selection (`selection.main.to`).
   * Used by "insert after selection" actions so content always lands below the
   * highlighted block regardless of which direction the user dragged.
   */
  selectionEndOffset: number;

  /** The folder whose context is currently "selected" in the sidebar. */
  activeFolderPath: string | null;

  /**
   * MetadataCache — flat index of every note in the vault.
   * Rebuilt whenever the file tree changes; read directly by extensions
   * via `useStore.getState().noteIndex` so no React re-render is needed.
   */
  noteIndex: NoteMetadata[];

  /**
   * Flat index of every non-markdown asset (images, PDFs, etc.) in the vault.
   * Enables Obsidian-compatible ![[image.png]] resolution: the wikilink name
   * is matched against this list so files are found regardless of where in the
   * vault they are stored.
   */
  assetIndex: AssetMetadata[];

  /** Vault-relative default folder for pasted/saved images. */
  defaultImageFolder: string;

  // UI state shared between menu events and components
  /** Which editor tab is active.  Lifted here so the native menu can switch it. */
  editorTab: "source" | "visual" | "planner";
  /**
   * A pending action dispatched by the native menu bar.
   * Components watch this via useEffect, execute the action, then clear it by
   * calling setPendingMenuAction(null).
   */
  pendingMenuAction: string | null;

  /** Which sidebar view is active: file tree or vault-wide search. */
  sidebarView: "files" | "search";

  /** Consumed by Editor to scroll/select after opening a file from search, etc. */
  editorNavigateTo: EditorNavigateTarget | null;

  // Actions
  setEditorTab: (tab: "source" | "visual" | "planner") => void;
  setPendingMenuAction: (action: string | null) => void;
  setSidebarView: (view: "files" | "search") => void;
  setVault: (data: VaultData) => void;
  /** Mark the current vault as a Metis vault (called after successful conversion). */
  setIsMetisVault: (v: boolean) => void;
  /** Re-fetch the file tree from disk (call after any mutating operation). */
  refreshVault: () => Promise<void>;
  /**
   * Batch-read every note in the vault and populate enriched metadata fields
   * (status, date, aliases, parent, related).  Called once on vault open;
   * individual notes are also updated lazily when opened via setActiveFile.
   */
  enrichNoteIndex: () => Promise<void>;
  setActiveFile: (path: string, content: string) => void;
  setActiveFileContent: (content: string) => void;
  setCursorOffset: (offset: number) => void;
  setSelection: (text: string, coords: { top: number; left: number } | null, endOffset: number) => void;
  clearSelection: () => void;
  setActiveFolderPath: (path: string | null) => void;
  markSaved: () => void;
  clearVault: () => void;
  /** Persist vault-relative default image folder (e.g. `assets`). */
  setDefaultImageFolder: (relativeDir: string) => Promise<void>;
  navigateEditorTo: (target: EditorNavigateTarget) => void;
  clearEditorNavigateTo: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useStore = create<MetisState>((set, get) => ({
  vaultPath: null,
  isMetisVault: false,
  files: [],
  activeFilePath: null,
  activeFileContent: "",
  isDirty: false,
  cursorOffset: 0,
  selectedText: "",
  selectionCoords: null,
  selectionEndOffset: 0,
  activeFolderPath: null,
  noteIndex: [],
  assetIndex: [],
  defaultImageFolder: "assets",
  editorTab: "source",
  pendingMenuAction: null,
  sidebarView: "files",
  editorNavigateTo: null,

  setEditorTab: (tab) => set({ editorTab: tab }),

  setPendingMenuAction: (action) => set({ pendingMenuAction: action }),

  setSidebarView: (view) => set({ sidebarView: view }),

  setVault: (data) => {
    const noteIndex  = flattenNotes(data.files);
    const assetIndex = flattenAssets(data.files);
    // Clear the active editor when switching vaults so stale content from the
    // previous vault is never shown inside a different vault's context.
    set({
      vaultPath: data.path,
      isMetisVault: data.is_metis_vault,
      files: data.files,
      defaultImageFolder: data.default_image_dir ?? "assets",
      noteIndex,
      assetIndex,
      activeFilePath: null,
      activeFileContent: "",
      isDirty: false,
      cursorOffset: 0,
      selectedText: "",
      selectionCoords: null,
      selectionEndOffset: 0,
      activeFolderPath: null,
      editorNavigateTo: null,
    });
    // Enrich metadata in the background so the store is never blocked.
    setTimeout(() => get().enrichNoteIndex(), 0);
  },

  setIsMetisVault: (v) => set({ isMetisVault: v }),

  refreshVault: async () => {
    const { vaultPath, noteIndex: prevIndex } = get();
    if (!vaultPath) return;
    try {
      const data = await invoke<VaultData>("open_vault", { path: vaultPath });
      const freshIndex = flattenNotes(data.files);
      // Preserve previously enriched fields (status, aliases, etc.) by
      // merging the cached entry for each path into the fresh skeleton.
      const prevMap = new Map(prevIndex.map((n) => [n.path, n]));
      const merged  = freshIndex.map((n) => {
        const prev = prevMap.get(n.path);
        return prev ? { ...prev, name: n.name, path: n.path } : n;
      });
      set({
        files: data.files,
        isMetisVault: data.is_metis_vault,
        defaultImageFolder: data.default_image_dir ?? "assets",
        noteIndex: merged,
        assetIndex: flattenAssets(data.files),
      });
    } catch (err) {
      console.error("Failed to refresh vault:", err);
    }
  },

  enrichNoteIndex: async () => {
    const { noteIndex, vaultPath } = get();
    if (!noteIndex.length || !vaultPath) return;
    const runVaultPath = vaultPath;
    /** One `get_file_contents_batch` IPC per slice (max 100 paths); falls back to per-file reads if the command fails. */
    const BATCH = 100;
    const updatedByPath = new Map(noteIndex.map((n) => [n.path, n]));
    for (let i = 0; i < noteIndex.length; i += BATCH) {
      // Abort stale enrichment runs after a vault switch.
      if (get().vaultPath !== runVaultPath) return;
      const slice = noteIndex.slice(i, i + BATCH);
      const paths = slice.map((n) => n.path);

      let contents: string[];
      try {
        const batch = await invoke<string[]>("get_file_contents_batch", { paths });
        contents =
          Array.isArray(batch) && batch.length === paths.length
            ? batch
            : await Promise.all(paths.map((path) => invoke<string>("get_file_content", { path }).catch(() => "")));
      } catch {
        contents = await Promise.all(paths.map((path) => invoke<string>("get_file_content", { path }).catch(() => "")));
      }

      contents.forEach((content, j) => {
        const path = slice[j].path;
        const existing = updatedByPath.get(path);
        if (!existing) return;
        updatedByPath.set(path, applyMeta(existing, parseNoteMeta(content)));
      });
    }
    set((s) => {
      if (s.vaultPath !== runVaultPath) return s;
      return {
        noteIndex: s.noteIndex.map((n) => updatedByPath.get(n.path) ?? n),
      };
    });
  },

  setActiveFile: (path, content) => {
    // Lazily enrich this note's index entry so status/date/aliases are current.
    const meta = parseNoteMeta(content);
    set((s) => ({
      activeFilePath: path,
      activeFileContent: content,
      isDirty: false,
      // If the planner is visible and the user opens a note, return to source mode.
      editorTab: s.editorTab === "planner" ? "source" : s.editorTab,
      noteIndex: s.noteIndex.map((n) =>
        n.path === path ? applyMeta(n, meta) : n,
      ),
    }));
  },

  setActiveFileContent: (content) => {
    // Re-parse frontmatter so noteIndex (and sidebar status colours) reflect the
    // latest content immediately — not just after the next enrichNoteIndex pass.
    const path = get().activeFilePath;
    const meta = path ? parseNoteMeta(content) : null;
    set((s) => ({
      activeFileContent: content,
      isDirty: true,
      noteIndex: meta && path
        ? s.noteIndex.map((n) => (n.path === path ? applyMeta(n, meta) : n))
        : s.noteIndex,
    }));
  },

  setCursorOffset: (offset) => set({ cursorOffset: offset }),

  setSelection: (text, coords, endOffset) =>
    set({ selectedText: text, selectionCoords: coords, selectionEndOffset: endOffset }),
  clearSelection: () => set({ selectedText: "", selectionCoords: null, selectionEndOffset: 0 }),

  setActiveFolderPath: (path) => set({ activeFolderPath: path }),

  markSaved: () => set({ isDirty: false }),

  setDefaultImageFolder: async (relativeDir) => {
    const { vaultPath } = get();
    if (!vaultPath) return;
    const saved = await invoke<string>("set_vault_default_image_dir", {
      vaultPath,
      relativeDir,
    });
    set({ defaultImageFolder: saved });
  },

  navigateEditorTo: (target) =>
    set({ editorNavigateTo: target, editorTab: "source" }),

  clearEditorNavigateTo: () => set({ editorNavigateTo: null }),

  clearVault: () =>
    set({
      vaultPath: null,
      isMetisVault: false,
      files: [],
      defaultImageFolder: "assets",
      activeFilePath: null,
      activeFileContent: "",
      isDirty: false,
      cursorOffset: 0,
      selectedText: "",
      selectionCoords: null,
      selectionEndOffset: 0,
      activeFolderPath: null,
      noteIndex: [],
      assetIndex: [],
      pendingMenuAction: null,
      sidebarView: "files",
      editorNavigateTo: null,
    }),
}));
