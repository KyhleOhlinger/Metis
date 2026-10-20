import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { openVaultNotePath } from "@/utils/openVaultNote";
import { loadVaultFile } from "@/utils/vaultRead";
import type { FileNode } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";
import { isSupernoteNoteFile } from "@/constants/supernote";

export function companionMarkdownPathForNote(notePath: string): string {
  if (!isSupernoteNoteFile(notePath)) return notePath;
  return notePath.replace(/\.note$/i, ".md");
}

function vaultRelativeNote(noteAbsPath: string, vaultPath: string): string {
  const name = noteAbsPath.split("/").pop() ?? "notebook.note";
  return noteAbsPath.startsWith(`${vaultPath}/`)
    ? noteAbsPath.slice(vaultPath.length + 1)
    : name;
}

/** Embed the vault-relative `.note` path so two folders can share a file name. */
export function supernoteEmbedTarget(noteAbsPath: string, vaultPath: string): string {
  const rel = vaultRelativeNote(noteAbsPath, vaultPath);
  if (/[\r\n\]]/.test(rel)) {
    throw new Error("Invalid notebook path");
  }
  return rel;
}

export function buildSupernoteCompanionMarkdown(
  noteAbsPath: string,
  vaultPath: string,
): string {
  const rel = supernoteEmbedTarget(noteAbsPath, vaultPath);
  return (
    `---\nsource_note: ${JSON.stringify(rel)}\ntype: supernote\n---\n\n` +
    `![[${rel}]]\n\n## Notes\n\n`
  );
}

/**
 * Replace a basename-only `![[notebook.note]]` with the vault-relative path.
 * Leaves embeds that already include a folder, and leaves the rest of the note.
 */
export function repairSupernoteCompanionEmbed(
  content: string,
  noteAbsPath: string,
  vaultPath: string,
): string | null {
  let rel: string;
  try {
    rel = supernoteEmbedTarget(noteAbsPath, vaultPath);
  } catch {
    return null;
  }
  const match = content.match(/!\[\[([^\]]+\.note)\]\]/i);
  if (!match || match[1].includes("/")) return null;
  const current = match[1].split("/").pop()?.toLowerCase();
  const expected = rel.split("/").pop()?.toLowerCase();
  if (current !== expected) return null;
  return content.replace(match[0], `![[${rel}]]`);
}

function collectNotePaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileNode[]) => {
    for (const n of ns) {
      if (!n.is_dir && isSupernoteNoteFile(n.name)) out.push(n.path);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Create missing markdown companions so the tree can hide `.note` binaries. */
export async function ensureSupernoteCompanionNotes(): Promise<void> {
  const store = useStore.getState();
  const { vaultPath, files } = store;
  if (!vaultPath) return;

  let created = 0;
  for (const notePath of collectNotePaths(files)) {
    const mdPath = companionMarkdownPathForNote(notePath);
    try {
      const existing = await loadVaultFile(mdPath);
      const repaired = repairSupernoteCompanionEmbed(existing, notePath, vaultPath);
      if (!repaired || repaired === existing) continue;
      await invoke("save_note", { path: mdPath, content: repaired });
      created += 1;
    } catch {
      try {
        const template = buildSupernoteCompanionMarkdown(notePath, vaultPath);
        await invoke("save_note", { path: mdPath, content: template });
        created += 1;
      } catch (err) {
        toastError(`Could not create notebook note: ${String(err)}`);
      }
    }
  }
  if (created > 0) await store.refreshVault();
}

/** Open (or create) the sibling markdown that embeds a `.note` file. */
export async function openSupernoteCompanion(
  notePath: string,
  vaultPath: string,
): Promise<void> {
  if (!isSupernoteNoteFile(notePath) || !vaultPath) return;

  const store = useStore.getState();
  const mdPath = companionMarkdownPathForNote(notePath);

  if (await openVaultNotePath(mdPath, { quiet: true })) return;

  try {
    const template = buildSupernoteCompanionMarkdown(notePath, vaultPath);
    await invoke("save_note", { path: mdPath, content: template });
    await store.refreshVault();
    await openVaultNotePath(mdPath, { content: template });
  } catch (err) {
    toastError(`Could not open notebook note: ${String(err)}`);
  }
}
