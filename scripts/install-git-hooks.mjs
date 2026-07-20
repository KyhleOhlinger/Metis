/**
 * Point this repo at .githooks/ (pre-commit runs version:auto).
 * Safe to run repeatedly; no-op outside a git checkout.
 */
import { execSync } from "child_process";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");

try {
  execSync("git rev-parse --git-dir", { cwd: ROOT, stdio: "ignore" });
} catch {
  process.exit(0);
}

const hooksPath = path.join(ROOT, ".githooks");
execSync(`git config core.hooksPath "${hooksPath}"`, { cwd: ROOT });
console.log("install-git-hooks: core.hooksPath → .githooks");
