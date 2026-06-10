/** Central registry of application keyboard shortcuts (display + docs). */

export type KeybindingEntry = {
  id: string;
  label: string;
  /** macOS-style display, e.g. ⌘S */
  keys: string;
  category: "File" | "View" | "Editor" | "Search" | "AI" | "Navigation";
};

const mod = "⌘";

export const KEYBINDINGS: KeybindingEntry[] = [
  { id: "new-note", label: "New note", keys: `${mod}N`, category: "File" },
  { id: "new-folder", label: "New folder", keys: `${mod}⇧N`, category: "File" },
  { id: "open-vault", label: "Open vault", keys: `${mod}O`, category: "File" },
  { id: "save", label: "Save note", keys: `${mod}S`, category: "File" },
  { id: "daily-note", label: "Open daily note", keys: `${mod}D`, category: "File" },
  { id: "settings", label: "Open settings", keys: `${mod},`, category: "File" },
  { id: "toggle-sidebar", label: "Toggle sidebar", keys: `${mod}\\`, category: "View" },
  { id: "toggle-panel", label: "Toggle command center", keys: `${mod}⇧\\`, category: "View" },
  { id: "quick-switcher", label: "Quick switcher", keys: `${mod}P`, category: "Navigation" },
  { id: "vault-search", label: "Search vault", keys: `${mod}⇧F`, category: "Search" },
  { id: "find", label: "Find in note", keys: `${mod}F`, category: "Search" },
  { id: "find-replace", label: "Find and replace", keys: `${mod}R`, category: "Search" },
  { id: "bold", label: "Bold", keys: `${mod}B`, category: "Editor" },
  { id: "italic", label: "Italic", keys: `${mod}I`, category: "Editor" },
  { id: "indent", label: "Indent / list indent", keys: "Tab", category: "Editor" },
  { id: "outdent", label: "Outdent / list outdent", keys: "⇧Tab", category: "Editor" },
  { id: "follow-link", label: "Follow link (raw markdown)", keys: `${mod}+Click`, category: "Editor" },
  { id: "wikilink", label: "Open wikilink", keys: "Click", category: "Editor" },
  { id: "ai-run", label: "Run AI agent", keys: `${mod}↵`, category: "AI" },
];

export const KEYBINDING_CATEGORIES: KeybindingEntry["category"][] = [
  "File",
  "View",
  "Navigation",
  "Search",
  "Editor",
  "AI",
];
