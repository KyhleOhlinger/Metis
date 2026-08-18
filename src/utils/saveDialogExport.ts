import { invoke } from "@tauri-apps/api/core";

export const SAVE_DIALOG_EXPORT_LABEL = "Save dialog (you choose each time)";

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Native save dialog for text exports (CSV, JSON, etc.). Returns path or null if cancelled. */
export async function saveTextViaDialog(
  defaultName: string,
  extension: string,
  content: string,
): Promise<string | null> {
  const savePath = await invoke<string | null>("pick_save_path", {
    defaultName,
    extension,
    defaultDirectory: null,
  });
  if (!savePath) return null;

  await invoke("write_export_bytes", {
    path: savePath,
    dataBase64: textToBase64(content),
  });
  return savePath;
}
