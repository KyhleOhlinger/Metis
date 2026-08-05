import { invoke } from "@tauri-apps/api/core";

// ── Daily Note helper ─────────────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD in local time. */
export function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function openOrCreateDailyNote(
  vaultPath: string,
  setActiveFile: (path: string, content: string) => void,
  refreshVault: () => Promise<void>,
): Promise<void> {
  const date = todayString();
  const dailyDir = `${vaultPath}/daily`;
  const notePath = `${dailyDir}/${date}.md`;

  // Try to open an existing note first
  try {
    const content = await invoke<string>("get_file_content", { path: notePath });
    setActiveFile(notePath, content);
    return;
  } catch {
    // Not found — create it below
  }

  // Ensure the /daily directory exists (ignore "already exists" errors)
  try {
    await invoke("create_folder", { parentPath: vaultPath, name: "daily" });
  } catch {
    // Already exists — fine
  }

  // Create the daily note with a starter template
  const template = `# ${date}\n\n## Tasks\n- [ ] \n\n## Notes\n\n`;
  await invoke("save_note", { path: notePath, content: template });
  await refreshVault();
  setActiveFile(notePath, template);
}
