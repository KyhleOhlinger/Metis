// ── Content merge helpers ─────────────────────────────────────────────────────

/** Regex matching a YAML frontmatter block at the start of a document. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Insert `chunk` after the YAML frontmatter AND the H1 title (if present).
 *
 * Insertion order in the resulting file:
 *   1. YAML frontmatter  (--- … ---)
 *   2. H1 heading        (# Title)   ← kept at the top
 *   3. Inserted chunk                 ← agent content goes here
 *   4. Rest of the original body
 */
export function insertAfterFrontmatter(existing: string, chunk: string): string {
  // Strip frontmatter first to get the body
  const fmMatch = existing.match(FRONTMATTER_RE);
  const fmEnd = fmMatch ? fmMatch[0].length : 0;
  const body = existing.slice(fmEnd);

  // Check whether the body starts with an H1 heading (optional leading blank line)
  const h1Match = body.match(/^[ \t]*\n*(# [^\n]*\n?)/);
  if (h1Match) {
    const afterH1 = fmEnd + h1Match[0].length;
    return (
      existing.slice(0, afterH1).trimEnd() +
      "\n\n" + chunk + "\n\n" +
      existing.slice(afterH1).trimStart()
    );
  }

  // No H1 — insert right after frontmatter (or at the very start)
  if (fmEnd > 0) {
    return existing.slice(0, fmEnd).trimEnd() + "\n\n" + chunk + "\n\n" + body.trimStart();
  }
  return chunk + "\n\n" + existing;
}

/** Append `chunk` at the end of the document, separated by a blank line. */
export function appendToEnd(existing: string, chunk: string): string {
  return existing.trimEnd() + "\n\n" + chunk;
}

/**
 * Insert `chunk` after the line that contains `offset`.
 * Inserting after the whole line (rather than mid-character) keeps the
 * surrounding prose intact and produces clean, readable markdown.
 */
export function insertAtOffset(existing: string, offset: number, chunk: string): string {
  const safeOffset = Math.min(Math.max(0, offset), existing.length);
  // Scan forward to find the end of the current line
  const lineEnd = existing.indexOf("\n", safeOffset);
  const insertPos = lineEnd === -1 ? existing.length : lineEnd;
  return (
    existing.slice(0, insertPos) +
    "\n\n" + chunk.trimEnd() +
    "\n" + existing.slice(insertPos)
  );
}

