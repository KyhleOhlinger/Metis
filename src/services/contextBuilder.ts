/**
 * contextBuilder.ts — Smart, token-aware context assembly for AI personas.
 *
 * Context is built in three tiers to avoid exceeding model limits:
 *
 *   1. DIRECT   — content fits within the model's usable context window.
 *                 All files are sent as-is.
 *
 *   2. TF-IDF   — content exceeds the budget but a relevance filter is
 *                 sufficient.  Files are scored against the user's query by
 *                 term-frequency, and only the highest-scoring ones are sent.
 *
 *   3. SCOUT    — content is very large (> 5 × budget).  A fast non-streaming
 *                 LLM call picks filenames from titles + previews (except
 *                 Gemini: scout is skipped — that provider often 429s on two
 *                 quick calls; we use TF-IDF only for the large-vault path).
 *
 * For single-file scope the pipeline is bypassed entirely.
 *
 * SECURITY: All path resolution is done on the Rust side.  TypeScript only
 * passes paths it received from the Rust `get_file_summaries` response,
 * so no path-traversal is possible from this layer.
 */

import { invoke } from "@tauri-apps/api/core";
import type { AiProviderProfile, Persona, ExecutionScope } from "../types/persona";
import { createAIClient, curatedSmallModelId } from "./aiService";
import { generateGeminiNativeContent, profileUsesGeminiNative } from "./geminiNative";

// ── Model context limits ──────────────────────────────────────────────────────
// Approximate token context windows for common models. Unknown ids use
// `inferContextTokens` so new long-context models are not capped at 8 k.

const MODEL_CONTEXT_TOKENS: Record<string, number> = {
  // OpenAI
  "gpt-4o":                128_000,
  "gpt-4o-mini":           128_000,
  "gpt-4-turbo":           128_000,
  "gpt-4":                   8_192,
  "gpt-3.5-turbo":          16_385,
  "gpt-3.5-turbo-16k":      16_385,
  // Google Gemini (OpenAI-compat endpoint)
  "gemini-2.0-flash":    1_000_000,
  "gemini-2.5-pro-exp-03-25": 1_000_000,
  "gemini-2.0-pro-exp":  1_000_000,
  "gemini-1.5-pro":      1_000_000,
  "gemini-1.5-flash":    1_000_000,
  "gemini-pro":             32_760,
  // Groq / Llama
  "llama3-70b-8192":         8_192,
  "llama3-8b-8192":          8_192,
  "llama-3.1-70b-versatile": 128_000,
  "llama-3.1-8b-instant":    128_000,
  "llama-3.3-70b-versatile": 128_000,
  "gemma2-9b-it":            8_192,
  "mixtral-8x7b-32768":      32_768,
  // Perplexity sonar family (online models with real-time search)
  "sonar":                   127_072,
  "sonar-pro":               200_000,
  "sonar-reasoning":         127_072,
  "sonar-reasoning-pro":     127_072,
  "sonar-deep-research":     127_072,
};

/** When the model id is not in the table, infer a reasonable window from naming patterns. */
function inferContextTokens(model: string): number {
  const k = model.toLowerCase().trim();
  const exact = MODEL_CONTEXT_TOKENS[k];
  if (exact !== undefined) return exact;

  if (/gemini/.test(k)) return 1_000_000;
  if (/sonar-deep-research|sonar-reasoning-pro|sonar-pro/.test(k)) return 200_000;
  if (/sonar|perplexity|pplx-/.test(k)) return 127_072;
  if (/claude-3|claude-4|claude-opus|claude-sonnet|claude-haiku/.test(k)) return 200_000;
  if (/gpt-4o|gpt-4\.1|gpt-5|(^|[^a-z])o[134]([^a-z]|$)|chatgpt-4o/.test(k)) return 128_000;
  if (/gpt-4-turbo|gpt-4-0125|gpt-4-1106/.test(k)) return 128_000;
  if (/gpt-4-32k/.test(k)) return 32_768;
  if (/^gpt-4[^o]/.test(k)) return 8_192;
  if (/gpt-3\.5/.test(k)) return 16_385;
  if (/llama|mixtral|gemma|qwen|mistral|deepseek/.test(k)) return 128_000;

  return 32_768;
}

// Reserve 25 % for response + system-prompt overhead; ~4 chars ≈ 1 token.
const USABLE_FRACTION = 0.75;
const CHARS_PER_TOKEN = 4;

function charBudget(model: string, overheadChars = 0): number {
  const tokens = inferContextTokens(model);
  const usable = Math.floor(tokens * USABLE_FRACTION * CHARS_PER_TOKEN);
  return Math.max(0, usable - overheadChars);
}

// ── Public types ──────────────────────────────────────────────────────────────

export type ContextStrategy =
  | { type: "single-file"; chars: number }
  | { type: "direct"; files: number; chars: number }
  | { type: "tfidf"; total: number; selected: number; chars: number }
  | { type: "scout"; scanned: number; selected: number; chars: number };

export interface SmartContextResult {
  context: string;
  strategy: ContextStrategy;
}

// ── Rust invocation types ─────────────────────────────────────────────────────

interface FileSummary {
  path: string;
  name: string;
  preview: string;
  char_count: number;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Build the context string for an AI call, choosing the cheapest strategy
 * that keeps the total payload within the model's usable token window.
 *
 * @param scope            What the user scoped the run to
 * @param userMessage      The user's question / instruction
 * @param persona          Active persona (supplies model identifier)
 * @param profile          Configured API provider profile (URL + key)
 * @param activeFileContent Content of the currently open file
 * @param vaultPath        Absolute path of the open vault
 * @param onStatus         Optional progress reporter (shown in the UI)
 */
export async function buildSmartContext(
  scope: ExecutionScope,
  userMessage: string,
  persona: Persona,
  profile: AiProviderProfile,
  activeFileContent: string,
  vaultPath: string | null,
  onStatus?: (msg: string) => void,
): Promise<SmartContextResult> {
  // ── Single-file scope — bypass all tiering ──────────────────────────────
  if (scope.type === "current-file") {
    const content = activeFileContent || "(empty note)";
    return {
      context: content,
      strategy: { type: "single-file", chars: content.length },
    };
  }

  // ── Specific-file scope (drag-to-persona) — read the file directly ───────
  if (scope.type === "specific-file") {
    onStatus?.(`Reading ${scope.filePath.split("/").pop() ?? "note"}…`);
    let content: string;
    try {
      content = await invoke<string>("get_file_content", { path: scope.filePath });
    } catch {
      content = "(could not read file)";
    }
    return {
      context: content || "(empty note)",
      strategy: { type: "single-file", chars: content.length },
    };
  }

  // ── Resolve folder path ─────────────────────────────────────────────────
  const folderPath =
    scope.type === "specific-folder"
      ? scope.folderPath
      : vaultPath ?? "";

  if (!folderPath) {
    return { context: "(no vault open)", strategy: { type: "direct", files: 0, chars: 0 } };
  }

  // ── Fetch summaries (fast — metadata only, no full content yet) ─────────
  const recursive = scope.type === "full-vault";
  onStatus?.(`Scanning notes in ${folderPath.split("/").pop() ?? "vault"}…`);

  let summaries: FileSummary[];
  try {
    summaries = await invoke<FileSummary[]>("get_file_summaries", {
      folderPath,
      recursive,
    });
  } catch (e) {
    throw new Error(`Failed to scan folder: ${String(e)}`);
  }

  if (summaries.length === 0) {
    return { context: "(no notes found)", strategy: { type: "direct", files: 0, chars: 0 } };
  }

  const totalChars = summaries.reduce((s, f) => s + f.char_count, 0);
  const overhead = persona.systemPrompt.length + userMessage.length + 500;
  const budget = charBudget(persona.model, overhead);

  // ── Tier 1: DIRECT — everything fits ───────────────────────────────────
  if (totalChars <= budget) {
    onStatus?.(`Loading ${summaries.length} note${summaries.length !== 1 ? "s" : ""}…`);
    const context = await fetchContent(summaries.map((s) => s.path));
    return {
      context,
      strategy: { type: "direct", files: summaries.length, chars: context.length },
    };
  }

  // ── Tier 2: TF-IDF — moderate overflow, keyword scoring sufficient ──────
  // Use 5× (not 3×) before scout so we send fewer extra API calls; strict
  // provider RPM limits often allow a single curl but not scout + chat.
  if (totalChars <= budget * 5) {
    onStatus?.(`Filtering ${summaries.length} notes by relevance…`);
    const ranked = scoreByRelevance(summaries, userMessage);
    const selected = pickByBudget(ranked, budget);
    onStatus?.(`Loading ${selected.length} of ${summaries.length} relevant notes…`);
    const context = await fetchContent(selected.map((s) => s.path));
    return {
      context,
      strategy: {
        type: "tfidf",
        total: summaries.length,
        selected: selected.length,
        chars: context.length,
      },
    };
  }

  // ── Gemini, large vault: never call scout LLM ───────────────────────────
  // Google AI Studio / Gemini free tiers frequently return HTTP 429 when Metis
  // sends scout + main chat back-to-back; a single curl only hits one call.
  // Use the same TF-IDF + budget pick as tier 2, over the full ranked list.
  if (profileUsesGeminiNative(profile)) {
    onStatus?.(`Large vault — selecting notes by relevance (Gemini skips scout to avoid rate limits)…`);
    const ranked = scoreByRelevance(summaries, userMessage);
    const selected = pickByBudget(ranked, budget);
    onStatus?.(`Loading ${selected.length} of ${summaries.length} notes…`);
    const context = await fetchContent(selected.map((s) => s.path));
    return {
      context,
      strategy: {
        type: "tfidf",
        total: summaries.length,
        selected: selected.length,
        chars: context.length,
      },
    };
  }

  // ── Tier 3: SCOUT — very large corpus, let the LLM pick ────────────────
  // Pre-filter with TF-IDF first so the scout prompt itself stays small
  // (max 60 candidates × ~350 char preview ≈ ~21 k chars for the scout call).
  const MAX_SCOUT_CANDIDATES = 60;
  onStatus?.(`Pre-filtering ${summaries.length} notes…`);
  const candidates = scoreByRelevance(summaries, userMessage).slice(0, MAX_SCOUT_CANDIDATES);
  onStatus?.(`AI scout scanning ${candidates.length} candidate notes…`);

  const selectedNames = await runScout(candidates, userMessage, persona, profile);
  const selectedPaths = resolvePaths(candidates, selectedNames);

  if (selectedPaths.length === 0) {
    // Scout returned nothing useful — fall back to top TF-IDF picks
    const fallback = pickByBudget(candidates, budget);
    const context = await fetchContent(fallback.map((s) => s.path));
    return {
      context,
      strategy: {
        type: "scout",
        scanned: candidates.length,
        selected: fallback.length,
        chars: context.length,
      },
    };
  }

  onStatus?.(`Loading ${selectedPaths.length} note${selectedPaths.length !== 1 ? "s" : ""} selected by scout…`);
  const context = await fetchContent(selectedPaths);
  return {
    context,
    strategy: {
      type: "scout",
      scanned: candidates.length,
      selected: selectedPaths.length,
      chars: context.length,
    },
  };
}

// ── TF-IDF relevance scoring ──────────────────────────────────────────────────

/**
 * Score files against the user's query using term frequency over the file
 * name + preview.  Stopwords are removed.  Returns files sorted descending
 * by score (highest relevance first).
 */
function scoreByRelevance(files: FileSummary[], query: string): FileSummary[] {
  const queryTerms = tokenise(query);
  if (queryTerms.size === 0) return files; // no signal — keep original order

  // IDF: log(N / df) where df = number of docs containing the term
  const N = files.length;
  const df: Map<string, number> = new Map();
  for (const f of files) {
    for (const t of tokenise(f.name + " " + f.preview)) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const scored = files.map((f) => {
    const docTerms = tokenise(f.name + " " + f.preview);
    const docLen = Math.max(docTerms.size, 1);
    let score = 0;
    for (const qt of queryTerms) {
      if (!docTerms.has(qt)) continue;
      // TF: normalised by unique-term count of the document
      const tf = 1 / docLen;
      // IDF: boost rare terms
      const idf = Math.log(N / ((df.get(qt) ?? 0) + 1) + 1);
      score += tf * idf;
    }
    return { file: f, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.file);
}

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

// Lightweight English stopword list
const STOPWORDS = new Set([
  "the","and","for","are","but","not","you","all","can","had","her","was","one",
  "our","out","day","get","has","him","his","how","its","let","may","new","now",
  "old","see","two","who","boy","did","man","big","few","use","way","she","too",
  "any","from","they","this","that","have","with","been","more","than","then",
  "into","about","would","could","their","there","which","what","will","when",
  "here","some","like","just","over","such","your","time","also","only",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Pick files in relevance order until the char budget is exhausted. */
function pickByBudget(ranked: FileSummary[], budget: number): FileSummary[] {
  const selected: FileSummary[] = [];
  let used = 0;
  for (const f of ranked) {
    if (used + f.char_count > budget) break;
    selected.push(f);
    used += f.char_count;
  }
  // Always include at least 1 file even if it alone exceeds budget
  if (selected.length === 0 && ranked.length > 0) selected.push(ranked[0]);
  return selected;
}

/** Fetch and concatenate full content of a list of file paths. */
async function fetchContent(paths: string[]): Promise<string> {
  if (paths.length === 0) return "(no files selected)";
  return invoke<string>("get_files_content", { paths });
}

/** Match scout-returned filenames back to full paths from the candidate list. */
function resolvePaths(candidates: FileSummary[], names: string[]): string[] {
  const nameSet = new Set(names.map((n) => n.toLowerCase().trim()));
  return candidates
    .filter((c) => nameSet.has(c.name.toLowerCase()))
    .map((c) => c.path);
}

// ── Scout LLM call ────────────────────────────────────────────────────────────

const SCOUT_SYSTEM_PROMPT =
  "You are an intelligent file selector for a personal notes app. " +
  "Given a user task and a directory listing, respond with ONLY a JSON array " +
  "of the note filenames (including .md extension) that are most relevant to " +
  "completing the task. Select between 1 and 8 files. " +
  'Example: ["meeting-notes.md", "project-plan.md"]';

/**
 * Make a fast, non-streaming LLM call to select relevant filenames.
 * Returns an array of bare filenames (e.g. "meeting-notes.md").
 * Uses the same OpenAI client factory as chat streaming (Tauri fetch in prod).
 * Scout always uses a small curated model for the persona's provider — not the
 * user's main persona model — to limit cost/latency on huge vaults.
 */
async function runScout(
  candidates: FileSummary[],
  userMessage: string,
  _persona: Persona,
  profile: AiProviderProfile,
): Promise<string[]> {
  const scoutModel = curatedSmallModelId(profile);

  // Build a compact directory listing for the scout prompt
  const listing = candidates
    .map((f) => `**${f.name}** (${f.char_count} chars)\n${f.preview.slice(0, 250).trim()}`)
    .join("\n\n---\n\n");

  const userPrompt =
    `Task: ${userMessage}\n\nAvailable notes:\n\n${listing}\n\n` +
    "Return a JSON array of the filenames most relevant to this task.";

  if (profileUsesGeminiNative(profile)) {
    try {
      const raw = await generateGeminiNativeContent(
        profile,
        scoutModel,
        SCOUT_SYSTEM_PROMPT,
        userPrompt,
        new AbortController().signal,
        256,
      );
      return parseFilenameList(raw);
    } catch (e) {
      console.warn("[Metis] Gemini native scout failed:", e);
      return [];
    }
  }

  const client = createAIClient(profile);

  try {
    const resp = await client.chat.completions.create({
      model: scoutModel,
      messages: [
        { role: "system", content: SCOUT_SYSTEM_PROMPT },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 256,
      stream: false,
    });

    const raw = resp.choices[0]?.message?.content ?? "";
    return parseFilenameList(raw);
  } catch (e) {
    console.warn("[Metis] Scout call failed:", e);
    return [];
  }
}

/**
 * Robustly extract a list of filenames from various LLM response formats:
 * - Clean JSON array
 * - JSON inside a markdown code fence
 * - Bullet list (- filename.md)
 * - Comma-separated list
 */
function parseFilenameList(raw: string): string[] {
  // Try: code block containing JSON
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
  const candidate = (fenceMatch?.[1] ?? raw).trim();

  // Try: JSON array
  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((x): x is string => typeof x === "string" && x.endsWith(".md"))
          .slice(0, 20);
      }
    } catch { /* fall through */ }
  }

  // Try: bullet list or line-by-line (- note.md or * note.md)
  const lineMatches = raw.match(/[\w\s-]+\.md/gi);
  if (lineMatches) return [...new Set(lineMatches)].slice(0, 20);

  return [];
}

// ── Strategy label helper (for UI display) ────────────────────────────────────

export function strategyLabel(s: ContextStrategy): string {
  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  switch (s.type) {
    case "single-file":
      return `📄 Current file · ${fmt(s.chars)} chars`;
    case "direct":
      return `📂 ${s.files} file${s.files !== 1 ? "s" : ""} · ${fmt(s.chars)} chars`;
    case "tfidf":
      return `🔍 ${s.selected} of ${s.total} notes (relevance filter) · ${fmt(s.chars)} chars`;
    case "scout":
      return `🔭 ${s.selected} of ${s.scanned} notes (AI scout) · ${fmt(s.chars)} chars`;
  }
}
