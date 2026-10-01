export type CorePluginId =
  | "file-explorer"
  | "command-palette"
  | "search"
  | "daily-notes"
  | "properties"
  | "backlinks"
  | "word-count"
  | "planner"
  | "calendar"
  | "calculator"
  | "sticky-notes"
  | "spellcheck"
  | "ai"
  | "task-manager"
  | "handwriting"
  | "export"
  | "supernote";

export interface CorePluginDef {
  id: CorePluginId;
  name: string;
  description: string;
  /** Always on — listed for parity with Obsidian, toggle disabled. */
  required?: boolean;
  /** When omitted from `.metis/core-plugins.json`. Default true. */
  defaultEnabled?: boolean;
}

export const CORE_PLUGINS: CorePluginDef[] = [
  {
    id: "file-explorer",
    name: "File explorer",
    description: "Sidebar file tree, Spaces, and note navigation.",
    required: true,
  },
  {
    id: "command-palette",
    name: "Command palette",
    description: "Quick switcher and > commands (⌘P).",
    required: true,
  },
  {
    id: "search",
    name: "Search",
    description: "Vault-wide search overlay on the file tree (⌘⇧F).",
  },
  {
    id: "daily-notes",
    name: "Daily notes",
    description: "Open or create today under daily/YYYY-MM-DD.md.",
  },
  {
    id: "properties",
    name: "Properties",
    description: "YAML frontmatter fields, tags, and extra keys in the metadata panel.",
  },
  {
    id: "backlinks",
    name: "Backlinks",
    description: "Incoming [[wikilinks]] in metadata (Source) and Visual mode.",
  },
  {
    id: "word-count",
    name: "Word count",
    description: "Words, lines, and characters on the Command Center Info tab.",
  },
  {
    id: "planner",
    name: "Planner",
    description: "Planner workspace, sidebar button, and Planner AI persona.",
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "Date picker on the editor toolbar.",
  },
  {
    id: "calculator",
    name: "Calculator",
    description: "Expression calculator on the editor toolbar.",
  },
  {
    id: "sticky-notes",
    name: "Sticky notes",
    description: "Insert sticky cards from the toolbar (existing stickies still render).",
  },
  {
    id: "spellcheck",
    name: "Spellcheck",
    description: "Hunspell linter and toolbar toggle. Still requires Spellcheck on in General.",
  },
  {
    id: "ai",
    name: "Command Center AI",
    description: "AI tab, custom personas, Librarian, and agent runs.",
  },
  {
    id: "task-manager",
    name: "Task Manager",
    description: "Task Manager system persona and todo.md Apply cards.",
  },
  {
    id: "handwriting",
    name: "Handwriting OCR",
    description: "Handwriting OCR persona for images in handwritten/.",
  },
  {
    id: "export",
    name: "Export",
    description: "PDF, Jekyll, and planner markdown export.",
  },
  {
    id: "supernote",
    name: "Supernote",
    description:
      "Pull Nomad files over Browse & Access into handwritten/Supernote/ as markdown notes with an embedded notebook. Sync icon is on the Supernote folder.",
    defaultEnabled: false,
  },
];

export const REQUIRED_CORE_PLUGIN_IDS = new Set<CorePluginId>(
  CORE_PLUGINS.filter((p) => p.required).map((p) => p.id),
);

export interface InstalledCommunityPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  hasStyles: boolean;
  hasUnsupportedJs: boolean;
}

export interface VaultPluginStateDto {
  restrictedMode: boolean;
  core: Record<string, boolean>;
  enabled: string[];
  installed: InstalledCommunityPlugin[];
}

export interface CommunityCatalogEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  repo?: string;
}

export function isCoreEnabled(core: Record<string, boolean>, id: CorePluginId): boolean {
  if (REQUIRED_CORE_PLUGIN_IDS.has(id)) return true;
  if (Object.prototype.hasOwnProperty.call(core, id)) return core[id] !== false;
  const def = CORE_PLUGINS.find((p) => p.id === id);
  return def?.defaultEnabled !== false;
}
