/** Collapse `.` / `..` segments; preserve leading `/` for absolute paths. */
export function normalizePosixPath(raw: string): string {
  const isAbs = raw.startsWith("/");
  const stack: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "..") stack.pop();
    else if (seg && seg !== ".") stack.push(seg);
  }
  return (isAbs ? "/" : "") + stack.join("/");
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePosixPath(a) === normalizePosixPath(b);
}

/** True when `abs` is the vault root or a path inside it. */
export function isPathWithinVault(abs: string, vaultPath: string): boolean {
  const normalized = normalizePosixPath(abs);
  return normalized === vaultPath || normalized.startsWith(`${vaultPath}/`);
}

/** Validate LLM-supplied vault-relative note paths before agent writes. */
export function sanitizeAgentNoteRelativePath(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!p) return null;
  const parts = p.split("/");
  for (const seg of parts) {
    if (!seg || seg === "." || seg === ".." || seg.startsWith(".")) return null;
  }
  const file = parts[parts.length - 1] ?? "";
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return `${p}.md`;
  if (file.slice(dot + 1).toLowerCase() !== "md") return null;
  return p;
}

/** `notes/plan.md` → `notes/plan 2.md`, used when create hits an existing note. */
export function agentNoteCopyPath(rel: string): string {
  return rel.replace(/\.md$/i, " 2.md");
}
