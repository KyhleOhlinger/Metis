import { invoke } from "@tauri-apps/api/core";
import { openVaultNotePath } from "@/utils/openVaultNote";

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
  refreshVault: () => Promise<void>,
): Promise<void> {
  const date = todayString();
  const dailyDir = `${vaultPath}/daily`;
  const notePath = `${dailyDir}/${date}.md`;

  if (await openVaultNotePath(notePath, { quiet: true })) return;

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
  await openVaultNotePath(notePath, { content: template });
}
