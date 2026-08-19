import type { KeyChord } from "@/utils/keyChord";

export type KeybindingCategory =
  | "File"
  | "View"
  | "Editor"
  | "Search"
  | "AI"
  | "Navigation";

export type KeybindingScope = "app" | "editor";

export type KeybindingCommandId =
  | "new-note"
  | "new-folder"
  | "open-vault"
  | "save"
  | "daily-note"
  | "settings"
  | "toggle-sidebar"
  | "toggle-panel"
  | "quick-switcher"
  | "vault-search"
  | "find"
  | "find-replace"
  | "bold"
  | "italic"
  | "indent"
  | "outdent"
  | "line-up"
  | "line-down"
  | "select-line"
  | "line-start"
  | "line-end"
  | "ai-run"
  | "agent-run-log";

export interface KeybindingDefinition {
  id: KeybindingCommandId;
  label: string;
  category: KeybindingCategory;
  scope: KeybindingScope;
  defaultChord: KeyChord;
  /** Platform-specific alternates (e.g. macOS-only chords). */
  extraDefaults?: KeyChord[];
  rebindable: boolean;
}

export const KEYBINDING_CATEGORIES: KeybindingCategory[] = [
  "File",
  "View",
  "Navigation",
  "Search",
  "Editor",
  "AI",
];

/** Display-only entries (not rebindable keyboard shortcuts). */
export const KEYBINDING_MOUSE_HINTS = [
  { id: "follow-link", label: "Follow link (raw markdown)", keys: "⌘+Click", category: "Editor" as const },
  { id: "wikilink", label: "Open wikilink", keys: "Click", category: "Editor" as const },
];

export const KEYBINDING_REGISTRY: KeybindingDefinition[] = [
  {
    id: "new-note",
    label: "New note",
    category: "File",
    scope: "app",
    defaultChord: { mod: true, key: "n" },
    rebindable: true,
  },
  {
    id: "new-folder",
    label: "New folder",
    category: "File",
    scope: "app",
    defaultChord: { mod: true, shift: true, key: "n" },
    rebindable: true,
  },
  {
    id: "open-vault",
    label: "Open vault",
    category: "File",
    scope: "app",
    defaultChord: { mod: true, key: "o" },
    rebindable: true,
  },
  {
    id: "save",
    label: "Save note",
    category: "File",
    scope: "editor",
    defaultChord: { mod: true, key: "s" },
    rebindable: true,
  },
  {
    id: "daily-note",
    label: "Open daily note",
    category: "File",
    scope: "app",
    defaultChord: { mod: true, key: "d" },
    rebindable: true,
  },
  {
    id: "settings",
    label: "Open settings",
    category: "File",
    scope: "app",
    defaultChord: { mod: true, key: "," },
    rebindable: true,
  },
  {
    id: "toggle-sidebar",
    label: "Toggle sidebar",
    category: "View",
    scope: "app",
    defaultChord: { mod: true, key: "\\" },
    rebindable: true,
  },
  {
    id: "toggle-panel",
    label: "Toggle command center",
    category: "View",
    scope: "app",
    defaultChord: { mod: true, shift: true, key: "\\" },
    rebindable: true,
  },
  {
    id: "quick-switcher",
    label: "Quick switcher",
    category: "Navigation",
    scope: "app",
    defaultChord: { mod: true, key: "p" },
    rebindable: true,
  },
  {
    id: "vault-search",
    label: "Search vault",
    category: "Search",
    scope: "app",
    defaultChord: { mod: true, shift: true, key: "f" },
    rebindable: true,
  },
  {
    id: "find",
    label: "Find in note",
    category: "Search",
    scope: "editor",
    defaultChord: { mod: true, key: "f" },
    rebindable: true,
  },
  {
    id: "find-replace",
    label: "Find and replace",
    category: "Search",
    scope: "editor",
    defaultChord: { mod: true, key: "r" },
    rebindable: true,
  },
  {
    id: "bold",
    label: "Bold",
    category: "Editor",
    scope: "editor",
    defaultChord: { mod: true, key: "b" },
    rebindable: true,
  },
  {
    id: "italic",
    label: "Italic",
    category: "Editor",
    scope: "editor",
    defaultChord: { mod: true, key: "i" },
    rebindable: true,
  },
  {
    id: "indent",
    label: "Indent / list indent",
    category: "Editor",
    scope: "editor",
    defaultChord: { key: "Tab" },
    rebindable: true,
  },
  {
    id: "outdent",
    label: "Outdent / list outdent",
    category: "Editor",
    scope: "editor",
    defaultChord: { shift: true, key: "Tab" },
    rebindable: true,
  },
  {
    id: "line-up",
    label: "Move / extend selection up one line",
    category: "Editor",
    scope: "editor",
    defaultChord: { key: "ArrowUp" },
    extraDefaults: [
      { mod: true, shift: true, key: "ArrowUp" },
    ],
    rebindable: true,
  },
  {
    id: "line-down",
    label: "Move / extend selection down one line",
    category: "Editor",
    scope: "editor",
    defaultChord: { key: "ArrowDown" },
    extraDefaults: [
      { mod: true, shift: true, key: "ArrowDown" },
    ],
    rebindable: true,
  },
  {
    id: "line-start",
    label: "Move / extend to line start",
    category: "Editor",
    scope: "editor",
    defaultChord: { mod: true, key: "ArrowLeft" },
    rebindable: true,
  },
  {
    id: "line-end",
    label: "Move / extend to line end",
    category: "Editor",
    scope: "editor",
    defaultChord: { mod: true, key: "ArrowRight" },
    rebindable: true,
  },
  {
    id: "select-line",
    label: "Select line",
    category: "Editor",
    scope: "editor",
    defaultChord: { mod: true, key: "l" },
    rebindable: true,
  },
  {
    id: "ai-run",
    label: "Run AI agent",
    category: "AI",
    scope: "app",
    defaultChord: { mod: true, key: "Enter" },
    rebindable: true,
  },
  {
    id: "agent-run-log",
    label: "Open agent run log",
    category: "AI",
    scope: "app",
    defaultChord: { mod: true, shift: true, key: "l" },
    rebindable: true,
  },
];

export const KEYBINDING_BY_ID = Object.fromEntries(
  KEYBINDING_REGISTRY.map((d) => [d.id, d]),
) as Record<KeybindingCommandId, KeybindingDefinition>;
