/**
 * useMenuEvents
 *
 * Listens for the "menu-event" Tauri event (emitted by main.rs whenever the
 * user clicks a custom native menu item) and dispatches the corresponding
 * actions across the application.
 *
 * Architecture:
 *  • "open-vault" is handled directly here so we can implement multi-window
 *    logic (spawn a new window if a vault is already open in this one).
 *  • Other UI-owned actions (new note, new folder, new vault) are routed via
 *    `pendingMenuAction` in the Zustand store; the Sidebar component picks
 *    them up and clears the field after executing.
 *  • Stateless actions (save, reveal, tab switch, sidebar toggle) are
 *    executed directly using the store or invoke().
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useStore, VaultData } from "../store/useStore";
import { LAST_VAULT_KEY } from "../constants";

interface MenuEventHookOptions {
  /** Toggles the left file-tree sidebar */
  toggleSidebar: () => void;
  /** Toggles the right command-center panel */
  togglePanel: () => void;
  /** Opens / creates today's daily note */
  openDailyNote: () => void;
  /** Called when the opened vault is not a Metis vault, so App can show the conversion prompt */
  onForeignVault: (path: string, hint?: string) => void;
}

export function useMenuEvents({
  toggleSidebar,
  togglePanel,
  openDailyNote,
  onForeignVault,
}: MenuEventHookOptions) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    // The callback is async so we can await the folder-picker dialog for the
    // "open-vault" multi-window flow.
    listen<string>("menu-event", async (event) => {
      const action = event.payload;
      const store = useStore.getState();

      switch (action) {
        // ── Open vault — multi-window aware ──────────────────────────────────
        //
        // Rules:
        //  1. Same vault as currently open  → do nothing (already there)
        //  2. No vault open in this window   → load into current window
        //  3. Different vault + window busy  → spawn a new Metis window
        //
        // Uses the Rust `pick_folder` command (instead of the JS plugin) so the
        // native dialog is correctly parented to THIS window in multi-window setups.
        case "open-vault": {
          const selected = await invoke<string | null>("pick_folder");
          if (!selected) break;

          const currentVault = useStore.getState().vaultPath;

          // Rule 1 — same vault
          if (selected === currentVault) break;

          if (!currentVault) {
            // Rule 2 — no vault in this window, open here
            try {
              const data = await invoke<VaultData>("open_vault", { path: selected });
              useStore.getState().setVault(data);
              localStorage.setItem(LAST_VAULT_KEY, selected);
              // Surface conversion prompt for non-Metis vaults
              if (!data.is_metis_vault) {
                onForeignVault(data.path, data.vault_hint);
              }
            } catch (e) {
              console.error("[Metis] Failed to open vault:", e);
            }
          } else {
            // Rule 3 — different vault, spawn a new window
            invoke("open_vault_window", { vaultPath: selected }).catch(
              console.error,
            );
          }
          break;
        }

        // ── Delegated to Sidebar via pendingMenuAction ────────────────────────
        case "new-note":
        case "new-folder":
        case "new-vault":
          store.setPendingMenuAction(action);
          break;

        // ── Editor tab ───────────────────────────────────────────────────────
        case "source-mode":
          store.setEditorTab("source");
          break;
        case "visual-mode":
          store.setEditorTab("visual");
          break;

        // ── Pane visibility ──────────────────────────────────────────────────
        case "toggle-sidebar":
          toggleSidebar();
          break;
        case "toggle-panel":
          togglePanel();
          break;

        // ── Daily note ───────────────────────────────────────────────────────
        case "daily-note":
          openDailyNote();
          break;

        // ── Save current note ────────────────────────────────────────────────
        case "save": {
          const { activeFilePath, activeFileContent, markSaved } = store;
          if (!activeFilePath) break;
          invoke("save_note", { path: activeFilePath, content: activeFileContent })
            .then(() => markSaved())
            .catch(console.error);
          break;
        }

        // ── Reveal active file in Finder / Explorer ──────────────────────────
        case "reveal-in-finder": {
          const { activeFilePath, vaultPath } = store;
          if (!activeFilePath || !vaultPath) break;
          invoke("reveal_in_finder", { path: activeFilePath, vaultPath }).catch(
            console.error,
          );
          break;
        }

        // Note: open-docs / open-github / open-website are handled directly in
        // Rust's on_menu_event and never reach the frontend event bus.

        default:
          console.warn("[Metis] Unhandled menu action:", action);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
    // Callbacks are stable refs from App.tsx — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
