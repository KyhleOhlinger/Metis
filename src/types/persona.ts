// ── Persona types ─────────────────────────────────────────────────────────────

export type AIProvider = "openai" | "gemini" | "groq" | "perplexity";

export interface Persona {
  /** Stable UUID — never changes after creation */
  id: string;
  name: string;
  /** Emoji or short text used as the persona's visual icon */
  icon: string;
  /** Maps to the LLM's system message */
  systemPrompt: string;
  /** e.g. "gpt-4o", "gemini-1.5-pro", "llama3-70b-8192" */
  model: string;
  /** Which API endpoint family to use */
  provider: AIProvider;
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

// ── Settings ──────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  apiKey: string;
  /** Custom base URL (e.g. a local proxy or self-hosted endpoint) */
  baseUrl?: string;
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

export interface Settings {
  providers: Partial<Record<AIProvider, ProviderConfig>>;
  /** The provider selected by default when creating new personas */
  defaultProvider: AIProvider;
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
}

export const DEFAULT_SETTINGS: Settings = {
  providers: {},
  defaultProvider: "openai",
  quickActions: DEFAULT_QUICK_ACTIONS,
  storeAiHistory: true,
  aiHistoryMaxResponseChars: 32_000,
  spellcheckLanguage: "en_US",
};

// ── Default personas shipped with the app ────────────────────────────────────

// ── Shared UI constants ───────────────────────────────────────────────────────
// Defined here (the canonical types module) so every component that renders
// persona/provider UI can import from one place instead of duplicating them.

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  groq: "Groq",
  perplexity: "Perplexity AI",
};

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4o",
  gemini: "gemini-flash-latest",
  groq: "llama3-70b-8192",
  // sonar-pro supports real-time web search with a 200k context window
  perplexity: "sonar-pro",
};

export const ICON_PRESETS = [
  "✍️","🔍","🧠","⚙️","📝","🎯","💡","🚀","📊","🗂️","🤖","⚡",
] as const;

/**
 * The Librarian persona ID — checked by AITab to unlock the orphan-analysis
 * client-side tool.  Must stay in sync with the persona definition below.
 */
export const LIBRARIAN_PERSONA_ID = "persona-librarian";
export const TASK_PERSONA_ID      = "persona-task";

export const DEFAULT_PERSONAS: Persona[] = [
  {
    id: "persona-librarian",
    name: "The Librarian",
    icon: "📚",
    model: "gpt-4o",
    provider: "openai",
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
    id: "persona-task",
    name: "Task Manager",
    icon: "✅",
    model: "gpt-4o",
    provider: "openai",
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
    provider: "openai",
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
    provider: "openai",
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
    provider: "openai",
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
    provider: "openai",
    systemPrompt:
      "You are a senior software engineer. Help the user understand, write, debug, " +
      "or improve code found in their notes. Use fenced code blocks with language tags.",
  },
];
