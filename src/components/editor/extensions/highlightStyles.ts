/** Syntax highlighting themes for Metis editor and planner. */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// ── 1. Highlight styles (dark vs light editor backgrounds) ──────────────────

export const metisHighlightStyleDark = syntaxHighlighting(
  HighlightStyle.define([
    // Headings — scaled sizes for visual hierarchy
    { tag: tags.heading1, fontSize: "1.6em", fontWeight: "700", color: "#f1f5f9" },
    { tag: tags.heading2, fontSize: "1.35em", fontWeight: "700", color: "#e2e8f0" },
    { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600", color: "#e2e8f0" },
    { tag: tags.heading4, fontSize: "1.05em", fontWeight: "600", color: "#cbd5e1" },
    { tag: tags.heading, fontWeight: "600", color: "#cbd5e1" },
    // Prose formatting
    { tag: tags.strong, fontWeight: "700", color: "#f1f5f9" },
    { tag: tags.emphasis, fontStyle: "italic", color: "#e2e8f0" },
    { tag: tags.strikethrough, textDecoration: "line-through", color: "#64748b" },
    // Links — consistent blue + underline (matches Visual preview styling)
    { tag: tags.link, color: "#60a5fa", textDecoration: "underline" },
    { tag: tags.url, color: "#3b82f6" },
    // Inline code
    {
      tag: tags.monospace,
      fontFamily: '"JetBrains Mono","Fira Code",monospace',
      color: "#a78bfa",
      fontSize: "0.88em",
    },
    // Markdown punctuation (##, **, _, etc.) — slightly muted
    { tag: tags.processingInstruction, color: "#475569" },
    { tag: tags.punctuation, color: "#64748b" },
    // Code tokens inside fenced blocks
    { tag: tags.keyword, color: "#c084fc" },
    { tag: tags.controlKeyword, color: "#f472b6" },
    { tag: tags.definitionKeyword, color: "#f472b6" },
    { tag: tags.string, color: "#86efac" },
    { tag: tags.special(tags.string), color: "#6ee7b7" },
    { tag: tags.number, color: "#fb923c" },
    { tag: tags.bool, color: "#f87171" },
    { tag: tags.null, color: "#f87171" },
    { tag: tags.operator, color: "#94a3b8" },
    { tag: tags.function(tags.variableName), color: "#60a5fa" },
    { tag: tags.function(tags.propertyName), color: "#93c5fd" },
    { tag: tags.typeName, color: "#34d399" },
    { tag: tags.className, color: "#34d399" },
    { tag: tags.propertyName, color: "#93c5fd" },
    { tag: tags.attributeName, color: "#fbbf24" },
    { tag: tags.attributeValue, color: "#86efac" },
    { tag: tags.lineComment, color: "#475569", fontStyle: "italic" },
    { tag: tags.blockComment, color: "#475569", fontStyle: "italic" },
    { tag: tags.meta, color: "#64748b" },
    { tag: tags.invalid, color: "#ef4444", textDecoration: "underline" },
  ]),
);

/** Readable on white / cream — paired with `data-color-scheme="light"` in CSS. */
export const metisHighlightStyleLight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading1, fontSize: "1.6em", fontWeight: "700", color: "#0f172a" },
    { tag: tags.heading2, fontSize: "1.35em", fontWeight: "700", color: "#1e293b" },
    { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600", color: "#334155" },
    { tag: tags.heading4, fontSize: "1.05em", fontWeight: "600", color: "#475569" },
    { tag: tags.heading, fontWeight: "600", color: "#475569" },
    { tag: tags.strong, fontWeight: "700", color: "#0f172a" },
    { tag: tags.emphasis, fontStyle: "italic", color: "#334155" },
    { tag: tags.strikethrough, textDecoration: "line-through", color: "#94a3b8" },
    { tag: tags.link, color: "#2563eb", textDecoration: "underline" },
    { tag: tags.url, color: "#1d4ed8" },
    {
      tag: tags.monospace,
      fontFamily: '"JetBrains Mono","Fira Code",monospace',
      color: "#5b21b6",
      fontSize: "0.88em",
    },
    { tag: tags.processingInstruction, color: "#94a3b8" },
    { tag: tags.punctuation, color: "#64748b" },
    { tag: tags.keyword, color: "#7c3aed" },
    { tag: tags.controlKeyword, color: "#db2777" },
    { tag: tags.definitionKeyword, color: "#db2777" },
    { tag: tags.string, color: "#047857" },
    { tag: tags.special(tags.string), color: "#0f766e" },
    { tag: tags.number, color: "#c2410c" },
    { tag: tags.bool, color: "#dc2626" },
    { tag: tags.null, color: "#dc2626" },
    { tag: tags.operator, color: "#475569" },
    { tag: tags.function(tags.variableName), color: "#2563eb" },
    { tag: tags.function(tags.propertyName), color: "#1d4ed8" },
    { tag: tags.typeName, color: "#047857" },
    { tag: tags.className, color: "#047857" },
    { tag: tags.propertyName, color: "#1d4ed8" },
    { tag: tags.attributeName, color: "#b45309" },
    { tag: tags.attributeValue, color: "#047857" },
    { tag: tags.lineComment, color: "#64748b", fontStyle: "italic" },
    { tag: tags.blockComment, color: "#64748b", fontStyle: "italic" },
    { tag: tags.meta, color: "#94a3b8" },
    { tag: tags.invalid, color: "#dc2626", textDecoration: "underline" },
  ]),
);

/** Alias for `metisHighlightStyleDark` (existing imports). */
export const metisHighlightStyle = metisHighlightStyleDark;

/**
 * Planner cells inherit `--planner-text-*` from `.planner-theme`. Prose tokens use
 * those CSS variables so bold/headings stay readable on light and dark presets.
 */
export const plannerAdaptiveHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading1, fontSize: "1.35em", fontWeight: "700", color: "var(--planner-text-primary)" },
    { tag: tags.heading2, fontSize: "1.2em", fontWeight: "700", color: "var(--planner-text-primary)" },
    { tag: tags.heading3, fontSize: "1.1em", fontWeight: "600", color: "var(--planner-text-primary)" },
    { tag: tags.heading4, fontSize: "1.05em", fontWeight: "600", color: "var(--planner-text-secondary)" },
    { tag: tags.heading, fontWeight: "600", color: "var(--planner-text-secondary)" },
    { tag: tags.strong, fontWeight: "700", color: "var(--planner-text-primary)" },
    { tag: tags.emphasis, fontStyle: "italic", color: "var(--planner-text-secondary)" },
    { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--planner-text-muted)" },
    { tag: tags.link, color: "#60a5fa", textDecoration: "underline" },
    { tag: tags.url, color: "#3b82f6" },
    {
      tag: tags.monospace,
      fontFamily: '"JetBrains Mono","Fira Code",monospace',
      color: "#a78bfa",
      fontSize: "0.88em",
    },
    { tag: tags.processingInstruction, color: "var(--planner-text-muted)" },
    { tag: tags.punctuation, color: "var(--planner-text-muted)" },
    { tag: tags.keyword, color: "#c084fc" },
    { tag: tags.controlKeyword, color: "#f472b6" },
    { tag: tags.definitionKeyword, color: "#f472b6" },
    { tag: tags.string, color: "#86efac" },
    { tag: tags.special(tags.string), color: "#6ee7b7" },
    { tag: tags.number, color: "#fb923c" },
    { tag: tags.bool, color: "#f87171" },
    { tag: tags.null, color: "#f87171" },
    { tag: tags.operator, color: "#94a3b8" },
    { tag: tags.function(tags.variableName), color: "#60a5fa" },
    { tag: tags.function(tags.propertyName), color: "#93c5fd" },
    { tag: tags.typeName, color: "#34d399" },
    { tag: tags.className, color: "#34d399" },
    { tag: tags.propertyName, color: "#93c5fd" },
    { tag: tags.attributeName, color: "#fbbf24" },
    { tag: tags.attributeValue, color: "#86efac" },
    { tag: tags.lineComment, color: "var(--planner-text-muted)", fontStyle: "italic" },
    { tag: tags.blockComment, color: "var(--planner-text-muted)", fontStyle: "italic" },
    { tag: tags.meta, color: "var(--planner-text-muted)" },
    { tag: tags.invalid, color: "#ef4444", textDecoration: "underline" },
  ]),
);

