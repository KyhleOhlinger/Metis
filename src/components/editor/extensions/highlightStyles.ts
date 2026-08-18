/** Syntax highlighting themes for Metis editor and planner. */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  SYNTAX_PALETTE_DARK,
  SYNTAX_PALETTE_LIGHT,
  type SyntaxPalette,
} from "@/utils/themeColors";

const MONO_FONT = '"JetBrains Mono","Fira Code",monospace';

export function buildMetisHighlightStyle(palette: SyntaxPalette) {
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.heading1, fontSize: "1.6em", fontWeight: "700", color: palette.heading1 },
      { tag: tags.heading2, fontSize: "1.35em", fontWeight: "700", color: palette.heading2 },
      { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600", color: palette.heading3 },
      { tag: tags.heading4, fontSize: "1.05em", fontWeight: "600", color: palette.heading4 },
      { tag: tags.heading, fontWeight: "600", color: palette.heading },
      { tag: tags.strong, fontWeight: "700", color: palette.strong },
      { tag: tags.emphasis, fontStyle: "italic", color: palette.emphasis },
      { tag: tags.strikethrough, textDecoration: "line-through", color: palette.strikethrough },
      { tag: tags.link, color: palette.link, textDecoration: "underline" },
      { tag: tags.url, color: palette.url },
      {
        tag: tags.monospace,
        fontFamily: MONO_FONT,
        color: palette.monospace,
        fontSize: "0.88em",
      },
      { tag: tags.processingInstruction, color: palette.processingInstruction },
      { tag: tags.punctuation, color: palette.punctuation },
      { tag: tags.keyword, color: palette.keyword },
      { tag: tags.controlKeyword, color: palette.controlKeyword },
      { tag: tags.definitionKeyword, color: palette.definitionKeyword },
      { tag: tags.string, color: palette.string },
      { tag: tags.special(tags.string), color: palette.stringSpecial },
      { tag: tags.number, color: palette.number },
      { tag: tags.bool, color: palette.bool },
      { tag: tags.null, color: palette.null },
      { tag: tags.operator, color: palette.operator },
      { tag: tags.function(tags.variableName), color: palette.functionVar },
      { tag: tags.function(tags.propertyName), color: palette.functionProp },
      { tag: tags.typeName, color: palette.typeName },
      { tag: tags.className, color: palette.className },
      { tag: tags.propertyName, color: palette.propertyName },
      { tag: tags.attributeName, color: palette.attributeName },
      { tag: tags.attributeValue, color: palette.attributeValue },
      { tag: tags.lineComment, color: palette.lineComment, fontStyle: "italic" },
      { tag: tags.blockComment, color: palette.blockComment, fontStyle: "italic" },
      { tag: tags.meta, color: palette.meta },
      { tag: tags.invalid, color: palette.invalid, textDecoration: "underline" },
    ]),
  );
}

export const metisHighlightStyleDark = buildMetisHighlightStyle(SYNTAX_PALETTE_DARK);
export const metisHighlightStyleLight = buildMetisHighlightStyle(SYNTAX_PALETTE_LIGHT);

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
      fontFamily: MONO_FONT,
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
