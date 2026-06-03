import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import { useStore, syncUiAfterDiskWrites, type DiskWrite } from "../store/useStore";
import {
  usePersonaStore,
  selectActivePersona,
  selectProfileApiKey,
  selectProfileForPersona,
} from "../store/usePersonaStore";
import {
  streamResponse,
  testProviderConnection,
  AGENT_FILE_TOOLS,
  type ParsedToolCall,
} from "../services/aiService";
import ModelPicker from "./ModelPicker";
import { buildSmartContext, strategyLabel } from "../services/contextBuilder";
import PersonaCreator from "./PersonaCreator";
import QuickActionsSettings from "./QuickActionsSettings";
import {
  type AiProviderProfile,
  type Persona,
  type ExecutionScope,
  type HistoryEntry,
  ICON_PRESETS,
  LIBRARIAN_PERSONA_ID,
  TASK_PERSONA_ID,
  HANDWRITING_OCR_PERSONA_ID,
} from "../types/persona";
import { transcribeHandwritingImage } from "../services/ocrService";
import {
  buildHandwritingNoteMarkdown,
  collectHandwritingImages,
  mimeTypeForImagePath,
} from "../utils/handwriting";
import {
  makeProviderProfileId,
  profileForPersona,
  inferAdapter,
  findProviderProfile,
} from "../utils/providerProfiles";
import { curatedSmallModelId } from "../services/aiService";
import type { ContextStrategy } from "../services/contextBuilder";
import { listVaultFolderOptions } from "../utils/noteImages";
import { sanitizeAgentNoteRelativePath } from "../utils/paths";

const metisIconUrl = new URL("../../metis_icon.png", import.meta.url).href;

interface Props {
  isOpen: boolean;
  onToggle: () => void;
}

// ── Collapsed strip ───────────────────────────────────────────────────────────

function CollapsedStrip({ onToggle }: { onToggle: () => void }) {
  return (
    <aside className="flex h-full w-8 flex-col items-center bg-surface-raised pt-2">
      <button
        onClick={onToggle}
        title="Open Command Center"
        className="rounded p-1 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
      >
        <ChevronLeft />
      </button>
    </aside>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CommandCenter({ isOpen, onToggle }: Props) {
  const { activeFilePath, activeFileContent, isDirty, vaultPath, files } = useStore(
    useShallow((s) => ({
      activeFilePath: s.activeFilePath,
      activeFileContent: s.activeFileContent,
      isDirty: s.isDirty,
      vaultPath: s.vaultPath,
      files: s.files,
    })),
  );
  const loadFromDisk = usePersonaStore((s) => s.loadFromDisk);
  const activePersona = usePersonaStore(selectActivePersona);
  const personaSlice = usePersonaStore(
    useShallow((s) => ({
      personas: s.personas,
      activePersonaId: s.activePersonaId,
      settings: s.settings,
      history: s.history,
      setActivePersona: s.setActivePersona,
      addHistory: s.addHistory,
      clearHistory: s.clearHistory,
      upsertProviderProfile: s.upsertProviderProfile,
      removeProviderProfile: s.removeProviderProfile,
      setDefaultProviderProfileId: s.setDefaultProviderProfileId,
      updateSettings: s.updateSettings,
    })),
  );

  const [tab, setTab] = useState<"info" | "ai" | "settings">("info");
  const [showNewPersonaModal, setShowNewPersonaModal] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = document.querySelector("[data-cc-scroll-region]");
      if (el instanceof HTMLElement) {
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [tab]);

  // Load personas + settings from disk on first mount
  useEffect(() => {
    loadFromDisk();
  }, [loadFromDisk]);

  // Consume a scope request dispatched from the Sidebar context menu
  const pendingScope = usePersonaStore((s) => s.pendingScope);
  const setPendingScope = usePersonaStore((s) => s.setPendingScope);
  useEffect(() => {
    if (!pendingScope) return;
    // Open the panel and navigate to the AI tab — the AITab picks up the scope
    setTab("ai");
    if (!isOpen) onToggle();
    setPendingScope(null);
  }, [pendingScope, isOpen, onToggle, setPendingScope]);

  // Ensure the panel is visible whenever a selection quick-action is triggered.
  // AITab may not be mounted when the panel is collapsed or on a different tab,
  // so we open + switch here.  Clearing selectionQuery and running the agent
  // are both handled inside AITab's own effect once it mounts.
  const selectionQuery = usePersonaStore((s) => s.selectionQuery);
  useEffect(() => {
    if (!selectionQuery) return;
    setTab("ai");
    if (!isOpen) onToggle();
  }, [selectionQuery, isOpen, onToggle]);

  const { wordCount, lineCount, charCount } = useMemo(() => ({
    wordCount: activeFileContent.split(/\s+/).filter(Boolean).length,
    lineCount: activeFileContent.split("\n").length,
    charCount: activeFileContent.length,
  }), [activeFileContent]);

  if (!isOpen) return <CollapsedStrip onToggle={onToggle} />;

  return (
    <>
      <aside className="flex h-full flex-col bg-surface-raised">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-border pl-3 pr-1.5 py-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-text-muted">
            Command Center
          </span>
          <button
            onClick={onToggle}
            title="Collapse panel"
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
          >
            <ChevronRight />
          </button>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────── */}
        <div className="flex border-b border-border">
          {(["info", "ai", "settings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "flex-1 py-1.5 text-xs font-medium transition-colors",
                tab === t
                  ? "border-b-2 border-accent text-text-primary"
                  : "text-text-muted hover:text-text-secondary",
              ].join(" ")}
            >
              {t === "info" ? "Info" : t === "ai" ? "AI ✦" : <span className="text-base leading-none">⚙</span>}
            </button>
          ))}
        </div>

        {/* ── Panels ─────────────────────────────────────────────── */}
        {/* flex flex-col so that tab roots using flex-1 get a real flex parent
            and overflow-y-auto can create a properly bounded scroll region.
            min-h-0 prevents the default min-height:auto from blocking shrink. */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {tab === "info" && (
            <InfoTab
              vaultPath={vaultPath}
              files={files}
              activeFilePath={activeFilePath}
              isDirty={isDirty}
              wordCount={wordCount}
              lineCount={lineCount}
              charCount={charCount}
            />
          )}
          {tab === "ai" && (
            <AITab
              activePersona={activePersona}
              personas={personaSlice.personas}
              activePersonaId={personaSlice.activePersonaId}
              settings={personaSlice.settings}
              history={personaSlice.history}
              activeFileContent={activeFileContent}
              activeFilePath={activeFilePath}
              vaultPath={vaultPath}
              files={files}
              initialScope={pendingScope ?? undefined}
              onSelectPersona={personaSlice.setActivePersona}
              onAddHistory={personaSlice.addHistory}
              onClearHistory={personaSlice.clearHistory}
              onNewPersona={() => setShowNewPersonaModal(true)}
              onOpenSettings={() => setTab("settings")}
            />
          )}
          {tab === "settings" && (
            <SettingsTab
              settings={personaSlice.settings}
              upsertProviderProfile={personaSlice.upsertProviderProfile}
              removeProviderProfile={personaSlice.removeProviderProfile}
              setDefaultProviderProfileId={personaSlice.setDefaultProviderProfileId}
              onUpdateSettings={personaSlice.updateSettings}
            />
          )}
        </div>
      </aside>

      {showNewPersonaModal && (
        <PersonaCreator
          onClose={() => setShowNewPersonaModal(false)}
        />
      )}
    </>
  );
}

// ── Info tab ──────────────────────────────────────────────────────────────────

function InfoTab({
  vaultPath,
  files,
  activeFilePath,
  isDirty,
  wordCount,
  lineCount,
  charCount,
}: {
  vaultPath: string | null;
  files: import("../store/useStore").FileNode[];
  activeFilePath: string | null;
  isDirty: boolean;
  wordCount: number;
  lineCount: number;
  charCount: number;
}) {
  const { defaultImageFolder, setDefaultImageFolder } = useStore(
    useShallow((s) => ({
      defaultImageFolder: s.defaultImageFolder,
      setDefaultImageFolder: s.setDefaultImageFolder,
    })),
  );
  const [plannerStorageDir, setPlannerStorageDir] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("get_planner_storage_dir")
      .then(setPlannerStorageDir)
      .catch(() => setPlannerStorageDir(null));
  }, []);

  const imageFolderOptions = useMemo(() => {
    if (!vaultPath) return [];
    const base = listVaultFolderOptions(files, vaultPath);
    if (defaultImageFolder && !base.some((o) => o.relativePath === defaultImageFolder)) {
      return [{ relativePath: defaultImageFolder, label: defaultImageFolder }, ...base];
    }
    return base;
  }, [files, vaultPath, defaultImageFolder]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Scrollable metadata — content-sized; remaining height centers the icon below */}
      <div className="min-h-0 shrink overflow-y-auto p-3 space-y-3" data-cc-scroll-region>
        <Section title="Vault">
          <KV label="Path" value={vaultPath ?? "—"} mono />
          {vaultPath && (
            <div className="mt-2">
              <label className="block text-[10px] text-text-muted">Default image folder</label>
              <select
                value={defaultImageFolder}
                onChange={async (e) => {
                  try {
                    await setDefaultImageFolder(e.target.value);
                  } catch (err) {
                    alert(String(err));
                  }
                }}
                className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-primary"
              >
                {imageFolderOptions.map((opt) => (
                  <option key={opt.relativePath} value={opt.relativePath}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[9px] text-text-muted">
                Pasted images save here. Default is <code className="text-[9px]">assets</code> until
                you choose a folder (sidebar right-click or this dropdown).
              </p>
            </div>
          )}
        </Section>
        <Section title="Planner">
          <KV label="Path" value={plannerStorageDir ?? "—"} mono />
        </Section>
        <Section title="Active Note">
          <KV label="File" value={activeFilePath ? (activeFilePath.split("/").pop() ?? "—") : "—"} mono />
          <KV
            label="Status"
            value={!activeFilePath ? "No file open" : isDirty ? "Unsaved changes" : "Saved"}
            highlight={isDirty}
          />
        </Section>
        {activeFilePath && (
          <Section title="Stats">
            <KV label="Words" value={String(wordCount)} />
            <KV label="Lines" value={String(lineCount)} />
            <KV label="Chars" value={String(charCount)} />
          </Section>
        )}

        {/* About */}
        <div className="border-t border-border pt-3 mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2">
            About
          </p>
          <div>
            <p className="text-[11px] font-semibold text-text-primary">Metis</p>
            <p className="text-[10px] text-text-muted mt-0.5">
              A local-first, AI-augmented personal knowledge ecosystem.
            </p>
          </div>
        </div>
      </div>

      {/* Icon floats centered in the remaining panel space */}
      <div className="flex flex-1 min-h-[96px] items-center justify-center px-3 py-4">
        <img
          src={metisIconUrl}
          alt=""
          className="aspect-square w-4/5 max-w-[168px] rounded-2xl border border-border object-cover shadow-md shadow-black/20"
        />
      </div>

      {/* Copyright — pinned to bottom-right, outside the scroll area */}
      <div className="shrink-0 border-t border-border px-3 py-2 flex justify-end">
        <p className="text-[10px] text-text-muted/50 select-none">
          © 2026 Kyhle Öhlinger — MIT License
        </p>
      </div>
    </div>
  );
}

// ── AI tab ────────────────────────────────────────────────────────────────────

interface AITabProps {
  onOpenSettings: () => void;
  activePersona: Persona | undefined;
  personas: Persona[];
  activePersonaId: string | null;
  settings: ReturnType<typeof usePersonaStore.getState>["settings"];
  history: HistoryEntry[];
  activeFileContent: string;
  activeFilePath: string | null;
  vaultPath: string | null;
  files: import("../store/useStore").FileNode[];
  initialScope?: ExecutionScope;
  onSelectPersona: (id: string) => void;
  onAddHistory: (entry: HistoryEntry) => void;
  onClearHistory: () => void;
  onNewPersona: () => void;
}

// ── Pending write types (agent-initiated file operations) ─────────────────────

type PendingWriteStatus = "pending" | "applying" | "done" | "error";

type PendingWriteTool =
  | "write_to_current_file"
  | "append_to_current_file"
  | "prepend_to_current_file"
  | "insert_at_cursor"
  | "create_new_note";

interface PendingWrite {
  /** Unique ID matching the tool_call id from the provider */
  id: string;
  tool: PendingWriteTool;
  /**
   * For write/append/prepend/insert tools: absolute path of the active file.
   * For create_new_note: vault-relative path.
   */
  path: string;
  /** For append/prepend/insert: the chunk to add.  For write/create: the full content. */
  content: string;
  /**
   * Character offset where insert_at_cursor should place the content.
   * Captured at run-time so the insertion point is stable even if the user
   * moves their cursor before clicking Apply.
   */
  cursorOffset?: number;
  status: PendingWriteStatus;
  errorMsg?: string;
}

// ── Content merge helpers ─────────────────────────────────────────────────────

/** Regex matching a YAML frontmatter block at the start of a document. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Insert `chunk` after the YAML frontmatter AND the H1 title (if present).
 *
 * Insertion order in the resulting file:
 *   1. YAML frontmatter  (--- … ---)
 *   2. H1 heading        (# Title)   ← kept at the top
 *   3. Inserted chunk                 ← agent content goes here
 *   4. Rest of the original body
 */
function insertAfterFrontmatter(existing: string, chunk: string): string {
  // Strip frontmatter first to get the body
  const fmMatch = existing.match(FRONTMATTER_RE);
  const fmEnd = fmMatch ? fmMatch[0].length : 0;
  const body = existing.slice(fmEnd);

  // Check whether the body starts with an H1 heading (optional leading blank line)
  const h1Match = body.match(/^[ \t]*\n*(# [^\n]*\n?)/);
  if (h1Match) {
    const afterH1 = fmEnd + h1Match[0].length;
    return (
      existing.slice(0, afterH1).trimEnd() +
      "\n\n" + chunk + "\n\n" +
      existing.slice(afterH1).trimStart()
    );
  }

  // No H1 — insert right after frontmatter (or at the very start)
  if (fmEnd > 0) {
    return existing.slice(0, fmEnd).trimEnd() + "\n\n" + chunk + "\n\n" + body.trimStart();
  }
  return chunk + "\n\n" + existing;
}

/** Append `chunk` at the end of the document, separated by a blank line. */
function appendToEnd(existing: string, chunk: string): string {
  return existing.trimEnd() + "\n\n" + chunk;
}

/**
 * Insert `chunk` after the line that contains `offset`.
 * Inserting after the whole line (rather than mid-character) keeps the
 * surrounding prose intact and produces clean, readable markdown.
 */
function insertAtOffset(existing: string, offset: number, chunk: string): string {
  const safeOffset = Math.min(Math.max(0, offset), existing.length);
  // Scan forward to find the end of the current line
  const lineEnd = existing.indexOf("\n", safeOffset);
  const insertPos = lineEnd === -1 ? existing.length : lineEnd;
  return (
    existing.slice(0, insertPos) +
    "\n\n" + chunk.trimEnd() +
    "\n" + existing.slice(insertPos)
  );
}

// ── Librarian: client-side orphan graph analysis ──────────────────────────────
//
// Reads all vault notes in batches via the Rust `get_files_content` command,
// extracts [[wikilinks]] per note, and builds incoming / outgoing link counts.
// The resulting structured report is injected as context for The Librarian LLM.

interface NoteLinks {
  name: string;
  path: string;
  outgoing: string[];
  incoming: string[];
}

async function buildOrphanReport(
  noteIndex: import("../store/useStore").NoteMetadata[],
  onStatus: (msg: string) => void,
): Promise<string> {
  if (noteIndex.length === 0) return "(vault is empty — no notes to analyse)";

  onStatus(`Mapping links across ${noteIndex.length} note${noteIndex.length !== 1 ? "s" : ""}…`);

  // Fetch all note contents in batches (Rust enforces max 100 per call)
  const BATCH = 100;
  const noteContentByName = new Map<string, string>();

  for (let i = 0; i < noteIndex.length; i += BATCH) {
    const batch = noteIndex.slice(i, i + BATCH);
    if (noteIndex.length > BATCH) {
      onStatus(`Reading notes ${i + 1}–${Math.min(i + BATCH, noteIndex.length)} of ${noteIndex.length}…`);
    }
    const combined = await invoke<string>("get_files_content", {
      paths: batch.map((n) => n.path),
    });
    // The Rust command formats each file as "\n\n---\n## {filename}\n\n{content}"
    const separator = "\n\n---\n## ";
    const parts = combined.split(separator);
    for (const part of parts) {
      if (!part.trim()) continue;
      const doubleNl = part.indexOf("\n\n");
      if (doubleNl === -1) continue;
      const filename = part.slice(0, doubleNl).trim(); // "note-name.md"
      const content = part.slice(doubleNl + 2);
      // Use the stem (without .md) as the canonical note name for wikilink matching
      const stem = filename.replace(/\.md$/i, "");
      noteContentByName.set(stem, content);
    }
  }

  onStatus("Analysing link graph…");

  // Build outgoing / incoming maps
  const noteNames = new Set(noteContentByName.keys());
  const WIKILINK_RE = /\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g;

  const outgoingMap = new Map<string, Set<string>>();
  const incomingMap = new Map<string, Set<string>>();
  for (const name of noteNames) {
    outgoingMap.set(name, new Set());
    incomingMap.set(name, new Set());
  }

  for (const [name, content] of noteContentByName) {
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(content)) !== null) {
      const target = m[1].trim();
      // Case-insensitive resolution against known note names
      const resolved = [...noteNames].find(
        (n) => n.toLowerCase() === target.toLowerCase(),
      );
      if (resolved && resolved !== name) {
        outgoingMap.get(name)!.add(resolved);
        incomingMap.get(resolved)!.add(name);
      }
    }
  }

  // Classify notes
  const noteData: NoteLinks[] = [...noteNames].sort().map((name) => ({
    name,
    path: noteIndex.find((n) => n.name === name + ".md" || n.name === name)?.path ?? "",
    outgoing: [...(outgoingMap.get(name) ?? [])],
    incoming: [...(incomingMap.get(name) ?? [])],
  }));

  const orphans = noteData.filter((n) => n.outgoing.length === 0 && n.incoming.length === 0);
  const sinks   = noteData.filter((n) => n.outgoing.length === 0 && n.incoming.length > 0);
  const sources = noteData.filter((n) => n.outgoing.length > 0 && n.incoming.length === 0);

  const lines: string[] = [
    `# Vault Link Graph — ${noteIndex.length} notes`,
    ``,
    `Orphaned (no links at all): ${orphans.length}`,
    `Sinks (referenced but link to nothing): ${sinks.length}`,
    `Sources (link outward but nothing links to them): ${sources.length}`,
    ``,
    `## All Notes`,
    ...noteData.map(
      (n) =>
        `- [[${n.name}]] | out: ${n.outgoing.length}, in: ${n.incoming.length}` +
        (n.outgoing.length === 0 && n.incoming.length === 0 ? " ⚠ ORPHAN" : ""),
    ),
    ``,
    `## Outgoing Links per Note`,
    ...noteData
      .filter((n) => n.outgoing.length > 0)
      .map((n) => `- [[${n.name}]] → ${n.outgoing.map((t) => `[[${t}]]`).join(", ")}`),
    ``,
    `## Incoming Links per Note`,
    ...noteData
      .filter((n) => n.incoming.length > 0)
      .map((n) => `- [[${n.name}]] ← ${n.incoming.map((t) => `[[${t}]]`).join(", ")}`),
  ];

  onStatus("");
  return lines.join("\n");
}

// ── Task Manager: extract open tasks from every note ─────────────────────────
//
// Scans all vault notes for Markdown checkbox items (`- [ ] …`), groups only
// incomplete tasks by source file, and returns a structured context block that
// the Task Manager LLM uses to generate a formatted todo.md.

async function buildTaskContext(
  noteIndex: import("../store/useStore").NoteMetadata[],
  onStatus: (msg: string) => void,
): Promise<string> {
  const isTodoPath = (path: string) =>
    /(?:^|[\\/])summaries[\\/]todo\.md$/i.test(path);
  const mdNotes = noteIndex.filter((n) => n.path.endsWith(".md") && !isTodoPath(n.path));
  if (!mdNotes.length) return "(no notes found)";

  onStatus("Scanning vault for tasks…");

  // Read in parallel batches of 20
  const BATCH = 20;
  const tasksByNote: { name: string; path: string; tasks: string[] }[] = [];

  for (let i = 0; i < mdNotes.length; i += BATCH) {
    const slice = mdNotes.slice(i, i + BATCH);
    const contents = await Promise.all(
      slice.map((n) =>
        invoke<string>("get_file_content", { path: n.path }).catch(() => ""),
      ),
    );
    contents.forEach((content, j) => {
      const note = slice[j];
      // Match incomplete markdown tasks across list marker styles (including indented items):
      // - [ ] task, * [ ] task, + [ ] task, 1. [ ] task
      const tasks = [...content.matchAll(/^[ \t]*(?:[-*+]|\d+\.)\s+\[ \]\s+(.+)$/gm)].map(
        (m) => m[1].trim(),
      );
      if (tasks.length > 0) tasksByNote.push({ name: note.name, path: note.path, tasks });
    });

    onStatus(`Scanned ${Math.min(i + BATCH, mdNotes.length)} / ${mdNotes.length} notes…`);
  }

  if (!tasksByNote.length) {
    onStatus("");
    return "(no open tasks found across the vault)";
  }

  const totalTasks = tasksByNote.reduce((s, n) => s + n.tasks.length, 0);
  const dueDatedTasks = tasksByNote.reduce(
    (s, n) => s + n.tasks.filter((t) => Boolean(extractTaskDueDate(t))).length,
    0,
  );
  const lines = [
    `# Open Tasks — ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `Total: ${totalTasks} open task${totalTasks !== 1 ? "s" : ""} in ${tasksByNote.length} note${tasksByNote.length !== 1 ? "s" : ""}.`,
    `Due dates: ${dueDatedTasks} task${dueDatedTasks !== 1 ? "s" : ""} with optional due metadata (format: (due: YYYY-MM-DD)).`,
    ``,
    ...tasksByNote.flatMap(({ name, tasks }) => [
      `## [[${name}]]`,
      ...tasks.map((t) => `- [ ] ${t} (source: [[${name}]])`),
      ``,
    ]),
  ];

  onStatus("");
  return lines.join("\n");
}

function extractTaskDueDate(text: string): string | null {
  const m = text.match(/\(due:\s*(\d{4}-\d{2}-\d{2})\)/i);
  return m ? m[1] : null;
}

interface ParsedTodoTaskEntry {
  sourceName: string;
  text: string;
  checked: boolean;
}

function parseTodoTaskEntries(todoContent: string): ParsedTodoTaskEntry[] {
  const entries: ParsedTodoTaskEntry[] = [];
  const re =
    /^[ \t]*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(.+?)\s*\(source:\s*\[\[([^\]]+)\]\]\)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(todoContent)) !== null) {
    entries.push({
      checked: m[1].toLowerCase() === "x",
      text: m[2].trim(),
      sourceName: m[3].trim().replace(/\.md$/i, ""),
    });
  }
  return entries;
}

function applyTaskStatusUpdates(
  content: string,
  updates: Array<{ text: string; checked: boolean }>,
): { content: string; changed: boolean; appliedCount: number } {
  if (!updates.length) return { content, changed: false, appliedCount: 0 };
  const queues = new Map<string, boolean[]>();
  for (const u of updates) {
    const q = queues.get(u.text) ?? [];
    q.push(u.checked);
    queues.set(u.text, q);
  }
  const cursors = new Map<string, number>();
  let changed = false;
  let appliedCount = 0;
  const lineRe = /^([ \t]*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s+)(.+)$/;

  const next = content.split("\n").map((line) => {
    const m = line.match(lineRe);
    if (!m) return line;
    const text = m[4].trim();
    const queue = queues.get(text);
    if (!queue?.length) return line;
    const idx = cursors.get(text) ?? 0;
    if (idx >= queue.length) return line;
    cursors.set(text, idx + 1);
    appliedCount += 1;
    const want = queue[idx] ? "x" : " ";
    if (m[2] === want) return line;
    changed = true;
    return `${m[1]}${want}${m[3]}${m[4]}`;
  });

  return { content: next.join("\n"), changed, appliedCount };
}

async function collectVaultTasksForTodo(
  noteIndex: import("../store/useStore").NoteMetadata[],
  onStatus: (msg: string) => void,
): Promise<Array<{ name: string; path: string; tasks: Array<{ text: string; checked: boolean; dueDate: string | null }> }>> {
  const isTodoPath = (path: string) =>
    /(?:^|[\\/])summaries[\\/]todo\.md$/i.test(path);
  const mdNotes = noteIndex.filter((n) => n.path.endsWith(".md") && !isTodoPath(n.path));
  const BATCH = 20;
  const out: Array<{ name: string; path: string; tasks: Array<{ text: string; checked: boolean; dueDate: string | null }> }> = [];

  for (let i = 0; i < mdNotes.length; i += BATCH) {
    const slice = mdNotes.slice(i, i + BATCH);
    const contents = await Promise.all(
      slice.map((n) =>
        invoke<string>("get_file_content", { path: n.path }).catch(() => ""),
      ),
    );
    contents.forEach((content, j) => {
      const note = slice[j];
      const tasks = [...content.matchAll(/^[ \t]*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(.+)$/gm)].map(
        (m) => ({
          checked: m[1].toLowerCase() === "x",
          text: m[2].trim(),
          dueDate: extractTaskDueDate(m[2].trim()),
        }),
      );
      if (tasks.length) out.push({ name: note.name, path: note.path, tasks });
    });
    onStatus(`Synced ${Math.min(i + BATCH, mdNotes.length)} / ${mdNotes.length} notes…`);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function buildTodoSyncContent(
  tasksByNote: Array<{ name: string; tasks: Array<{ text: string; checked: boolean; dueDate: string | null }> }>,
): string {
  const total = tasksByNote.reduce((s, n) => s + n.tasks.length, 0);
  const completed = tasksByNote.reduce(
    (s, n) => s + n.tasks.filter((t) => t.checked).length,
    0,
  );
  const dueDated = tasksByNote.reduce(
    (s, n) => s + n.tasks.filter((t) => Boolean(t.dueDate)).length,
    0,
  );
  const open = total - completed;
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    "---",
    `date: ${today}`,
    "status: in-progress",
    "---",
    "",
    "## Overview",
    `- Total tasks: ${total}`,
    `- Open: ${open}`,
    `- Completed: ${completed}`,
    `- With due date: ${dueDated}`,
    `- Source notes: ${tasksByNote.length}`,
    "",
    ...tasksByNote.flatMap(({ name, tasks }) => [
      `## [[${name}]]`,
      ...tasks.map((t) => `- [${t.checked ? "x" : " "}] ${t.text} (source: [[${name}]])`),
      "",
    ]),
  ];
  return lines.join("\n");
}

// IDs that ship with the app — cannot be deleted; provider/model are editable like other personas.
const SYSTEM_DEFAULT_IDS = new Set([
  LIBRARIAN_PERSONA_ID,
  TASK_PERSONA_ID,
  HANDWRITING_OCR_PERSONA_ID,
]);

const MAX_HANDWRITING_OCR_BATCH = 25;

// ── AITab ─────────────────────────────────────────────────────────────────────

function AITab({
  activePersona, personas, activePersonaId, settings, history,
  activeFileContent, activeFilePath, vaultPath, files, initialScope,
  onSelectPersona, onAddHistory, onClearHistory, onNewPersona, onOpenSettings,
}: AITabProps) {
  const [scope, setScope] = useState<ExecutionScope>(initialScope ?? { type: "current-file" });

  // Apply an externally-injected scope (from sidebar context menu)
  useEffect(() => {
    if (initialScope) setScope(initialScope);
  }, [initialScope]);
  // System personas have their own dedicated run buttons; the generic Ask box is not for them.
  const isSystemPersona = activePersona ? SYSTEM_DEFAULT_IDS.has(activePersona.id) : false;

  const [userMessage, setUserMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [response, setResponse] = useState("");
  const [strategy, setStrategy] = useState<ContextStrategy | null>(null);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [pendingWrites, setPendingWrites] = useState<PendingWrite[]>([]);
  // Set to true when a selection quick-action requests an auto-run.
  // A dedicated effect watches this flag and only fires handleRun once
  // both this flag and the new userMessage have been committed by React,
  // avoiding the race condition that plagued the old setTimeout approach.
  const [autoRunQueued, setAutoRunQueued] = useState(false);

  // Cursor offset is updated by the editor on every caret move; read once per
  // run so the insertion point is frozen at the moment the user clicked Run.
  const cursorOffset = useStore((s) => s.cursorOffset);

  const abortRef = useRef<AbortController | null>(null);
  const runTokenRef = useRef(0);
  const responseRef = useRef<HTMLDivElement>(null);

  // Clear the response area whenever the active file changes so stale context
  // from a previous note doesn't linger.  If a stream is in flight it is
  // aborted first to avoid writing into the wrong context.
  useEffect(() => {
    // Invalidate any in-flight run so post-await work cannot continue against
    // stale file context after a note switch.
    runTokenRef.current += 1;
    if (streaming) {
      abortRef.current?.abort();
      setStreaming(false);
    }
    setResponse("");
    setError("");
    setStatusMsg("");
    setStrategy(null);
    setPendingWrites([]);
    // Intentionally NOT clearing userMessage — the user may have typed a
    // question they want to apply to the newly opened file.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath]);

  // Scroll to bottom of response as chunks arrive
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response]);

  // Ref so the selectionQuery effect (placed after handleRun) can call it
  // without creating a circular dependency.
  const handleRunRef = useRef<(() => void) | null>(null);

  // Stash insertAfterSelection flags so onDone (inside handleRun) can read
  // them even though the selectionQuery store entry is cleared before the run.
  const insertAfterSelectionRef = useRef(false);
  const selectionEndOffsetRef   = useRef(0);

  // When a quick action has a dedicated persona, its ID is stashed here before
  // handleRun is called.  handleRun reads and clears the ref so the override
  // only affects that single run without changing the active persona chip.
  const overridePersonaIdRef = useRef<string | null>(null);

  const apiKey = usePersonaStore((s) => selectProfileApiKey(s, activePersona));

  const hasApiKey = apiKey.length > 0;

  const handleRun = useCallback(async () => {
    // Resolve the persona for this run.  A quick action may pin a specific
    // persona via overridePersonaIdRef; otherwise fall back to the active one.
    const { personas: allPersonas, settings: liveSettings } =
      usePersonaStore.getState();
    const runPersona = overridePersonaIdRef.current
      ? (allPersonas.find((p) => p.id === overridePersonaIdRef.current) ?? activePersona)
      : activePersona;
    overridePersonaIdRef.current = null; // consume — only affects this run

    const runProfile = runPersona
      ? profileForPersona(liveSettings, runPersona)
      : undefined;

    const runMessage = userMessage.trim();
    if (!runPersona || !runProfile?.apiKey?.trim() || !runMessage || streaming) return;

    // Freeze mutable run inputs so async steps and callbacks can't drift.
    const runToken = ++runTokenRef.current;
    const runScope = scope;
    const runActiveFilePath = activeFilePath;
    const runActiveFileContent = activeFileContent;
    const runCursorOffset = cursorOffset;

    setError("");
    setResponse("");
    setStrategy(null);
    setStatusMsg("");
    setPendingWrites([]);
    setUserMessage("");
    setStreaming(true);

    // Build context using the smart tiered strategy
    let context = "";
    try {
      const result = await buildSmartContext(
        runScope,
        runMessage,
        runPersona,
        runProfile,
        runActiveFileContent,
        vaultPath,
        (msg) => setStatusMsg(msg),
      );
      if (runToken !== runTokenRef.current) return;
      context = result.context;
      setStrategy(result.strategy);
    } catch (e) {
      if (runToken !== runTokenRef.current) return;
      setError(`Failed to build context: ${String(e)}`);
      setStreaming(false);
      return;
    }

    setStatusMsg("");

    const controller = streamResponse(
      runPersona,
      context,
      runMessage,
      runProfile,
      {
        onChunk: (chunk) => {
          if (runToken !== runTokenRef.current) return;
          setResponse((prev) => prev + chunk);
        },
        onDone: (text, toolCalls) => {
          if (runToken !== runTokenRef.current) return;
          setStreaming(false);

          // If the action requested an inline insert and the model returned
          // plain text (no tool calls), auto-create a pending insert write so
          // the user can Apply directly below the highlighted section.
          if (
            insertAfterSelectionRef.current &&
            toolCalls.length === 0 &&
            text.trim() &&
            runActiveFilePath
          ) {
            setPendingWrites([{
              id: `sel-insert-${Date.now()}`,
              tool: "insert_at_cursor",
              path: runActiveFilePath,
              content: text.trim(),
              cursorOffset: selectionEndOffsetRef.current,
              status: "pending",
            }]);
            insertAfterSelectionRef.current = false;
            selectionEndOffsetRef.current   = 0;
          }

          // Agent file tools: always require explicit "Apply" in the UI (no silent disk writes).
          // Task Manager's todo.md path is the intentional exception — handled in handleTaskScan.
          if (toolCalls.length > 0) {
            const writes: PendingWrite[] = [];
            for (const tc of toolCalls as ParsedToolCall[]) {
              if (
                (tc.name === "write_to_current_file" ||
                  tc.name === "append_to_current_file" ||
                  tc.name === "prepend_to_current_file") &&
                runActiveFilePath
              ) {
                writes.push({
                  id: tc.id,
                  tool: tc.name as PendingWriteTool,
                  path: runActiveFilePath,
                  content: String(tc.args.content ?? ""),
                  status: "pending",
                });
              } else if (tc.name === "insert_at_cursor" && runActiveFilePath) {
                writes.push({
                  id: tc.id,
                  tool: "insert_at_cursor",
                  path: runActiveFilePath,
                  content: String(tc.args.content ?? ""),
                  cursorOffset: runCursorOffset,
                  status: "pending",
                });
              } else if (tc.name === "create_new_note") {
                const rel =
                  sanitizeAgentNoteRelativePath(
                    String(tc.args.relative_path ?? "agent-note.md"),
                  ) ?? "agent-note.md";
                writes.push({
                  id: tc.id,
                  tool: "create_new_note",
                  path: rel,
                  content: String(tc.args.content ?? ""),
                  status: "pending",
                });
              }
            }
            if (writes.length > 0) setPendingWrites(writes);
          }

          onAddHistory({
            id: `h-${Date.now()}`,
            timestamp: Date.now(),
            personaId: runPersona.id,
            scope: runScope,
            userMessage: runMessage,
            response: text,
          });
        },
        onError: (err) => {
          if (runToken !== runTokenRef.current) return;
          setStreaming(false);
          setError(err.message);
        },
      },
      AGENT_FILE_TOOLS,
    );
    if (runToken !== runTokenRef.current) {
      controller.abort();
      return;
    }
    abortRef.current = controller;
  }, [activePersona, hasApiKey, userMessage, streaming, scope, activeFileContent, activeFilePath, vaultPath, apiKey, settings, onAddHistory, cursorOffset]);

  const handleStop = () => {
    runTokenRef.current += 1;
    abortRef.current?.abort();
    setStreaming(false);
  };

  // ── Librarian: vault-wide orphan scan ──────────────────────────────────────
  // Bypasses buildSmartContext entirely — the orphan graph is computed locally
  // and injected directly as context so the LLM produces a structured report.
  const handleLibrarianScan = useCallback(async () => {
    if (!activePersona || !hasApiKey || streaming) return;

    setError("");
    setResponse("");
    setStrategy(null);
    setStatusMsg("Preparing vault scan…");
    setPendingWrites([]);
    setStreaming(true);

    const profile = selectProfileForPersona(
      { ...usePersonaStore.getState(), settings },
      activePersona,
    );
    if (!profile) {
      setStreaming(false);
      setError("No API provider configured for this persona.");
      return;
    }

    let orphanContext: string;
    try {
      const { noteIndex } = useStore.getState();
      orphanContext = await buildOrphanReport(noteIndex, setStatusMsg);
    } catch (e) {
      setError(`Vault scan failed: ${String(e)}`);
      setStreaming(false);
      return;
    }

    setStatusMsg("");
    setStrategy({ type: "single-file", chars: orphanContext.length });

    const trigger =
      "Analyse the vault link graph above. Provide your full Librarian report: " +
      "list every orphaned note, suggest specific [[wikilinks]] to fix each one, " +
      "and close with a summary of overall graph health.";

    const controller = streamResponse(
      activePersona,
      orphanContext,
      trigger,
      profile,
      {
        onChunk: (chunk) => setResponse((prev) => prev + chunk),
        onDone: (text) => {
          setStreaming(false);
          onAddHistory({
            id: `h-${Date.now()}`,
            timestamp: Date.now(),
            personaId: activePersona.id,
            scope: { type: "full-vault" },
            userMessage: trigger,
            response: text,
          });
        },
        onError: (err) => {
          setStreaming(false);
          setError(err.message);
        },
      },
    );
    abortRef.current = controller;
  }, [activePersona, hasApiKey, streaming, settings, onAddHistory]);

  // ── Task Manager: vault-wide task scan + todo.md auto-write ────────────────
  const handleTaskScan = useCallback(async () => {
    if (!activePersona || !hasApiKey || streaming) return;

    setError("");
    setResponse("");
    setStrategy(null);
    setStatusMsg("Scanning for tasks…");
    setPendingWrites([]);
    setStreaming(true);

    const profile = selectProfileForPersona(
      { ...usePersonaStore.getState(), settings },
      activePersona,
    );
    if (!profile) {
      setStreaming(false);
      setError("No API provider configured for this persona.");
      return;
    }

    let taskContext: string;
    try {
      const { noteIndex } = useStore.getState();
      taskContext = await buildTaskContext(noteIndex, setStatusMsg);
    } catch (e) {
      setError(`Task scan failed: ${String(e)}`);
      setStreaming(false);
      return;
    }

    setStatusMsg("");
    setStrategy({ type: "single-file", chars: taskContext.length });

    const trigger =
      "Using only the incomplete open tasks listed above, produce the complete contents of todo.md. " +
      "Do not include completed/checked items. " +
      "Follow your system-prompt format exactly: frontmatter → ## Overview → one ## [[Note]] section per source note, " +
      "and ensure each task line includes its source-note wikilink.";

    const controller = streamResponse(
      activePersona,
      taskContext,
      trigger,
      profile,
      {
        onChunk: (chunk) => setResponse((prev) => prev + chunk),
        onDone: async (text) => {
          setStreaming(false);
          // Auto-write the result to summaries/todo.md using agent_write_note
          if (vaultPath && text.trim()) {
            try {
              const relPath = `${vaultPath}/summaries/todo.md`;
              const absPath = await invoke<string>("agent_write_note", { relPath, content: text });
              await syncUiAfterDiskWrites([{ path: absPath, content: text }]);
              setStatusMsg("✓ todo.md written to summaries/");
            } catch (e) {
              setStatusMsg(`Could not write todo.md: ${String(e)}`);
            }
          }
          onAddHistory({
            id: `h-${Date.now()}`,
            timestamp: Date.now(),
            personaId: activePersona.id,
            scope: { type: "full-vault" },
            userMessage: trigger,
            response: text,
          });
        },
        onError: (err) => {
          setStreaming(false);
          setError(err.message);
        },
      },
    );
    abortRef.current = controller;
  }, [activePersona, hasApiKey, streaming, apiKey, settings, vaultPath, onAddHistory]);

  // ── Task Manager: bi-directional checkbox sync (todo.md ↔ source notes) ───
  const handleTaskSync = useCallback(async () => {
    if (streaming || !vaultPath) return;

    setError("");
    setResponse("");
    setStrategy(null);
    setPendingWrites([]);
    setStatusMsg("Syncing todo.md with source notes…");
    setStreaming(true);

    const todoPath = `${vaultPath}/summaries/todo.md`;
    const { noteIndex } = useStore.getState();
    const byName = new Map(
      noteIndex.map((n) => [n.name.replace(/\.md$/i, "").toLowerCase(), n]),
    );

    try {
      // 1) Apply todo.md checkbox state changes back into source notes.
      const todoContent = await invoke<string>("get_file_content", { path: todoPath }).catch(() => "");
      const todoEntries = parseTodoTaskEntries(todoContent);

      const updatesByPath = new Map<string, Array<{ text: string; checked: boolean }>>();
      for (const e of todoEntries) {
        const src = byName.get(e.sourceName.toLowerCase());
        if (!src) continue;
        const list = updatesByPath.get(src.path) ?? [];
        list.push({ text: e.text, checked: e.checked });
        updatesByPath.set(src.path, list);
      }

      let updatedNotes = 0;
      const diskWrites: DiskWrite[] = [];
      for (const [path, updates] of updatesByPath) {
        const content = await invoke<string>("get_file_content", { path }).catch(() => "");
        if (!content) continue;
        const applied = applyTaskStatusUpdates(content, updates);
        if (!applied.changed) continue;
        await invoke("save_note", { path, content: applied.content });
        diskWrites.push({ path, content: applied.content });
        updatedNotes += 1;
      }

      // 2) Rebuild todo.md from current source task state (both open + completed).
      const tasksByNote = await collectVaultTasksForTodo(noteIndex, setStatusMsg);
      const syncedTodo = buildTodoSyncContent(tasksByNote);
      const todoAbsPath = await invoke<string>("agent_write_note", { relPath: todoPath, content: syncedTodo });
      diskWrites.push({ path: todoAbsPath, content: syncedTodo });
      await syncUiAfterDiskWrites(diskWrites);

      setResponse(
        `Task sync complete.\n\n` +
        `- Updated source notes: ${updatedNotes}\n` +
        `- Synced task notes: ${tasksByNote.length}\n` +
        `- Wrote: summaries/todo.md`,
      );
      setStatusMsg("✓ Vault task sync complete");
    } catch (e) {
      setError(`Task sync failed: ${String(e)}`);
    } finally {
      setStreaming(false);
    }
  }, [streaming, vaultPath]);

  const handwritingPendingCount = useMemo(() => {
    if (!vaultPath) return 0;
    return collectHandwritingImages(files, vaultPath, "pending").length;
  }, [files, vaultPath]);

  const handwritingTotalCount = useMemo(() => {
    if (!vaultPath) return 0;
    return collectHandwritingImages(files, vaultPath, "all").length;
  }, [files, vaultPath]);

  const runHandwritingOcr = useCallback(
    async (mode: "pending" | "all") => {
      if (!activePersona || !hasApiKey || streaming || !vaultPath) return;

      let images = collectHandwritingImages(files, vaultPath, mode);
      if (!images.length) {
        setError(
          mode === "pending"
            ? "No new images in handwritten/ — add photos there, or use Re-transcribe all."
            : "No images in handwritten/. Add photos to that Space in the sidebar first.",
        );
        return;
      }

      let batchNote = "";
      if (images.length > MAX_HANDWRITING_OCR_BATCH) {
        images = images.slice(0, MAX_HANDWRITING_OCR_BATCH);
        batchNote = ` (first ${MAX_HANDWRITING_OCR_BATCH} only)`;
      }

      const willOverwrite = images.some((i) => i.hasExistingNote);
      const confirmMsg = willOverwrite
        ? `Transcribe ${images.length} image(s)${batchNote}? Existing .md files with the same name will be overwritten.`
        : `Transcribe ${images.length} image(s)${batchNote} into Markdown notes in handwritten/?`;
      if (!window.confirm(confirmMsg)) return;

      const profile = selectProfileForPersona(
        { ...usePersonaStore.getState(), settings },
        activePersona,
      );
      if (!profile) {
        setError("No API provider configured for this persona.");
        return;
      }

      setError("");
      setResponse("");
      setStrategy(null);
      setPendingWrites([]);
      setStreaming(true);

      const lines: string[] = [];
      const diskWrites: DiskWrite[] = [];

      try {
        for (let i = 0; i < images.length; i++) {
          const img = images[i]!;
          setStatusMsg(`Reading ${img.fileName} (${i + 1}/${images.length})…`);

          const payload = await invoke<{ data_base64: string; mime_type: string }>(
            "read_vault_image_base64",
            { path: img.path },
          );

          setStatusMsg(`Transcribing ${img.fileName} (${i + 1}/${images.length})…`);
          const mime =
            payload.mime_type || mimeTypeForImagePath(img.path);
          const result = await transcribeHandwritingImage(
            activePersona,
            profile,
            payload.data_base64,
            mime,
            img.fileName,
          );

          if (!result.ok) {
            lines.push(`✗ ${img.fileName}: ${result.error}`);
            continue;
          }

          const content = buildHandwritingNoteMarkdown(
            img.relativePath,
            img.fileName,
            result.text,
          );
          const absPath = await invoke<string>("agent_write_note", {
            relPath: img.mdPath,
            content,
          });
          diskWrites.push({ path: absPath, content });
          lines.push(`✓ ${img.fileName} → ${img.fileName.replace(/\.[^.]+$/i, ".md")}`);
        }

        if (diskWrites.length) {
          await syncUiAfterDiskWrites(diskWrites);
          await useStore.getState().refreshVault();
        }

        setResponse(lines.join("\n"));
        setStatusMsg(
          diskWrites.length
            ? `✓ Wrote ${diskWrites.length} note${diskWrites.length !== 1 ? "s" : ""} to handwritten/`
            : "No notes were written.",
        );
        onAddHistory({
          id: `h-${Date.now()}`,
          timestamp: Date.now(),
          personaId: activePersona.id,
          scope: { type: "specific-folder", folderPath: `${vaultPath}/handwritten` },
          userMessage: `Handwriting OCR (${mode}): ${images.length} image(s)`,
          response: lines.join("\n"),
        });
      } catch (e) {
        setError(`Handwriting OCR failed: ${String(e)}`);
      } finally {
        setStreaming(false);
      }
    },
    [activePersona, hasApiKey, streaming, vaultPath, files, settings, onAddHistory],
  );

  // Keep ref in sync so the selectionQuery effect can call handleRun
  handleRunRef.current = handleRun;

  // ── Selection query (from floating toolbar) ────────────────────────────────
  // Subscribe reactively so the effect fires when the store value changes.
  const selectionQuery = usePersonaStore((s) => s.selectionQuery);

  useEffect(() => {
    if (!selectionQuery) return;
    // Clear the store entry immediately to avoid re-triggering
    usePersonaStore.getState().setSelectionQuery(null);
    setUserMessage(selectionQuery.userMessage);
    setResponse("");
    setError("");
    setStatusMsg("");
    setStrategy(null);
    setPendingWrites([]);
    // Stash inline-insert flags so onDone can read them after the run
    insertAfterSelectionRef.current = selectionQuery.insertAfterSelection ?? false;
    selectionEndOffsetRef.current   = selectionQuery.selectionEndOffset ?? 0;
    // Stash the override persona ID so handleRun uses the action's dedicated persona
    overridePersonaIdRef.current = selectionQuery.personaId ?? null;
    if (selectionQuery.autoRun) {
      setAutoRunQueued(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionQuery]);

  // Fires after React has committed both autoRunQueued=true and the new
  // userMessage value, ensuring handleRun reads the correct message from
  // its closure.  The userMessage guard prevents false triggers while the
  // queue flag is still false (e.g. when userMessage changes via normal typing).
  useEffect(() => {
    if (!autoRunQueued || !userMessage.trim()) return;
    setAutoRunQueued(false);
    handleRunRef.current?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunQueued, userMessage]);

  // Scope label for display
  const scopeLabel =
    scope.type === "current-file"
      ? activeFilePath ? activeFilePath.split("/").pop() ?? "Current File" : "Current File"
      : scope.type === "specific-file"
      ? scope.filePath.split("/").pop() ?? "File"
      : scope.type === "specific-folder"
      ? scope.folderPath.split("/").pop() ?? "Folder"
      : "Full Vault";

  // Collect folders from file tree for the scope picker
  const folders = useMemo(() => {
    const result: { path: string; name: string }[] = [];
    function walk(nodes: typeof files, depth = 0) {
      for (const n of nodes) {
        if (n.is_dir) {
          result.push({ path: n.path, name: "  ".repeat(depth) + n.name });
          if (n.children) walk(n.children, depth + 1);
        }
      }
    }
    walk(files);
    return result;
  }, [files]);

  // Collect all .md files from the file tree for the file scope picker.
  // Indented with the folder name prefix so the hierarchy is readable in
  // a flat <select> element.
  const noteFiles = useMemo(() => {
    const result: { path: string; label: string }[] = [];
    function walk(nodes: typeof files, prefix = "") {
      for (const n of nodes) {
        if (n.is_dir) {
          if (n.children) walk(n.children, prefix + n.name + "/");
        } else if (n.name.endsWith(".md")) {
          result.push({ path: n.path, label: prefix + n.name });
        }
      }
    }
    walk(files);
    return result;
  }, [files]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* ── Persona chips ─────────────────────────────────────────── */}
      {/* max-h caps growth so the response area always gets usable space */}
      <div className="shrink-0 border-b border-border px-2 py-2 space-y-1.5 max-h-36 overflow-y-auto">
        {/* System Default personas */}
        {(() => {
          const systemChips = personas.filter((p) => !p.disabled && SYSTEM_DEFAULT_IDS.has(p.id));
          const customChips = personas.filter((p) => !p.disabled && !SYSTEM_DEFAULT_IDS.has(p.id));
          return (
            <>
              {systemChips.length > 0 && (
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">System</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {systemChips.map((p) => (
                      <button
                        key={p.id}
                        data-persona-id={p.id}
                        onClick={() => onSelectPersona(p.id)}
                        title={`${p.name} · ${p.model} — or drag a file/folder here to run`}
                        className={[
                          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all",
                          streaming && activePersonaId === p.id
                            ? "animate-pulse bg-accent/30 text-accent ring-1 ring-accent"
                            : activePersonaId === p.id
                            ? "bg-accent/20 text-accent ring-1 ring-accent"
                            : "bg-surface-overlay text-text-muted hover:text-text-primary",
                        ].join(" ")}
                      >
                        <span>{p.icon}</span>
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {customChips.length > 0 && (
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">Custom</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {customChips.map((p) => (
                      <button
                        key={p.id}
                        data-persona-id={p.id}
                        onClick={() => onSelectPersona(p.id)}
                        title={`${p.name} · ${p.model} — or drag a file/folder here to run`}
                        className={[
                          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all",
                          streaming && activePersonaId === p.id
                            ? "animate-pulse bg-accent/30 text-accent ring-1 ring-accent"
                            : activePersonaId === p.id
                            ? "bg-accent/20 text-accent ring-1 ring-accent"
                            : "bg-surface-overlay text-text-muted hover:text-text-primary",
                        ].join(" ")}
                      >
                        <span>{p.icon}</span>
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}
        <div className="flex items-center gap-1">
          <button
            onClick={onNewPersona}
            title="New persona"
            className="rounded-full px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
          >
            +
          </button>
          <button
            onClick={onOpenSettings}
            title="Manage personas"
            className="ml-auto rounded p-0.5 text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {settings.storeAiHistory === false && (
        <div className="shrink-0 border-b border-border bg-surface-overlay/70 px-3 py-1.5 text-[9px] text-text-muted">
          History recording is off — new runs are not saved to History. Change this in Settings → AI & privacy.
        </div>
      )}

      {/* ── Scope selector ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <p className="mb-1 text-[10px] uppercase tracking-widest text-text-muted font-semibold">Scope</p>
        <div className="flex gap-1 flex-wrap">
          {(["current-file", "specific-folder", "full-vault"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                if (t === "specific-folder" && folders.length > 0) {
                  setScope({ type: "specific-folder", folderPath: folders[0].path });
                } else if (t === "current-file") {
                  // Reset to current-file; the dropdown below lets the user
                  // pick a different file while staying in File scope.
                  setScope({ type: "current-file" });
                } else if (t === "full-vault") {
                  setScope({ type: "full-vault" });
                }
              }}
              className={[
                "rounded px-2 py-0.5 text-[10px] transition-colors",
                // specific-file is a sub-mode of File scope — keep the button active
                (scope.type === t || (t === "current-file" && scope.type === "specific-file"))
                  ? "bg-accent/20 text-accent"
                  : "bg-surface-overlay text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {t === "current-file" ? "File" : t === "specific-folder" ? "Folder" : "Vault"}
            </button>
          ))}
        </div>

        {/* File dropdown — visible when File scope is active */}
        {(scope.type === "current-file" || scope.type === "specific-file") && noteFiles.length > 0 && (
          <select
            value={scope.type === "specific-file" ? scope.filePath : (activeFilePath ?? "")}
            onChange={async (e) => {
              const selected = e.target.value;
              // Open the selected note in the editor so the left panel updates.
              try {
                const content = await invoke<string>("get_file_content", { path: selected });
                useStore.getState().setActiveFile(selected, content);
              } catch {
                // If the read fails, still update the scope so the AI can try.
              }
              // If the user picks the currently open note, revert to current-file
              // so the scope tracks the active editor automatically.
              if (selected === activeFilePath) {
                setScope({ type: "current-file" });
              } else {
                setScope({ type: "specific-file", filePath: selected });
              }
            }}
            className="mt-1.5 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary focus:border-accent focus:outline-none"
          >
            {noteFiles.map((f) => (
              <option key={f.path} value={f.path}>{f.label}</option>
            ))}
          </select>
        )}

        {/* Folder dropdown — visible when Folder scope is active */}
        {scope.type === "specific-folder" && folders.length > 0 && (
          <select
            value={scope.folderPath}
            onChange={(e) => setScope({ type: "specific-folder", folderPath: e.target.value })}
            className="mt-1.5 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary focus:border-accent focus:outline-none"
          >
            {folders.map((f) => (
              <option key={f.path} value={f.path}>{f.name}</option>
            ))}
          </select>
        )}

        <p className="mt-1 text-[10px] text-text-muted">
          Running on: <span className="text-text-secondary font-medium">{scopeLabel}</span>
        </p>
      </div>

      {/* ── Librarian panel — only when The Librarian is active ────── */}
      {activePersona?.id === LIBRARIAN_PERSONA_ID && (
        <div className="shrink-0 border-b border-border bg-surface-overlay/40 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <span className="text-lg leading-none shrink-0">📚</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-text-primary mb-0.5">Vault Health Scan</p>
              <p className="text-[10px] text-text-muted leading-relaxed mb-2">
                Reads every note, maps [[wikilinks]], and asks the LLM to
                identify orphaned notes and suggest specific connections.
              </p>
              <button
                onClick={handleLibrarianScan}
                disabled={!hasApiKey || streaming}
                className="flex items-center gap-1.5 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {streaming ? (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="animate-spin">
                      <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" opacity=".3"/>
                      <path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8V2z"/>
                    </svg>
                    Scanning…
                  </>
                ) : (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    Scan Vault for Orphaned Notes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Task Manager panel — only when Task Manager is active ─── */}
      {activePersona?.id === TASK_PERSONA_ID && (
        <div className="shrink-0 border-b border-border bg-surface-overlay/40 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <span className="text-lg leading-none shrink-0">✅</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-text-primary mb-0.5">Vault Task Scan</p>
              <p className="text-[10px] text-text-muted leading-relaxed mb-2">
                Reads every note for <code className="font-mono">- [ ]</code> checkboxes, then asks
                the LLM to produce an organised <code className="font-mono">summaries/todo.md</code> with links back
                to each source note. Optional due date metadata is supported inline as{" "}
                <code className="font-mono">(due: YYYY-MM-DD)</code>.
              </p>
              <div
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 mb-2 text-[10px] text-amber-200/90 leading-relaxed"
              >
                <span className="font-semibold text-amber-100">No confirmation step:</span>{" "}
                when the LLM finishes, Metis writes <code className="font-mono text-[9px]">summaries/todo.md</code>{" "}
                under your vault immediately (overwriting any existing file). This is unlike normal agent edits,
                which use Apply.
              </div>
              <button
                onClick={handleTaskScan}
                disabled={!hasApiKey || streaming}
                className="flex items-center gap-1.5 rounded-md bg-green-500/15 border border-green-500/30 px-3 py-1.5 text-[11px] font-medium text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {streaming ? (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="animate-spin">
                      <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" opacity=".3"/>
                      <path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8V2z"/>
                    </svg>
                    Scanning…
                  </>
                ) : (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 11 12 14 22 4"/>
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                    Scan &amp; Update todo.md
                  </>
                )}
              </button>
              <div className="mt-2 rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-1.5 text-[10px] text-sky-100/90 leading-relaxed">
                <span className="font-semibold text-sky-100">Vault Task Sync:</span>{" "}
                applies checkbox changes from <code className="font-mono text-[9px]">summaries/todo.md</code> back
                to source notes, then rebuilds <code className="font-mono text-[9px]">todo.md</code> from current vault task state.
              </div>
              <button
                onClick={handleTaskSync}
                disabled={streaming || !vaultPath}
                className="mt-2 flex items-center gap-1.5 rounded-md bg-sky-500/15 border border-sky-500/30 px-3 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {streaming ? (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="animate-spin">
                      <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" opacity=".3"/>
                      <path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8V2z"/>
                    </svg>
                    Syncing…
                  </>
                ) : (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 2v6h-6" />
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                      <path d="M3 22v-6h6" />
                      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                    Vault Task Sync (bi-directional)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Handwriting OCR — images in handwritten/ Space ───────── */}
      {activePersona?.id === HANDWRITING_OCR_PERSONA_ID && (
        <div className="shrink-0 border-b border-border bg-surface-overlay/40 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <span className="text-lg leading-none shrink-0">📷</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-text-primary mb-0.5">
                Handwriting → Markdown
              </p>
              <p className="text-[10px] text-text-muted leading-relaxed mb-2">
                Add photos of handwritten notes to the{" "}
                <code className="font-mono text-[9px]">handwritten/</code> Space (sidebar).
                Vision AI transcribes each image into a sibling{" "}
                <code className="font-mono text-[9px]">.md</code> note with the image embedded.
                Use a vision model (e.g. <code className="font-mono text-[9px]">gpt-4o</code>,{" "}
                <code className="font-mono text-[9px]">gemini-1.5-flash</code>).
              </p>
              {vaultPath && (
                <p className="text-[10px] text-text-muted mb-2">
                  {handwritingPendingCount} new · {handwritingTotalCount} total image
                  {handwritingTotalCount !== 1 ? "s" : ""} in handwritten/
                </p>
              )}
              <div
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 mb-2 text-[10px] text-amber-200/90 leading-relaxed"
              >
                <span className="font-semibold text-amber-100">Writes immediately:</span>{" "}
                each transcription is saved to{" "}
                <code className="font-mono text-[9px]">handwritten/&lt;name&gt;.md</code>{" "}
                after you confirm (overwrites existing notes when re-transcribing).
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runHandwritingOcr("pending")}
                  disabled={!hasApiKey || streaming || !vaultPath || handwritingPendingCount === 0}
                  className="flex items-center gap-1.5 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {streaming ? "Working…" : `Transcribe new (${handwritingPendingCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => void runHandwritingOcr("all")}
                  disabled={!hasApiKey || streaming || !vaultPath || handwritingTotalCount === 0}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Re-transcribe all
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Response area ──────────────────────────────────────────── */}
      {/* min-h-0 overrides the default min-height:auto on flex items so the
          area can actually shrink and scroll rather than overflow the panel */}
      <div
        ref={responseRef}
        data-cc-scroll-region
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs text-text-secondary font-mono whitespace-pre-wrap leading-relaxed"
      >
        {/* Idle placeholder */}
        {!response && !error && !streaming && !statusMsg && (
          <p className="text-text-muted text-center mt-6 text-[11px]">
            {!hasApiKey
              ? "⚙ Configure your API key in the Settings tab"
              : !activePersona
              ? "Select or create a persona to get started"
              : activePersona.id === HANDWRITING_OCR_PERSONA_ID
              ? "Transcribe images from handwritten/ using the buttons above"
              : "Ask the persona anything about your note…"}
          </p>
        )}

        {/* Context-building status (shown before streaming starts) */}
        {statusMsg && !response && (
          <p className="text-text-muted text-[10px] italic mt-2">
            <span className="animate-pulse">⋯</span> {statusMsg}
          </p>
        )}

        {/* Thinking indicator — visible after context is built but before
            the first token arrives from the LLM */}
        {streaming && !response && !statusMsg && (
          <div className="flex flex-col items-center gap-3 mt-8">
            <svg
              width="24" height="24" viewBox="0 0 24 24"
              fill="none" className="animate-spin text-accent"
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <p className="text-[11px] text-text-muted animate-pulse">
              {activePersona?.name ?? "Agent"} is thinking…
            </p>
          </div>
        )}

        {error && <p className="text-red-400 text-[11px]">{error}</p>}

        {response}

        {/* Blinking cursor while streaming */}
        {streaming && response && (
          <span className="inline-block h-3 w-1.5 animate-pulse bg-accent align-text-bottom ml-0.5 rounded-sm" />
        )}

        {/* ── Pending file writes (agent-initiated) ──────────────── */}
        {pendingWrites.length > 0 && !streaming && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              File changes
            </p>
            {pendingWrites.map((pw) => (
              <PendingWriteCard
                key={pw.id}
                write={pw}
                vaultPath={vaultPath}
                activeFileContent={activeFileContent}
                onApply={(id) => {
                  setPendingWrites((prev) =>
                    prev.map((w) => w.id === id ? { ...w, status: "applying" } : w),
                  );
                }}
                onDone={(id, absPath, finalContent) => {
                  setPendingWrites((prev) =>
                    prev.map((w) => w.id === id ? { ...w, status: "done" } : w),
                  );
                  if (absPath) {
                    const write = pendingWrites.find((w) => w.id === id);
                    void syncUiAfterDiskWrites(
                      [{ path: absPath, content: finalContent }],
                      write?.tool === "create_new_note" ? { openPath: absPath } : undefined,
                    );
                  } else {
                    void useStore.getState().refreshVault();
                  }
                }}
                onError={(id, msg) => {
                  setPendingWrites((prev) =>
                    prev.map((w) => w.id === id ? { ...w, status: "error", errorMsg: msg } : w),
                  );
                }}
                onDismiss={(id) => {
                  setPendingWrites((prev) => prev.filter((w) => w.id !== id));
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Context strategy badge ─────────────────────────────────── */}
      {strategy && !streaming && (
        <div className="shrink-0 border-t border-border px-3 py-1">
          <p className="text-[9px] text-text-muted opacity-70">{strategyLabel(strategy)}</p>
        </div>
      )}

      {/* ── Input area ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border p-2 space-y-1.5">
        <textarea
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleRun();
            }
          }}
          placeholder={
            isSystemPersona
              ? `Use the panel above to run ${activePersona?.name ?? "this agent"}`
              : activePersona
              ? `Ask ${activePersona.name}… (⌘↵ to run)`
              : "Select a persona first"
          }
          disabled={!activePersona || streaming || isSystemPersona}
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1.5">
          {streaming ? (
            <button
              onClick={handleStop}
              className="flex-1 rounded-md bg-red-500/20 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
            >
              ■ Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={!activePersona || !hasApiKey || !userMessage.trim() || isSystemPersona}
              className="flex-1 rounded-md bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ▶ Run {activePersona?.icon ?? ""}
            </button>
          )}
          {(response || pendingWrites.length > 0) && !streaming && (
            <button
              onClick={() => {
                setResponse("");
                setError("");
                setUserMessage("");
                setStrategy(null);
                setStatusMsg("");
                setPendingWrites([]);
              }}
              title="Clear"
              className="rounded-md px-2 py-1.5 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── History ────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="shrink-0 border-t border-border">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] text-text-muted hover:text-text-primary transition-colors"
          >
            <span className="font-semibold uppercase tracking-widest">History ({history.length})</span>
            <span>{showHistory ? "▾" : "▸"}</span>
          </button>
          {showHistory && (
            <div className="max-h-48 overflow-y-auto px-2 pb-2 space-y-1">
              {history.slice(0, 10).map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setUserMessage(h.userMessage);
                    setResponse(h.response);
                  }}
                  className="w-full rounded-md border border-border bg-surface-overlay px-2 py-1.5 text-left text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
                >
                  <span className="font-medium text-text-secondary truncate block">
                    {h.userMessage.slice(0, 60)}{h.userMessage.length > 60 ? "…" : ""}
                  </span>
                  <span className="opacity-60">
                    {new Date(h.timestamp).toLocaleTimeString()}
                  </span>
                </button>
              ))}
              <button
                onClick={onClearHistory}
                className="w-full text-center text-[10px] text-text-muted hover:text-red-400 transition-colors py-0.5"
              >
                Clear history
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── CollapsibleSection ────────────────────────────────────────────────────────
// Reusable accordion-style section header used throughout the Settings tab.

function CollapsibleSection({
  title,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between mb-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 py-0.5 text-left"
        >
          <svg
            width="8" height="8" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 text-text-muted"
            style={{
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 150ms ease",
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            {title}
          </span>
        </button>
        {/* Action slot (e.g. "+ New") — stop-propagation so clicks don't toggle */}
        {action && (
          <div onClick={(e) => e.stopPropagation()} className="ml-2 shrink-0">
            {action}
          </div>
        )}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Shared test-connection status type ───────────────────────────────────────
// Defined here (before SettingsTab) so both the "add provider" form and the
// existing ProviderSection can share the same discriminated union.

type TestStatus =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "ok"; detail: string }
  | { phase: "error"; message: string };

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({
  settings,
  upsertProviderProfile,
  removeProviderProfile,
  setDefaultProviderProfileId,
  onUpdateSettings,
}: {
  settings: ReturnType<typeof usePersonaStore.getState>["settings"];
  upsertProviderProfile: (profile: AiProviderProfile) => void;
  removeProviderProfile: (id: string) => void;
  setDefaultProviderProfileId: (id: string) => void;
  onUpdateSettings: (patch: Partial<typeof settings>) => void;
}) {
  const profiles = settings.providerProfiles;
  const configuredProfiles = profiles.filter((p) => (p.apiKey ?? "").trim().length > 0);

  const [showAddForm, setShowAddForm] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [draftUrl, setDraftUrl] = useState("https://api.openai.com/v1");
  const [draftModel, setDraftModel] = useState("");
  const [draftTestStatus, setDraftTestStatus] = useState<TestStatus>({ phase: "idle" });

  const [newPersonaTrigger, setNewPersonaTrigger] = useState(0);
  const [newActionTrigger, setNewActionTrigger] = useState(0);

  function resetDraftForm() {
    setShowAddForm(false);
    setDraftName("");
    setDraftKey("");
    setDraftUrl("https://api.openai.com/v1");
    setDraftModel("");
    setDraftTestStatus({ phase: "idle" });
  }

  function draftProfile(): AiProviderProfile {
    return {
      id: makeProviderProfileId(),
      name: draftName.trim() || "Custom provider",
      baseUrl: draftUrl.trim(),
      apiKey: draftKey.trim(),
      defaultModel: draftModel.trim() || undefined,
      adapter: inferAdapter(draftUrl.trim()),
    };
  }

  async function handleDraftTest() {
    if (!draftKey.trim() || !draftUrl.trim()) return;
    setDraftTestStatus({ phase: "testing" });
    const result = await testProviderConnection(draftProfile());
    setDraftTestStatus(
      result.ok
        ? { phase: "ok", detail: result.detail }
        : { phase: "error", message: result.error },
    );
  }

  function handleAddProvider() {
    if (!draftKey.trim() || !draftUrl.trim()) return;
    const profile = draftProfile();
    upsertProviderProfile(profile);
    if (!settings.defaultProviderProfileId) {
      setDefaultProviderProfileId(profile.id);
    }
    resetDraftForm();
  }

  const sectionBtnCls =
    "rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors";

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1" data-cc-scroll-region>

      {/* ── Personas ─────────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="Personas"
        action={
          <button
            onClick={() => setNewPersonaTrigger((n) => n + 1)}
            className={sectionBtnCls}
          >
            + New
          </button>
        }
      >
        <PersonasSection hideHeader newPersonaTrigger={newPersonaTrigger} />
      </CollapsibleSection>

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="Quick Actions"
        defaultOpen={false}
        action={
          <button
            onClick={() => setNewActionTrigger((n) => n + 1)}
            className={sectionBtnCls}
          >
            + New
          </button>
        }
      >
        <QuickActionsSettings hideHeader newActionTrigger={newActionTrigger} />
      </CollapsibleSection>

      {/* ── Spellcheck dictionary ─────────────────────────────────────────── */}
      <CollapsibleSection title="Spellcheck" defaultOpen={false}>
        <div className="space-y-2 text-[11px] text-text-muted">
          <p>Choose which dictionary the spellcheck linter uses.</p>
          <select
            value={settings.spellcheckLanguage ?? "en_US"}
            onChange={(e) => onUpdateSettings({ spellcheckLanguage: e.target.value })}
            className="w-full rounded border border-border bg-surface-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="en_US">English (US)</option>
            <option value="en_GB">English (UK)</option>
          </select>
          <p className="text-[10px] opacity-70">
            Toggle spellcheck on/off from the toolbar (Abc icon).
          </p>
        </div>
      </CollapsibleSection>

      {/* ── AI & privacy (history) ───────────────────────────────────────── */}
      <CollapsibleSection title="AI & privacy" defaultOpen={false}>
        <div className="space-y-3 text-[11px] text-text-muted">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.storeAiHistory !== false}
              onChange={(e) => onUpdateSettings({ storeAiHistory: e.target.checked })}
              className="mt-0.5 rounded border-border"
            />
            <span>
              <span className="font-medium text-text-primary">Store conversation history</span>
              {" "}
              in this session (last 50 runs). Turn off to avoid keeping assistant replies in memory.
            </span>
          </label>
          <div>
            <p className="font-medium text-text-primary mb-1">Max characters per history entry</p>
            <p className="text-[10px] leading-relaxed mb-1.5">
              Large scopes can produce very long replies. Extra text is trimmed before storing.
              Use <span className="font-mono">0</span> for no limit.
            </p>
            <input
              type="number"
              min={0}
              step={1000}
              value={settings.aiHistoryMaxResponseChars ?? 32_000}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 0) {
                  onUpdateSettings({ aiHistoryMaxResponseChars: n });
                }
              }}
              className="w-28 rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── API Providers ─────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="API Providers"
        defaultOpen={true}
        action={
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className={sectionBtnCls}
          >
            {showAddForm ? "Cancel" : "+ Add"}
          </button>
        }
      >
        <div className="space-y-3">
        <p className="text-[10px] text-text-muted leading-relaxed">
          Add any OpenAI-compatible API (OpenAI, Anthropic via <code className="text-[9px]">/v1</code>, Groq, Ollama, Azure, LiteLLM, etc.).
          Enter the provider name, base URL, and API key. Optional default model is used when creating new personas.
        </p>

        {profiles.map((p) => (
          <ProviderProfileSection
            key={p.id}
            profile={p}
            isDefault={settings.defaultProviderProfileId === p.id}
            onSetDefault={() => setDefaultProviderProfileId(p.id)}
            onSave={upsertProviderProfile}
            onRemove={() => {
              if (window.confirm(`Remove provider "${p.name}"? Personas using it will switch to the default.`)) {
                removeProviderProfile(p.id);
              }
            }}
          />
        ))}

        {showAddForm && (
          <div className="rounded-md border border-border bg-surface-overlay p-3 space-y-2">
            <div className="flex items-center justify-between">
              <FieldLabel>New provider</FieldLabel>
              <button onClick={resetDraftForm} className="text-[10px] text-text-muted hover:text-text-primary">
                ✕
              </button>
            </div>
            <div>
              <label className="text-[10px] text-text-muted">Name</label>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. Anthropic, Local Ollama"
                className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-muted">Base URL</label>
              <input
                type="text"
                value={draftUrl}
                onChange={(e) => {
                  setDraftUrl(e.target.value);
                  setDraftTestStatus({ phase: "idle" });
                }}
                placeholder="https://api.openai.com/v1"
                className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-muted">API key</label>
              <input
                type="password"
                value={draftKey}
                onChange={(e) => {
                  setDraftKey(e.target.value);
                  setDraftTestStatus({ phase: "idle" });
                }}
                placeholder="Required"
                className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-muted">Default model <span className="opacity-60">(optional)</span></label>
              <input
                type="text"
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
                className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <TestConnectionRow
              disabled={!draftKey.trim() || !draftUrl.trim()}
              status={draftTestStatus}
              onTest={handleDraftTest}
            />
            <button
              onClick={handleAddProvider}
              disabled={!draftKey.trim() || !draftUrl.trim()}
              className="w-full rounded bg-accent py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-40"
            >
              Save provider
            </button>
          </div>
        )}

        {configuredProfiles.length === 0 && !showAddForm && (
          <p className="text-[11px] text-text-muted">No API keys configured yet — add a provider above.</p>
        )}

        {settings.allowedAiHosts.length > 0 && (
          <p className="text-[9px] text-text-muted opacity-60">
            Allowed hosts: {settings.allowedAiHosts.join(", ")}
          </p>
        )}

        <p className="text-[10px] text-text-muted opacity-50 leading-relaxed">
          Keys are stored locally in the app data directory. Custom base URLs are allowed at runtime (no app rebuild).
        </p>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ── Personas section (inside Settings tab) ────────────────────────────────────

function PersonasSection({
  hideHeader = false,
  newPersonaTrigger = 0,
}: {
  hideHeader?: boolean;
  newPersonaTrigger?: number;
}) {
  const { personas, upsertPersona, deletePersona } = usePersonaStore(
    useShallow((s) => ({
      personas: s.personas,
      upsertPersona: s.upsertPersona,
      deletePersona: s.deletePersona,
    })),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // When the parent increments the trigger, open the new-persona form
  useEffect(() => {
    if (newPersonaTrigger > 0) {
      setShowNewForm(true);
      setExpandedId(null);
    }
  }, [newPersonaTrigger]);

  return (
    <div>
      {!hideHeader && (
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Personas
          </p>
          <button
            onClick={() => { setShowNewForm(true); setExpandedId(null); }}
            className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
            title="New persona"
          >
            + New
          </button>
        </div>
      )}

      <div className="space-y-3">
        {/* System Default personas */}
        {(() => {
          const systemPersonas = [...personas].filter((p) => SYSTEM_DEFAULT_IDS.has(p.id));
          const customPersonas = [...personas].filter((p) => !SYSTEM_DEFAULT_IDS.has(p.id));
          const renderRow = (persona: import("../types/persona").Persona) => {
            const isSystem = SYSTEM_DEFAULT_IDS.has(persona.id);
            return (
              <PersonaRow
                key={persona.id}
                persona={persona}
                isSystemDefault={isSystem}
                expanded={expandedId === persona.id}
                onToggle={() =>
                  setExpandedId((prev) => {
                    setShowNewForm(false);
                    return prev === persona.id ? null : persona.id;
                  })
                }
                onToggleEnabled={() =>
                  upsertPersona({ ...persona, disabled: !persona.disabled })
                }
                onSave={(updated) => { upsertPersona(updated); setExpandedId(null); }}
                onDelete={() => {
                  if (!window.confirm(`Delete persona "${persona.name}"?`)) return;
                  deletePersona(persona.id);
                  if (expandedId === persona.id) setExpandedId(null);
                }}
              />
            );
          };
          return (
            <>
              {systemPersonas.length > 0 && (
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">
                    System Default
                  </p>
                  <div className="space-y-1">{systemPersonas.map(renderRow)}</div>
                </div>
              )}
              {customPersonas.length > 0 && (
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">
                    Custom
                  </p>
                  <div className="space-y-1">{customPersonas.map(renderRow)}</div>
                </div>
              )}
            </>
          );
        })()}

        {showNewForm && (
          <PersonaInlineForm
            onSave={(p) => { upsertPersona(p); setShowNewForm(false); }}
            onCancel={() => setShowNewForm(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── Single persona row (collapsed + expanded) ─────────────────────────────────

interface PersonaRowProps {
  persona: Persona;
  isSystemDefault: boolean;
  expanded: boolean;
  onToggle: () => void;
  onToggleEnabled: () => void;
  onSave: (updated: Persona) => void;
  onDelete: () => void;
}

function PersonaRow({ persona, isSystemDefault, expanded, onToggle, onToggleEnabled, onSave, onDelete }: PersonaRowProps) {
  const settings = usePersonaStore((s) => s.settings);
  const profile = profileForPersona(settings, persona);
  const providerLabel = profile?.name ?? "Unknown provider";
  const enabled = !persona.disabled;
  return (
    <div className={`rounded-md border overflow-hidden transition-opacity ${enabled ? "border-border bg-surface-overlay" : "border-border/50 bg-surface-overlay/50 opacity-60"}`}>
      {/* Collapsed header */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="text-base leading-none">{persona.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium text-text-primary truncate">{persona.name}</p>
            {isSystemDefault && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-text-muted bg-surface-raised border border-border/60">
                System
              </span>
            )}
          </div>
          <p className="text-[10px] text-text-muted">
            {providerLabel} · {persona.model}
          </p>
        </div>

        {/* Enable / disable toggle */}
        <button
          onClick={onToggleEnabled}
          title={enabled ? "Disable — hide from AI tab" : "Enable — show in AI tab"}
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none ${enabled ? "bg-accent" : "bg-surface-raised border border-border"}`}
        >
          <span className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-3.5" : "translate-x-0.5"}`} />
        </button>

        <button
          onClick={onToggle}
          title={expanded ? "Collapse" : "Edit"}
          className="rounded p-0.5 text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            {expanded
              ? <polyline points="18 15 12 9 6 15" />
              : <polyline points="6 9 12 15 18 9" />}
          </svg>
        </button>

        {/* Delete — hidden for system defaults */}
        {!isSystemDefault && (
          <button
            onClick={onDelete}
            title="Delete persona"
            className="rounded p-0.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border px-2 pb-2 pt-2">
          <PersonaInlineForm
            initial={persona}
            isSystemDefault={isSystemDefault}
            onSave={onSave}
            onCancel={onToggle}
          />
        </div>
      )}
    </div>
  );
}

// ── Shared inline form (used for create + edit) ───────────────────────────────

interface PersonaInlineFormProps {
  initial?: Persona;
  /** When true (built-in Librarian / Task Manager), name and system prompt are fixed — only icon, provider, and model are editable. */
  isSystemDefault?: boolean;
  onSave: (p: Persona) => void;
  onCancel: () => void;
}

function PersonaInlineForm({ initial, isSystemDefault = false, onSave, onCancel }: PersonaInlineFormProps) {
  const settings = usePersonaStore((s) => s.settings);
  const defaultProfileId =
    settings.defaultProviderProfileId ??
    settings.providerProfiles[0]?.id ??
    "preset-openai";

  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "✍️");
  const [providerProfileId, setProviderProfileId] = useState(
    initial?.providerProfileId ?? defaultProfileId,
  );
  const [model, setModel] = useState(initial?.model ?? "gpt-4o");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [error, setError] = useState("");
  const [showFullPrompt, setShowFullPrompt] = useState(false);

  const profiles = settings.providerProfiles;

  function handleSave() {
    const finalName = isSystemDefault && initial ? initial.name : name.trim();
    const finalPrompt = isSystemDefault && initial ? initial.systemPrompt : systemPrompt.trim();
    if (!finalName.trim()) { setError("Name is required."); return; }
    if (!finalPrompt.trim()) { setError("System prompt is required."); return; }
    if (!model.trim()) { setError("Model is required."); return; }
    onSave({
      id: initial?.id ?? `persona-${Date.now()}`,
      name: finalName.trim(),
      icon,
      providerProfileId,
      model: model.trim(),
      systemPrompt: finalPrompt.trim(),
      ...(initial?.disabled !== undefined ? { disabled: initial.disabled } : {}),
    });
  }

  return (
    <div className="space-y-2">
      {/* Icon row */}
      <div>
        <FieldLabel>Icon</FieldLabel>
        <div className="flex flex-wrap gap-1 mt-1">
          {ICON_PRESETS.map((e) => (
            <button
              key={e}
              onClick={() => setIcon(e)}
              className={[
                "h-6 w-6 rounded text-xs transition-colors",
                icon === e ? "bg-accent/20 ring-1 ring-accent" : "bg-surface-base hover:bg-surface-raised",
              ].join(" ")}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Name — fixed for system default personas */}
      <div>
        <FieldLabel>Name</FieldLabel>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={isSystemDefault}
          placeholder="e.g. Research Assistant"
          title={isSystemDefault ? "Built-in persona name cannot be changed" : undefined}
          className={[
            "mt-0.5 w-full rounded border border-border px-2 py-1 text-xs placeholder:text-text-muted focus:outline-none",
            isSystemDefault
              ? "cursor-default bg-surface-raised/60 text-text-muted border-border/70"
              : "bg-surface-base text-text-primary focus:border-accent",
          ].join(" ")}
        />
      </div>

      {/* API provider profile */}
      <div>
        <FieldLabel>API provider</FieldLabel>
        <select
          value={providerProfileId}
          onChange={(e) => {
            const id = e.target.value;
            setProviderProfileId(id);
            if (!initial) {
              const profile = findProviderProfile(settings, id);
              if (profile) {
                setModel(
                  profile.defaultModel?.trim() || curatedSmallModelId(profile),
                );
              }
            }
          }}
          className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Model — cached, searchable, auto-fetched */}
      <div>
        <FieldLabel>Model</FieldLabel>
        <div className="mt-0.5">
          <ModelPicker
            profileId={providerProfileId}
            value={model}
            onChange={setModel}
            size="sm"
          />
        </div>
      </div>

      {/* System prompt — read-only for system default personas (expand still helps reading) */}
      <div>
        <div className="flex items-center justify-between">
          <FieldLabel>System Prompt</FieldLabel>
          <button
            type="button"
            onClick={() => setShowFullPrompt((v) => !v)}
            className="text-[9px] text-text-muted hover:text-text-primary transition-colors"
          >
            {showFullPrompt ? "collapse" : "expand"}
          </button>
        </div>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          readOnly={isSystemDefault}
          rows={showFullPrompt ? 8 : 3}
          placeholder="You are a helpful assistant..."
          title={isSystemDefault ? "Built-in persona instructions cannot be changed" : undefined}
          className={[
            "mt-0.5 w-full resize-none rounded border px-2 py-1 text-xs placeholder:text-text-muted focus:outline-none",
            isSystemDefault
              ? "cursor-default bg-surface-raised/60 text-text-muted border-border/70"
              : "border-border bg-surface-base text-text-primary focus:border-accent",
          ].join(" ")}
        />
      </div>

      {error && <p className="text-[10px] text-red-400">{error}</p>}

      <div className="flex justify-end gap-1.5 pt-0.5">
        <button
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
        >
          {initial ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}

// ── Pending write confirmation card ───────────────────────────────────────────

const TOOL_LABELS: Record<PendingWriteTool, { icon: string; verb: string }> = {
  write_to_current_file:   { icon: "📝", verb: "Overwrite" },
  append_to_current_file:  { icon: "⬇", verb: "Append to end of" },
  prepend_to_current_file: { icon: "⬆", verb: "Prepend to start of" },
  insert_at_cursor:        { icon: "➤", verb: "Insert at cursor in" },
  create_new_note:         { icon: "✨", verb: "Create" },
};

function PendingWriteCard({
  write,
  vaultPath,
  activeFileContent,
  onApply,
  onDone,
  onError,
  onDismiss,
}: {
  write: PendingWrite;
  vaultPath: string | null;
  activeFileContent: string;
  onApply: (id: string) => void;
  onDone: (id: string, absPath: string, finalContent: string) => void;
  onError: (id: string, msg: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [showFull, setShowFull] = useState(false);
  const PREVIEW_LEN = 400;
  const preview = write.content.length > PREVIEW_LEN && !showFull
    ? write.content.slice(0, PREVIEW_LEN) + "…"
    : write.content;

  const { icon, verb } = TOOL_LABELS[write.tool];
  const displayName = write.tool === "create_new_note"
    ? write.path
    : (write.path.split("/").pop() ?? write.path);

  async function handleApply() {
    onApply(write.id);
    try {
      let finalContent = write.content;
      let relPath = write.path;

      if (write.tool === "append_to_current_file") {
        finalContent = appendToEnd(activeFileContent, write.content);
      } else if (write.tool === "prepend_to_current_file") {
        // Insert after frontmatter + H1 so YAML and title stay at the top
        finalContent = insertAfterFrontmatter(activeFileContent, write.content);
      } else if (write.tool === "insert_at_cursor") {
        // Insert after the line at the cursor offset frozen at run-time
        finalContent = insertAtOffset(activeFileContent, write.cursorOffset ?? 0, write.content);
      } else if (write.tool === "create_new_note") {
        relPath = vaultPath ? `${vaultPath}/${write.path}` : write.path;
      }
      // write_to_current_file: relPath (absPath) + full content as-is

      const absPath = await invoke<string>("agent_write_note", {
        relPath,
        content: finalContent,
      });
      // Pass finalContent back so the caller can sync the editor immediately
      // without a separate disk read.
      onDone(write.id, absPath, finalContent);
    } catch (err) {
      onError(write.id, err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className={[
      "rounded-md border overflow-hidden text-[11px]",
      write.status === "done"
        ? "border-green-500/30 bg-green-500/5"
        : write.status === "error"
        ? "border-red-500/30 bg-red-500/5"
        : "border-border bg-surface-overlay",
    ].join(" ")}>
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="text-base leading-none">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-text-muted">{verb}</p>
          <p className="truncate font-mono font-medium text-text-primary">{displayName}</p>
        </div>
        {write.status === "done" && (
          <span className="flex items-center gap-1 text-green-400 text-[10px]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Applied
          </span>
        )}
        {write.status === "error" && (
          <span className="text-red-400 text-[10px]" title={write.errorMsg}>Failed</span>
        )}
      </div>

      {/* Content preview — shows the chunk being added (not the full merged file) */}
      <div className="border-t border-border px-2 pb-1.5 pt-1">
        <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-text-secondary leading-relaxed max-h-32 overflow-y-auto">
          {preview}
        </pre>
        {write.content.length > PREVIEW_LEN && (
          <button
            onClick={() => setShowFull((v) => !v)}
            className="mt-0.5 text-[9px] text-accent hover:underline"
          >
            {showFull ? "Show less" : `Show all (${write.content.length.toLocaleString()} chars)`}
          </button>
        )}
      </div>

      {/* Action buttons */}
      {write.status === "pending" && (
        <div className="flex gap-1.5 border-t border-border px-2 py-1.5">
          <button
            onClick={handleApply}
            className="flex-1 rounded bg-accent/20 py-1 text-[10px] font-medium text-accent hover:bg-accent/30 transition-colors"
          >
            Apply
          </button>
          <button
            onClick={() => onDismiss(write.id)}
            className="rounded px-2 py-1 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
      {write.status === "applying" && (
        <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5">
          <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <span className="text-[10px] text-text-muted">Writing…</span>
        </div>
      )}
      {write.status === "error" && (
        <div className="border-t border-red-500/20 px-2 py-1.5">
          <p className="text-[10px] text-red-400">{write.errorMsg}</p>
          <button
            onClick={handleApply}
            className="mt-1 text-[9px] text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function TestConnectionRow({
  disabled,
  status,
  onTest,
}: {
  disabled: boolean;
  status: TestStatus;
  onTest: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pt-0.5 flex-wrap">
      <button
        type="button"
        onClick={onTest}
        disabled={disabled || status.phase === "testing"}
        className="flex items-center gap-1 rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-secondary hover:border-accent hover:text-accent disabled:opacity-50 transition-colors"
      >
        {status.phase === "testing" ? "Testing…" : "Test connection"}
      </button>
      {status.phase === "ok" && (
        <span className="text-[10px] text-green-400">{status.detail}</span>
      )}
      {status.phase === "error" && (
        <span className="text-[10px] text-red-400 break-words min-w-0" title={status.message}>
          {status.message}
        </span>
      )}
    </div>
  );
}

function ProviderProfileSection({
  profile,
  isDefault,
  onSetDefault,
  onSave,
  onRemove,
}: {
  profile: AiProviderProfile;
  isDefault: boolean;
  onSetDefault: () => void;
  onSave: (profile: AiProviderProfile) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>({ phase: "idle" });
  const [name, setName] = useState(profile.name);
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl);
  const [apiKey, setApiKey] = useState(profile.apiKey);
  const [defaultModel, setDefaultModel] = useState(profile.defaultModel ?? "");

  useEffect(() => {
    setName(profile.name);
    setBaseUrl(profile.baseUrl);
    setApiKey(profile.apiKey);
    setDefaultModel(profile.defaultModel ?? "");
  }, [profile.id, profile.name, profile.baseUrl, profile.apiKey, profile.defaultModel]);

  function commit(): AiProviderProfile {
    const next: AiProviderProfile = {
      ...profile,
      name: name.trim() || profile.name,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      defaultModel: defaultModel.trim() || undefined,
      adapter: inferAdapter(baseUrl.trim(), profile.adapter),
    };
    onSave(next);
    return next;
  }

  async function runTest() {
    if (!apiKey.trim() || !baseUrl.trim()) {
      setTestStatus({ phase: "error", message: "Enter base URL and API key." });
      return;
    }
    setTestStatus({ phase: "testing" });
    const draft: AiProviderProfile = {
      ...profile,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      adapter: inferAdapter(baseUrl.trim(), profile.adapter),
    };
    const result = await testProviderConnection(draft);
    setTestStatus(
      result.ok
        ? { phase: "ok", detail: result.detail }
        : { phase: "error", message: result.error },
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface-overlay overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-text-primary">{profile.name}</span>
          {isDefault && (
            <span className="ml-2 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-medium text-accent">
              default
            </span>
          )}
          <p className="text-[9px] text-text-muted truncate">{profile.baseUrl}</p>
        </div>
        {!isDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            className="text-[9px] text-text-muted hover:text-accent transition-colors"
          >
            set default
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded p-0.5 text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
        >
          {expanded ? "▲" : "▼"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-0.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-2 pb-2 pt-2 space-y-1.5">
          <div>
            <label className="text-[10px] text-text-muted">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setTestStatus({ phase: "idle" });
              }}
              className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-text-muted">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setTestStatus({ phase: "idle" });
              }}
              className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-text-muted">API key</label>
              <button type="button" onClick={() => setShowKey((v) => !v)} className="text-[9px] text-text-muted">
                {showKey ? "hide" : "show"}
              </button>
            </div>
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestStatus({ phase: "idle" });
              }}
              className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-text-muted">Default model (optional)</label>
            <input
              type="text"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="Used when creating new personas"
              className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <TestConnectionRow
            disabled={!apiKey.trim() || !baseUrl.trim()}
            status={testStatus}
            onTest={runTest}
          />
          <button
            type="button"
            onClick={() => commit()}
            className="w-full rounded border border-accent/50 bg-accent/10 py-1 text-[10px] text-accent hover:bg-accent/20"
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
      {children}
    </span>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">{title}</p>
      <div className="rounded-md border border-border bg-surface-overlay p-2 space-y-1">{children}</div>
    </div>
  );
}

function KV({ label, value, mono = false, highlight = false }: {
  label: string; value: string; mono?: boolean; highlight?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-[10px] text-text-muted">{label}</span>
      <span
        className={["truncate text-right text-[11px]", mono ? "font-mono" : "", highlight ? "text-accent" : "text-text-secondary"].join(" ")}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
