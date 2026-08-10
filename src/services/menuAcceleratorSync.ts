import { invoke } from "@tauri-apps/api/core";
import type { KeybindingCommandId } from "@/config/keybindingRegistry";
import type { Settings } from "@/types/persona";
import { chordToMenuAccelerator } from "@/utils/keyChord";
import { getChordsForCommand } from "@/services/keybindingRuntime";

/** Native menu item id → keybinding command id (items that show accelerators). */
export const MENU_ITEM_COMMAND_IDS: Record<string, KeybindingCommandId> = {
  open_settings: "settings",
  new_note: "new-note",
  new_folder: "new-folder",
  open_vault: "open-vault",
  save: "save",
  daily_note: "daily-note",
  toggle_sidebar: "toggle-sidebar",
  toggle_panel: "toggle-panel",
};

export function buildMenuAcceleratorMap(settings: Settings): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const [menuId, commandId] of Object.entries(MENU_ITEM_COMMAND_IDS)) {
    const chords = getChordsForCommand(commandId, settings);
    if (!chords.length) {
      map[menuId] = null;
      continue;
    }
    map[menuId] = chordToMenuAccelerator(chords[0]);
  }
  return map;
}

/** Push current hotkey overrides to the native menu bar accelerators. */
export async function syncMenuAccelerators(settings: Settings): Promise<void> {
  const accelerators = buildMenuAcceleratorMap(settings);
  try {
    await invoke("sync_menu_accelerators", { accelerators });
  } catch (err) {
    console.warn("[Metis] Could not sync menu accelerators:", err);
  }
}
