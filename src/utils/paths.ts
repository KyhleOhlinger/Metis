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
