import { invoke } from "@tauri-apps/api/core";

const VAULT_READ_BATCH = 100;

/** Read one vault note. Throws when the file is missing or outside the vault. */
export async function loadVaultFile(path: string): Promise<string> {
  return invoke<string>("get_file_content", { path });
}

/**
 * Read up to 100 markdown paths in one IPC call.
 * SECURITY: Rust returns an empty string for a path that is not `.md`, outside the vault, or unreadable.
 */
export async function readVaultMarkdownBatch(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  if (paths.length > VAULT_READ_BATCH) {
    throw new Error(`At most ${VAULT_READ_BATCH} notes per read.`);
  }
  const bodies = await invoke<string[]>("get_file_contents_batch", { paths });
  return paths.map((_, j) => bodies[j] ?? "");
}

/** Read many notes, 100 per call. A failed batch comes back empty so one IPC error does not stop a scan. */
export async function loadVaultFiles(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < paths.length; i += VAULT_READ_BATCH) {
    const slice = paths.slice(i, i + VAULT_READ_BATCH);
    try {
      out.push(...(await readVaultMarkdownBatch(slice)));
    } catch {
      out.push(...slice.map(() => ""));
    }
  }
  return out;
}
