import { loadVaultFiles } from "@/utils/vaultRead";
// ── Task Manager: extract open tasks from every note ─────────────────────────
//
// Scans all vault notes for Markdown checkbox items (`- [ ] …`), groups only
// incomplete tasks by source file, and returns a structured context block that
// the Task Manager LLM uses to generate a formatted todo.md.

import { buildPlannerUpcomingSection } from "./plannerContext";
import { todayIsoDate } from "@/utils/localDate";

export async function buildTaskContext(
  noteIndex: import("../store/useStore").NoteMetadata[],
  onStatus: (msg: string) => void,
  vaultPath?: string | null,
): Promise<string> {
  const isTodoPath = (path: string) =>
    /(?:^|[\\/])summaries[\\/]todo\.md$/i.test(path);
  const mdNotes = noteIndex.filter((n) => n.path.endsWith(".md") && !isTodoPath(n.path));
  if (!mdNotes.length) return "(no notes found)";

  onStatus("Scanning vault for tasks…");

  const BATCH = 100;
  const tasksByNote: { name: string; path: string; tasks: string[] }[] = [];

  for (let i = 0; i < mdNotes.length; i += BATCH) {
    const slice = mdNotes.slice(i, i + BATCH);
    const contents = await loadVaultFiles(slice.map((n) => n.path), { forAi: true });
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
    `# Open Tasks — ${todayIsoDate()}`,
    ``,
    `Total: ${totalTasks} open task${totalTasks !== 1 ? "s" : ""} in ${tasksByNote.length} note${tasksByNote.length !== 1 ? "s" : ""}.`,
    `Due dates: ${dueDatedTasks} task${dueDatedTasks !== 1 ? "s" : ""} with optional due metadata (format: (due: YYYY-MM-DD)).`,
    ``,
    ...tasksByNote.flatMap(({ path, tasks }) => [
      `## [[${vaultRelativeNote(path, vaultPath)}]]`,
      ...tasks.map((t) => `- [ ] ${t} (source: [[${vaultRelativeNote(path, vaultPath)}]])`),
      ``,
    ]),
  ];

  if (vaultPath) {
    try {
      const upcoming = await buildPlannerUpcomingSection(vaultPath);
      if (upcoming) {
        lines.push(upcoming, ``);
      }
    } catch {
      // Planner is optional for task scan.
    }
  }

  onStatus("");
  return lines.join("\n");
}

export function extractTaskDueDate(text: string): string | null {
  const m = text.match(/\(due:\s*(\d{4}-\d{2}-\d{2})\)/i);
  return m ? m[1] : null;
}

export interface ParsedTodoTaskEntry {
  sourcePath: string;
  text: string;
  checked: boolean;
  hash: string;
}

export interface TaskSyncSnapshot {
  tasks: Array<{ source: string; text: string; hash: string; checked: boolean }>;
}

export function vaultRelativeNote(absOrRel: string, vaultPath?: string | null): string {
  const path = absOrRel.replace(/\\/g, "/");
  const vault = (vaultPath ?? "").replace(/\\/g, "/").replace(/\/$/, "");
  const relative = vault && path.startsWith(`${vault}/`) ? path.slice(vault.length + 1) : path;
  return relative.replace(/\.md$/i, "");
}

export function taskLineHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash, 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function parseTodoTaskEntries(todoContent: string): ParsedTodoTaskEntry[] {
  const entries: ParsedTodoTaskEntry[] = [];
  const re =
    /^[ \t]*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(.+?)\s*\(source:\s*\[\[([^\]]+)\]\]\)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(todoContent)) !== null) {
    const text = m[2].trim();
    entries.push({
      checked: m[1].toLowerCase() === "x",
      text,
      sourcePath: vaultRelativeNote(m[3].trim()),
      hash: taskLineHash(text),
    });
  }
  return entries;
}

export function snapshotFromNotes(
  tasksByNote: Array<{ path: string; tasks: Array<{ text: string; checked: boolean }> }>,
  vaultPath: string,
): TaskSyncSnapshot {
  return {
    tasks: tasksByNote.flatMap((note) =>
      note.tasks.map((task) => ({
        source: vaultRelativeNote(note.path, vaultPath),
        text: task.text,
        hash: taskLineHash(task.text),
        checked: task.checked,
      })),
    ),
  };
}

export function planTaskSync(input: {
  todoEntries: ParsedTodoTaskEntry[];
  snapshot: TaskSyncSnapshot;
  notes: Array<{ source: string; content: string }>;
}): { updates: Map<string, Array<{ hash: string; checked: boolean; text: string }>>; conflicts: string[] } {
  const snap = new Map(input.snapshot.tasks.map((task) => [`${task.source}\n${task.hash}`, task]));
  const updates = new Map<string, Array<{ hash: string; checked: boolean; text: string }>>();
  const conflicts: string[] = [];
  for (const entry of input.todoEntries) {
    const note = input.notes.find((item) => item.source === entry.sourcePath);
    if (!note) {
      conflicts.push(`${entry.sourcePath}: source note was not found`);
      continue;
    }
    const hashCount = new Map<string, number>();
    for (const raw of note.content.split("\n")) {
      const found = raw.match(/^[ \t]*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s+(.+)$/);
      if (!found) continue;
      const hash = taskLineHash(found[1].trim());
      hashCount.set(hash, (hashCount.get(hash) ?? 0) + 1);
    }
    if ((hashCount.get(entry.hash) ?? 0) > 1) {
      conflicts.push(`${entry.sourcePath}: "${entry.text}" matches more than one line`);
      continue;
    }
    const sameHash = note.content.split("\n").filter((raw) => {
      const match = raw.match(/^[ \t]*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s+(.+)$/);
      return match ? taskLineHash(match[1].trim()) === entry.hash : false;
    }).length;
    if (sameHash > 1) {
      conflicts.push(`${entry.sourcePath}: "${entry.text}" matches more than one task`);
      continue;
    }
    const previous = snap.get(`${entry.sourcePath}\n${entry.hash}`);
    const line = note.content.split("\n").find((raw) => {
      const match = raw.match(/^[ \t]*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s+(.+)$/);
      return match ? taskLineHash(match[1].trim()) === entry.hash : false;
    });
    if (!line || !previous) {
      conflicts.push(`${entry.sourcePath}: "${entry.text}" does not match the last sync`);
      continue;
    }
    const currentChecked = /\[[xX]\]/.test(line);
    if (currentChecked !== previous.checked && entry.checked !== currentChecked) {
      conflicts.push(`${entry.sourcePath}: "${entry.text}" changed in the source note`);
      continue;
    }
    if (currentChecked !== previous.checked) continue;
    if (entry.checked === currentChecked) continue;
    const list = updates.get(entry.sourcePath) ?? [];
    list.push({ hash: entry.hash, checked: entry.checked, text: entry.text });
    updates.set(entry.sourcePath, list);
  }
  return { updates, conflicts };
}

export function applyTaskStatusUpdates(
  content: string,
  updates: Array<{ hash: string; checked: boolean }>,
): { content: string; changed: boolean; appliedCount: number; conflicts: string[] } {
  if (!updates.length) return { content, changed: false, appliedCount: 0, conflicts: [] };
  const byHash = new Map(updates.map((update) => [update.hash, update.checked]));
  let changed = false;
  let appliedCount = 0;
  const conflicts: string[] = [];
  const lineRe = /^([ \t]*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s+)(.+)$/;
  const seen = new Set<string>();

  const next = content.split("\n").map((line) => {
    const m = line.match(lineRe);
    if (!m) return line;
    const text = m[4].trim();
    const hash = taskLineHash(text);
    if (!byHash.has(hash)) return line;
    if (seen.has(hash)) {
      conflicts.push(text);
      return line;
    }
    seen.add(hash);
    appliedCount += 1;
    const want = byHash.get(hash) ? "x" : " ";
    if (m[2] === want) return line;
    changed = true;
    return `${m[1]}${want}${m[3]}${m[4]}`;
  });

  return { content: next.join("\n"), changed, appliedCount, conflicts };
}

export async function collectVaultTasksForTodo(
  noteIndex: import("../store/useStore").NoteMetadata[],
  onStatus: (msg: string) => void,
): Promise<Array<{ name: string; path: string; tasks: Array<{ text: string; checked: boolean; dueDate: string | null }> }>> {
  const isTodoPath = (path: string) =>
    /(?:^|[\\/])summaries[\\/]todo\.md$/i.test(path);
  const mdNotes = noteIndex.filter((n) => n.path.endsWith(".md") && !isTodoPath(n.path));
  const BATCH = 100;
  const out: Array<{ name: string; path: string; tasks: Array<{ text: string; checked: boolean; dueDate: string | null }> }> = [];

  for (let i = 0; i < mdNotes.length; i += BATCH) {
    const slice = mdNotes.slice(i, i + BATCH);
    const contents = await loadVaultFiles(slice.map((n) => n.path));
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

export function buildTodoSyncContent(
  tasksByNote: Array<{ name: string; path: string; tasks: Array<{ text: string; checked: boolean; dueDate: string | null }> }>,
  vaultPath?: string | null,
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
  const today = todayIsoDate();
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
    ...tasksByNote.flatMap(({ path, tasks }) => {
      const source = vaultRelativeNote(path, vaultPath);
      return [
        `## [[${source}]]`,
        ...tasks.map((t) => `- [${t.checked ? "x" : " "}] ${t.text} (source: [[${source}]])`),
        "",
      ];
    }),
  ];
  return lines.join("\n");
}

