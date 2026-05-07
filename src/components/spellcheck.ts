import { linter, type Diagnostic, type Action } from "@codemirror/lint";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { invoke } from "@tauri-apps/api/core";

// Node types where spelling should NOT be checked.
const SKIP_NODE_TYPES = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "CodeText",
  "CodeMark",
  "CodeInfo",
  "URL",
  "Link",
  "LinkMark",
  "LinkLabel",
  "Image",
  "ImageMark",
  "HTMLTag",
  "HTMLBlock",
  "CommentBlock",
  "Frontmatter",
  "ProcessingInstruction",
]);

const ALWAYS_ALLOW = new Set([
  "metis", "todo", "ok", "url", "urls", "html", "css", "js", "ts",
  "api", "apis", "cli", "ui", "ux", "ai", "http", "https", "npm",
  "json", "yaml", "md", "pdf", "svg", "png", "jpg", "jpeg", "gif",
]);

const WORD_RE = /[a-zA-Z'\u2019]{2,}/g;

function buildSkipRanges(view: EditorView): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const tree = syntaxTree(view.state);

  tree.cursor().iterate((node) => {
    if (SKIP_NODE_TYPES.has(node.name)) {
      ranges.push([node.from, node.to]);
      return false;
    }
  });

  return ranges;
}

function isInSkipRange(pos: number, ranges: Array<[number, number]>): boolean {
  for (const [from, to] of ranges) {
    if (pos >= from && pos < to) return true;
    if (from > pos) break;
  }
  return false;
}

interface WordOccurrence {
  word: string;
  from: number;
  to: number;
}

function extractWords(view: EditorView): WordOccurrence[] {
  const text = view.state.doc.toString();
  const skipRanges = buildSkipRanges(view);
  skipRanges.sort((a, b) => a[0] - b[0]);

  const words: WordOccurrence[] = [];
  let match: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;

  while ((match = WORD_RE.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;

    if (isInSkipRange(from, skipRanges)) continue;

    const word = match[0];
    const clean = word.replace(/['\u2019]s$/i, "");

    if (clean.length < 2) continue;
    if (clean === clean.toUpperCase()) continue;
    if (ALWAYS_ALLOW.has(clean.toLowerCase())) continue;

    words.push({ word: clean, from, to });
  }

  return words;
}

// Per-language cache so switching dictionaries doesn't serve stale results.
let cachedLanguage = "";
const knownGood = new Set<string>();
const knownBad = new Set<string>();
const suggestionCache = new Map<string, string[]>();

function resetCacheIfLanguageChanged(language: string) {
  if (language !== cachedLanguage) {
    knownGood.clear();
    knownBad.clear();
    suggestionCache.clear();
    cachedLanguage = language;
  }
}

function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function buildActions(suggestions: string[]): Action[] {
  return suggestions.map((s) => ({
    name: s,
    apply(view: EditorView, from: number, to: number) {
      const original = view.state.doc.sliceString(from, to);
      view.dispatch({ changes: { from, to, insert: matchCase(original, s) } });
    },
  }));
}

/**
 * CodeMirror linter that checks spelling via the Tauri `check_spelling` command.
 * Uses Hunspell dictionaries (spellbook) on the Rust side.
 *
 * @param language  Hunspell language code, e.g. "en_US" or "en_GB".
 */
export function spellcheckLinter(language: string): Extension {
  return linter(
    async (view: EditorView): Promise<Diagnostic[]> => {
      resetCacheIfLanguageChanged(language);

      const occurrences = extractWords(view);
      if (occurrences.length === 0) return [];

      const uniqueWords = new Map<string, WordOccurrence[]>();
      for (const occ of occurrences) {
        const lower = occ.word.toLowerCase();
        if (knownGood.has(lower)) continue;
        const list = uniqueWords.get(lower);
        if (list) {
          list.push(occ);
        } else {
          uniqueWords.set(lower, [occ]);
        }
      }

      const toCheck: string[] = [];
      const alreadyBad: string[] = [];
      for (const word of uniqueWords.keys()) {
        if (knownBad.has(word)) {
          alreadyBad.push(word);
        } else {
          toCheck.push(word);
        }
      }

      let freshBad: string[] = [];
      if (toCheck.length > 0) {
        try {
          freshBad = await invoke<string[]>("check_spelling", {
            words: toCheck,
            language,
          });
        } catch {
          return [];
        }

        const freshBadSet = new Set(freshBad.map((w) => w.toLowerCase()));
        for (const word of toCheck) {
          if (freshBadSet.has(word.toLowerCase())) {
            knownBad.add(word.toLowerCase());
          } else {
            knownGood.add(word.toLowerCase());
          }
        }
      }

      const misspelled = new Set([
        ...alreadyBad,
        ...freshBad.map((w) => w.toLowerCase()),
      ]);

      if (misspelled.size === 0) return [];

      // Fetch suggestions for misspelled words not yet cached.
      const needSuggestions = [...misspelled].filter((w) => !suggestionCache.has(w));
      if (needSuggestions.length > 0) {
        try {
          const sugMap = await invoke<Record<string, string[]>>("suggest_spelling", {
            words: needSuggestions,
            language,
          });
          for (const [w, sug] of Object.entries(sugMap)) {
            suggestionCache.set(w.toLowerCase(), sug);
          }
        } catch {
          // Non-fatal: diagnostics still work, just without suggestions.
        }
      }

      const diagnostics: Diagnostic[] = [];
      for (const [lower, occs] of uniqueWords) {
        if (!misspelled.has(lower)) continue;
        const suggestions = suggestionCache.get(lower) ?? [];
        const actions = buildActions(suggestions);
        for (const occ of occs) {
          diagnostics.push({
            from: occ.from,
            to: occ.to,
            severity: "warning",
            message: suggestions.length > 0
              ? `"${occ.word}" — did you mean: ${suggestions.slice(0, 3).join(", ")}?`
              : `Possible misspelling: "${occ.word}"`,
            actions,
            source: "spellcheck",
          });
        }
      }

      return diagnostics;
    },
    {
      delay: 500,
    },
  );
}
