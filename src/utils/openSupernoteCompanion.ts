import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import type { FileNode } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";
import { isSupernoteNoteFile } from "@/constants/supernote";

export function companionMarkdownPathForNote(notePath: string): string {
  if (!isSupernoteNoteFile(notePath)) return notePath;
  return notePath.replace(/\.note$/i, ".md");
}

export function buildSupernoteCompanionMarkdown(
  noteAbsPath: string,
  vaultPath: string,
): string {
  const name = noteAbsPath.split("/").pop() ?? "notebook.note";
  if (/[\r\n]/.test(name)) {
    throw new Error("Invalid notebook filename");
  }
  const rel = noteAbsPath.startsWith(`${vaultPath}/`)
    ? noteAbsPath.slice(vaultPath.length + 1)
    : name;
  if (/[\r\n]/.test(rel)) {
    throw new Error("Invalid notebook path");
  }
  return (
    `---\nsource_note: ${JSON.stringify(rel)}\ntype: supernote\n---\n\n` +
    `![[${name}]]\n\n## Notes\n\n`
  );
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
      await invoke<string>("get_file_content", { path: mdPath });
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
  const parent = notePath.substring(0, notePath.lastIndexOf("/"));
  if (parent) store.setActiveFolderPath(parent);

  try {
    const content = await invoke<string>("get_file_content", { path: mdPath });
    store.setActiveFile(mdPath, content);
    return;
  } catch {
    // Companion note missing — create it below.
  }

  try {
    const template = buildSupernoteCompanionMarkdown(notePath, vaultPath);
    await invoke("save_note", { path: mdPath, content: template });
    await store.refreshVault();
    store.setActiveFile(mdPath, template);
  } catch (err) {
    toastError(`Could not open notebook note: ${String(err)}`);
  }
}
