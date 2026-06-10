// ── Persona types ─────────────────────────────────────────────────────────────

/** @deprecated Legacy enum — used only when migrating old settings/personas. */
export type LegacyAIProvider = "openai" | "gemini" | "groq" | "perplexity";

/** How Metis talks to the endpoint (most providers use OpenAI-compatible chat). */
export type ProviderAdapter = "openai-compat" | "gemini-native";

/** User-configurable AI endpoint (Settings → API Providers). */
export interface AiProviderProfile {
  id: string;
  /** Display name, e.g. "Work Azure", "Anthropic", "Local Ollama". */
  name: string;
  /** OpenAI-compatible API root, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  /** Suggested model when creating a persona tied to this profile. */
  defaultModel?: string;
  /** Auto-inferred from URL when omitted. */
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

export type ExecutionScope =
  | { type: "current-file" }
  /** Dragged directly from the file tree — run on this file regardless of which note is open */
  | { type: "specific-file"; filePath: string }
  | { type: "specific-folder"; folderPath: string }
  | { type: "full-vault" };

// ── History ───────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  timestamp: number;
  personaId: string;
  scope: ExecutionScope;
  userMessage: string;
  response: string;
}

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
   * ID of the persona to use for this action.
   * `null` / `undefined` → use whichever persona is currently active.
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
  | "editor"
  | "sticky"
  | "hotkeys"
  | "ai"
  | "personas"
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
  /** Editor background preset id — matches `BG_PRESETS[].id`. */
  editorBgPresetId?: string;
  /** Defaults applied when inserting sticky notes from the toolbar or slash menu. */
  stickyDefaults?: StickyNoteDefaults;
}

export const DEFAULT_SETTINGS: Settings = {
  providerProfiles: [],
  defaultProviderProfileId: "preset-openai",
  allowedAiHosts: [],
  quickActions: DEFAULT_QUICK_ACTIONS,
  storeAiHistory: true,
  aiHistoryMaxResponseChars: 32_000,
  spellcheckLanguage: "en_US",
  spellcheckEnabled: false,
  editorBgPresetId: "dark",
  stickyDefaults: {
    float: "right",
    width: "12rem",
    color: "amber",
    includeWrapBlock: false,
  },
};

// ── Default personas shipped with the app ────────────────────────────────────

export const ICON_PRESETS = [
  "✍️","🔍","🧠","⚙️","📝","🎯","💡","🚀","📊","🗂️","🤖","⚡",
] as const;

/**
 * The Librarian persona ID — checked by AITab to unlock the orphan-analysis
 * client-side tool.  Must stay in sync with the persona definition below.
 */
export const LIBRARIAN_PERSONA_ID = "persona-librarian";
export const TASK_PERSONA_ID      = "persona-task";
/** Handwriting OCR — transcribes images in `handwritten/` to `.md` notes. */
export const HANDWRITING_OCR_PERSONA_ID = "persona-handwriting-ocr";

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
