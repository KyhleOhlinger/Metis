import { invoke } from "@tauri-apps/api/core";
// ── Task Manager: extract open tasks from every note ─────────────────────────
//
// Scans all vault notes for Markdown checkbox items (`- [ ] …`), groups only
// incomplete tasks by source file, and returns a structured context block that
// the Task Manager LLM uses to generate a formatted todo.md.

export async function buildTaskContext(
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

export function extractTaskDueDate(text: string): string | null {
  const m = text.match(/\(due:\s*(\d{4}-\d{2}-\d{2})\)/i);
  return m ? m[1] : null;
}

interface ParsedTodoTaskEntry {
  sourceName: string;
  text: string;
  checked: boolean;
}

export function parseTodoTaskEntries(todoContent: string): ParsedTodoTaskEntry[] {
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

export function applyTaskStatusUpdates(
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

export async function collectVaultTasksForTodo(
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

export function buildTodoSyncContent(
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

