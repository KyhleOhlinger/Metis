/**
 * Custom CodeMirror 6 extensions for the Metis editor.
 *
 * Exports:
 *   metisHighlightStyleDark  — syntax colours for dark editor backgrounds
 *   metisHighlightStyleLight — syntax colours for light (white / cream) backgrounds
 *   metisHighlightStyle      — alias for metisHighlightStyleDark (back-compat)
 *   codeBlockPlugin        — background + left-border on fenced code blocks
 *   copyButtonPlugin       — language badge + hover "Copy" button on fences
 *   calloutPlugin          — Obsidian-style > [!TYPE] callout block decoration
 *   createVisualModePlugin — live-preview dimming + inline image rendering
 *   markdownAutoComplete   — smart auto-close for ```, [], (), *, _ etc.
 *   taskListClickExtension — click `[ ]` / `[x]` to toggle task completion
 *   makeInlinePreviewExtension — inline images (+ reveal menu), GFM tables collapse to rendered preview when the caret is outside (click to edit), sticky drag-drop, click collapsed links / Cmd+Ctrl+click raw links (sticky fences raw in Source; rendered in Visual only)
 */


export {
  metisHighlightStyleDark,
  metisHighlightStyleLight,
  metisHighlightStyle,
  plannerAdaptiveHighlightStyle,
} from "./editor/extensions/highlightStyles";
export {
  codeBlockPlugin,
  copyButtonPlugin,
  calloutPlugin,
  createVisualModePlugin,
  markdownAutoComplete,
  wikilinkExtensions,
  taskListClickExtension,
  markdownLinkCollapseExtension,
  markdownCaretAtomicExtension,
  plannerMarkdownVisualExtensions,
  listContinuationKeymap,
  makeInlinePreviewExtension,
  smartPasteExtension,
  metisLineNumbers,
  hideFrontmatterField,
} from "./editor/extensions/editorPlugins";
