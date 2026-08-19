import { useEffect, useRef, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { toastError } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";
import { eventMatchesChord } from "@/utils/keyChord";
import { openAgentRunLog } from "@/utils/openAgentRunLog";
import { getChordsForCommand } from "@/services/keybindingRuntime";
import type { KeybindingCommandId } from "@/config/keybindingRegistry";

type LastPane = "sidebar" | "editor" | "cc";

interface Options {
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  lastPaneRef: RefObject<LastPane>;
  toggleSidebar: () => void;
  togglePanel: () => void;
  openDailyNote: () => void;
}

const APP_COMMAND_IDS: KeybindingCommandId[] = [
  "new-note",
  "new-folder",
  "open-vault",
  "save",
  "daily-note",
  "settings",
  "toggle-sidebar",
  "toggle-panel",
  "quick-switcher",
  "vault-search",
  "find",
  "agent-run-log",
];

function runAppCommand(id: KeybindingCommandId, opts: Options, event: KeyboardEvent): void {
  const store = useStore.getState();

  switch (id) {
    case "new-note":
      store.setPendingMenuAction("new-note");
      break;
    case "new-folder":
      store.setPendingMenuAction("new-folder");
      break;
    case "open-vault":
      store.setPendingMenuAction("open-vault-picker");
      break;
    case "save": {
      const active = document.activeElement;
      if (active?.closest(".cm-editor")) return;
      const { activeFilePath, activeFileContent, markSaved } = store;
      if (!activeFilePath) break;
      invoke("save_note", { path: activeFilePath, content: activeFileContent })
        .then(() => markSaved())
        .catch((err) => toastError(`Save failed: ${formatError(err)}`));
      break;
    }
    case "daily-note":
      opts.openDailyNote();
      break;
    case "settings": {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      usePersonaStore.getState().openSettings();
      break;
    }
    case "toggle-sidebar":
      opts.toggleSidebar();
      break;
    case "toggle-panel":
      opts.togglePanel();
      break;
    case "quick-switcher":
      opts.setPaletteOpen((v) => !v);
      break;
    case "vault-search": {
      if (!store.vaultPath) return;
      store.setSidebarView("search");
      if (!opts.sidebarOpen) opts.setSidebarOpen(true);
      break;
    }
    case "find": {
      const active = document.activeElement;
      if (active?.closest(".cm-editor") && store.editorTab === "source") return;
      if (opts.lastPaneRef.current === "sidebar" && store.vaultPath) {
        store.setSidebarView("search");
        if (!opts.sidebarOpen) opts.setSidebarOpen(true);
      }
      break;
    }
    case "agent-run-log":
      openAgentRunLog();
      break;
    default:
      break;
  }
}

/** App-wide shortcuts (non-editor commands and editor fallbacks when CM is not focused). */
export function useGlobalKeybindings(opts: Options) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const settings = usePersonaStore.getState().settings;

      for (const id of APP_COMMAND_IDS) {
        const chords = getChordsForCommand(id, settings);
        for (const chord of chords) {
          if (!eventMatchesChord(e, chord)) continue;
          e.preventDefault();
          runAppCommand(id, optsRef.current, e);
          return;
        }
      }

      if (e.key === "Escape") {
        optsRef.current.setPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
