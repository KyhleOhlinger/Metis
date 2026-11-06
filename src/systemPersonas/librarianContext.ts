import { invoke } from "@tauri-apps/api/core";
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

export async function buildOrphanReport(
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
    const files = await invoke<{ path: string; content: string }[]>("get_files_content", {
      paths: batch.map((n) => n.path),
    });
    for (const file of files) {
      const filename = file.path.split(/[/\\]/).pop() ?? file.path;
      const stem = filename.replace(/\.md$/i, "");
      noteContentByName.set(stem, file.content);
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

