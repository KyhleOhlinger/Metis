// ── Persona types ─────────────────────────────────────────────────────────────

/** @deprecated Legacy enum — used only when migrating old settings/personas. */
export type LegacyAIProvider = "openai" | "gemini" | "groq" | "perplexity";

/** @deprecated Migrated to `providerKind` — read-only for legacy settings.json. */
export type ProviderAdapter = "openai-compat" | "gemini-native";

/** Selects the Vercel AI SDK factory in `providerRegistry.ts`. */
export type ProviderKind =
  | "openai"
  | "google"
  | "anthropic"
  | "openai-compatible";

/** User-configurable AI endpoint (Settings → API Providers). */
export interface AiProviderProfile {
  id: string;
  /** Display name, e.g. "Work Azure", "Anthropic", "Local Ollama". */
  name: string;
  /** API root — OpenAI-compat `/v1`, Google `/v1beta`, or custom gateway URL. */
  baseUrl: string;
  apiKey: string;
  /** Suggested model when creating a persona tied to this profile. */
  defaultModel?: string;
  /** SDK wiring; inferred from preset id when omitted. */
  providerKind?: ProviderKind;
  /** @deprecated Use `providerKind`. */
  adapter?: ProviderAdapter;
}

export interface Persona {
  /** Stable UUID — never changes after creation */
  id: string;
  name: string;
  /** Emoji or short text used as the persona's visual icon */
  icon: string;
  /** Maps to the LLM's system message */
  systemPrompt: string;
  /** e.g. "gpt-4o", "claude-sonnet-4-20250514", "llama-3.3-70b-versatile" */
  model: string;
  /** References `settings.providerProfiles[].id` */
  providerProfileId: string;
  /**
   * When true the persona is hidden from the AI-tab chip bar.
   * It still exists in the store and can be re-enabled at any time.
   */
  disabled?: boolean;
}

// ── Execution scope ───────────────────────────────────────────────────────────

export type PlannerPeriod = "week" | "month";

export type ExecutionScope =
  | { type: "none" }
  | { type: "current-file" }
  /** Dragged directly from the file tree — run on this file regardless of which note is open */
  | { type: "specific-file"; filePath: string }
  | { type: "specific-folder"; folderPath: string }
  | { type: "full-vault" }
  /** Date-sliced slice of the vault's **active** planner (shared or vault mode). */
  | { type: "planner"; period?: PlannerPeriod; includeCurrentFile?: boolean };

export function isPlannerScope(
  scope: ExecutionScope,
): scope is Extract<ExecutionScope, { type: "planner" }> {
  return scope.type === "planner";
}

/** Vault notes attached when a selection quick action auto-runs. */
export type QuickActionScopeDefault = "none" | "persona";

// ── History ───────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  timestamp: number;
  personaId: string;
  scope: ExecutionScope;
  userMessage: string;
  response: string;
}

import type { KeyChord } from "@/utils/keyChord";
import type { KeybindingCommandId } from "@/config/keybindingRegistry";
import type { PlannerTab } from "@/planner/plannerTypes";

// ── Quick actions (floating selection toolbar) ────────────────────────────────

export interface QuickAction {
  /** Stable identifier */
  id: string;
  /** Label shown in the floating toolbar button */
  label: string;
  /**
   * Prompt sent to the agent.  `{text}` is replaced with the selected text.
   * For custom (Ask…) actions the template is just `{text}` — the user types
   * the actual instruction in the Command Center input.
   */
  promptTemplate: string;
  /** If true: open Command Center pre-filled but don't auto-run (Ask… style) */
  custom?: boolean;
  /** If true: offer the plain-text response as an inline insert after the selection */
  insertAfterSelection?: boolean;
  /**
   * Optional persona for this action. When unset, the active persona's prompt/model are used
   * but the API call goes through the default provider profile.
   */
  personaId?: string | null;
}

export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  {
    id: "improve",
    label: "✦ Improve",
    promptTemplate:
      "Improve the writing quality of the following text. " +
      "Return only the improved version, preserving markdown formatting:\n\n{text}",
  },
  {
    id: "summarize",
    label: "⊟ Summarise",
    promptTemplate: "Summarise the following in 2–3 concise sentences:\n\n{text}",
  },
  {
    id: "explain",
    label: "? Explain",
    promptTemplate:
      "Explain what the following means in plain language, " +
      "including any technical terms or jargon:\n\n{text}",
  },
  {
    id: "action-items",
    label: "☑ Actions",
    promptTemplate:
      "Extract a concise bullet-point list of action items from the following text. " +
      "Return only the bullet list — no preamble or explanation:\n\n{text}",
    insertAfterSelection: true,
  },
  {
    id: "ask",
    label: "✎ Ask…",
    promptTemplate: "{text}",
    custom: true,
  },
];

/** Default placement/size for newly inserted sticky notes. */
export interface StickyNoteDefaults {
  float?: "left" | "right" | "none";
  width?: string;
  color?: "amber" | "yellow" | "pink" | "blue" | "green" | "purple" | "slate";
  /** When true, toolbar/slash insert also adds a `:::stickywrap` block after the sticky. */
  includeWrapBlock?: boolean;
}

export type SettingsSectionId =
  | "general"
  | "planner"
  | "editor"
  | "sticky"
  | "hotkeys"
  | "plugins"
  | "ai"
  | "personas"
  | "export"
  | "about";

export interface Settings {
  /** All configured AI endpoints (built-in presets + user-added). */
  providerProfiles: AiProviderProfile[];
  /** Default profile when creating a new persona. */
  defaultProviderProfileId: string | null;
  /**
   * Hostnames derived from profile base URLs — synced on save for display and
   * preflight validation (HTTPS calls use a runtime-wide allow policy in Tauri).
   */
  allowedAiHosts: string[];
  /** Floating selection-toolbar actions — persisted so users can customise them */
  quickActions: QuickAction[];
  /**
   * Scope used when a selection quick action runs.
   * `none` — prompt only (No Selection). `persona` — keep the AI tab File/Folder/Vault/None picker.
   */
  quickActionScopeDefault?: QuickActionScopeDefault;
  /**
   * When false, new AI runs are not appended to the in-memory history list.
   * Existing entries remain until cleared or the app restarts.
   */
  storeAiHistory?: boolean;
  /**
   * Per-entry cap on stored assistant text (full-vault replies can be huge).
   * `0` means no limit. Default 32_000.
   */
  aiHistoryMaxResponseChars?: number;
  /**
   * Hunspell dictionary language code for the spellcheck linter (e.g. "en_US", "en_GB").
   * Must match a directory name under `resources/dictionaries/`.
   */
  spellcheckLanguage?: string;
  /** When true, the editor spellcheck linter is active. */
  spellcheckEnabled?: boolean;
  /** App theme preset id — built-in `BG_PRESETS[].id` or `custom`. */
  editorBgPresetId?: string;
  /** Background hex when `editorBgPresetId` is `custom`. */
  editorBgCustomColor?: string;
  /** Defaults applied when inserting sticky notes from the toolbar or slash menu. */
  stickyDefaults?: StickyNoteDefaults;
  /** Absolute path to the Jekyll/Chirpy blog repository (e.g. `*.github.io`). */
  jekyllBlogRoot?: string;
  /** Chirpy `author` frontmatter field. */
  jekyllAuthor?: string;
  /** Default Chirpy `categories` when the note has no `tags`. */
  jekyllDefaultCategories?: string[];
  /** Subfolder under `assets/img/` for copied images. */
  jekyllImageSubfolder?: string;
  /** Blog site URL for wikilink → post URL conversion. */
  jekyllSiteUrl?: string;
  /** Chirpy `description` boilerplate for exported posts. */
  jekyllDescription?: string;
  /**
   * Per-command shortcut overrides. `null` disables a command's shortcuts.
   * Omitted ids use registry defaults.
   */
  keybindingOverrides?: Partial<Record<KeybindingCommandId, KeyChord | null>>;
  /** Per-vault pinned and recently opened note paths (absolute). */
  vaultNoteNavigation?: Record<string, VaultNoteNavigation>;
  /**
   * Planner tabs omitted from AI context. Empty (default) = send every section.
   */
  plannerAiExcludedSections?: PlannerTab[];
  /**
   * When false, skip automatic GitHub source version checks (launch, daily, focus).
   * Default true — Metis never downloads installers; this only compares `package.json` versions.
   */
  sourceUpdateCheckEnabled?: boolean;
  /** Latest GitHub semver the user dismissed; banner returns when GitHub is newer. */
  sourceUpdateDismissedVersion?: string;
  /** Nomad Browse & Access IPv4 (no port). */
  supernoteDeviceIp?: string;
  /** Browse & Access port. Default 8089. */
  supernoteDevicePort?: number;
  /** Auto-pull interval in minutes while Metis is open. Default 15. 0 = manual only. */
  supernoteSyncIntervalMinutes?: number;
}

export interface VaultNoteNavigation {
  pinned: string[];
  recent: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  providerProfiles: [],
  defaultProviderProfileId: "preset-openai",
  allowedAiHosts: [],
  quickActions: DEFAULT_QUICK_ACTIONS,
  quickActionScopeDefault: "none",
  storeAiHistory: true,
  aiHistoryMaxResponseChars: 32_000,
  spellcheckLanguage: "en_US",
  spellcheckEnabled: false,
  editorBgPresetId: "dark",
  editorBgCustomColor: "#16171a",
  sourceUpdateCheckEnabled: true,
  plannerAiExcludedSections: [],
  stickyDefaults: {
    float: "right",
    width: "12rem",
    color: "amber",
    includeWrapBlock: false,
  },
  supernoteDeviceIp: "",
  supernoteDevicePort: 8089,
  supernoteSyncIntervalMinutes: 15,
};

// ── Default personas shipped with the app ────────────────────────────────────

export const ICON_PRESETS = [
  "✍️","🔍","🧠","⚙️","📝","🎯","💡","🚀","📊","🗂️","🤖","⚡","📅",
] as const;

/**
 * The Librarian persona ID — checked by AITab to unlock the orphan-analysis
 * client-side tool.  Must stay in sync with the persona definition below.
 */
export const LIBRARIAN_PERSONA_ID = "persona-librarian";
export const TASK_PERSONA_ID      = "persona-task";
/** Handwriting OCR — transcribes images in `handwritten/` to `.md` notes. */
export const HANDWRITING_OCR_PERSONA_ID = "persona-handwriting-ocr";
/** Planner briefing / review drafts from the active planner (date-sliced). */
export const PLANNER_PERSONA_ID = "persona-planner";

export const DEFAULT_PERSONAS: Persona[] = [
  {
    id: "persona-librarian",
    name: "The Librarian",
    icon: "📚",
    model: "gpt-4o",
    providerProfileId: "preset-openai",
    systemPrompt:
      "You are The Librarian, a structural intelligence embedded in a personal notes vault. " +
      "Your job is to maintain the health of the knowledge graph. " +
      "When given a list of notes and their link relationships, you identify orphaned notes " +
      "(those with no incoming or outgoing [[wikilinks]]) and suggest specific [[wikilinks]] " +
      "that would connect them meaningfully to existing notes. " +
      "Format your report as Markdown with these exact sections:\n\n" +
      "## Orphaned Notes\n" +
      "A numbered list of orphaned notes with their path.\n\n" +
      "## Suggested Links\n" +
      "For each orphaned note, suggest 1–3 specific wikilinks with a one-line rationale. " +
      "Use the exact note name inside [[ ]] so the user can paste the link directly.\n\n" +
      "## Summary\n" +
      "One paragraph on the overall graph health and priority actions.\n\n" +
      "Be concise. Do not hallucinate note names — only reference notes that appear in the provided list.",
  },
  {
    id: HANDWRITING_OCR_PERSONA_ID,
    name: "Handwriting OCR",
    icon: "📷",
    model: "gpt-4o",
    providerProfileId: "preset-openai",
    systemPrompt:
      "You are a handwriting transcription specialist. " +
      "You read photographs of handwritten notes and convert them into clean, accurate Markdown. " +
      "Preserve headings, lists, and tables when visible. " +
      "Use [?] for uncertain words. " +
      "Return only the transcribed text — no commentary or wrappers.",
  },
  {
    id: "persona-task",
    name: "Task Manager",
    icon: "✅",
    model: "gpt-4o",
    providerProfileId: "preset-openai",
    systemPrompt:
      "You are a Task Manager embedded in a personal notes vault. " +
      "You receive a structured list of open tasks extracted from every note, " +
      "each annotated with its source file. " +
      "Produce a clean, well-organised `todo.md` file. " +
      "Rules:\n" +
      "- Start with a YAML frontmatter block: `---\\ndate: <today>\\nstatus: in-progress\\n---`\n" +
      "- Add a `## Overview` section: total open tasks, grouped count per note.\n" +
      "- For each source note that has tasks, add `## [[Note Name]]` as a heading " +
      "  followed by the tasks as Markdown checkboxes: `- [ ] task text (source: [[Note Name]])`.\n" +
      "- Due dates are optional and may appear inline as `(due: YYYY-MM-DD)`; preserve them exactly if present.\n" +
      "- Preserve the exact wording of every task — do not paraphrase.\n" +
      "- Include ONLY incomplete tasks (`[ ]`). Never include checked tasks (`[x]` or `[X]`).\n" +
      "- If a note has no open tasks, omit it entirely.\n" +
      "Output ONLY the raw Markdown content. No preamble or explanation.",
  },
  {
    id: PLANNER_PERSONA_ID,
    name: "Planner",
    icon: "📅",
    model: "gpt-4o",
    providerProfileId: "preset-openai",
    systemPrompt:
      "You are a Planner assistant embedded in Metis. " +
      "You receive markdown from the user's **active** planner " +
      "(shared profile-wide or vault-local — the header says which), covering every tab " +
      "unless the header lists Settings exclusions. " +
      "Rules:\n" +
      "- Use only what appears in the context (Daily Log, weekly/monthly reviews, Reviews, Goals, Templates, PTO & Events).\n" +
      "- Never invent meetings, PTO, trips, or accomplishments.\n" +
      "- If a day or section is empty, say so.\n" +
      "- Briefings: concise, dated, with 3 next actions.\n" +
      "- Review drafts: paste-ready Markdown for the Weekly or Monthly Review cell; no preamble.\n" +
      "Respond in Markdown.",
  },
  {
    id: "persona-writer",
    name: "Writer",
    icon: "✍️",
    model: "gpt-4o",
    providerProfileId: "preset-openai",
    systemPrompt:
      "You are an expert writing assistant embedded in a personal notes application. " +
      "Help the user improve clarity, structure, and tone of their notes. " +
      "Be concise. Respond in plain Markdown.",
  },
  {
    id: "persona-analyst",
    name: "Analyst",
    icon: "🔍",
    model: "gpt-4o",
    providerProfileId: "preset-openai",
    systemPrompt:
      "You are a sharp analytical assistant. Summarise, extract key insights, " +
      "identify patterns, and answer questions about the provided context. " +
      "Structure your response with headers when useful.",
  },
  {
    id: "persona-researcher",
    name: "Researcher",
    icon: "🧠",
    model: "gpt-4o",
    providerProfileId: "preset-openai",
    systemPrompt:
      "You are a research assistant helping connect ideas across notes. " +
      "Find relationships, suggest follow-up questions, and surface related concepts. " +
      "Use Markdown formatting.",
  },
  {
    id: "persona-coder",
    name: "Coder",
    icon: "⚙️",
    model: "gpt-4o",
    providerProfileId: "preset-openai",
    systemPrompt:
      "You are a senior software engineer. Help the user understand, write, debug, " +
      "or improve code found in their notes. Use fenced code blocks with language tags.",
  },
];
