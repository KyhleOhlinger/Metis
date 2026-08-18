/** Human-readable folder label for export destination summaries. */
export function folderDisplayName(path?: string): string {
  const trimmed = path?.trim();
  if (!trimmed) return "Not set";
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

export function jekyllExportDestinationLabel(blogRoot?: string): string {
  const trimmed = blogRoot?.trim();
  if (!trimmed) return "Not set";
  return `${folderDisplayName(trimmed)}/_posts/`;
}
