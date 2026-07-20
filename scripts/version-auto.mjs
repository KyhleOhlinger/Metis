/**
 * Idempotent version bump driven by specs/CHANGELOG.md.
 *
 * When the top changelog heading changes, bumps semver (default: patch).
 * Optional bump hint on the heading line:
 *   ## [2026-07-20 16:58] minor
 *   ## [2026-07-20 16:58] (major)
 *
 * Skipped when METIS_SKIP_VERSION_AUTO=1.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHANGELOG = path.join(ROOT, "specs", "CHANGELOG.md");
const STATE = path.join(ROOT, "specs", ".version-state.json");

if (process.env.METIS_SKIP_VERSION_AUTO === "1") {
  process.exit(0);
}

const HEADING_RE =
  /^## \[(.+?)\](?:\s+(?:\(|)(patch|minor|major)(?:\)|))?\s*$/im;

function readLatestChangelogHeading() {
  const text = fs.readFileSync(CHANGELOG, "utf8");
  const match = text.match(HEADING_RE);
  if (!match) {
    console.error("version-auto: no changelog heading found in specs/CHANGELOG.md");
    process.exit(1);
  }
  const line = match[0].trim();
  const bump = (match[2] ?? "patch").toLowerCase();
  return { line, bump };
}

function readState() {
  if (!fs.existsSync(STATE)) return null;
  return JSON.parse(fs.readFileSync(STATE, "utf8"));
}

function writeState(line) {
  fs.writeFileSync(STATE, `${JSON.stringify({ lastChangelogHeading: line }, null, 2)}\n`);
}

const latest = readLatestChangelogHeading();
const state = readState();

if (state?.lastChangelogHeading === latest.line) {
  process.exit(0);
}

execSync(`node scripts/bump-version.mjs ${latest.bump}`, {
  cwd: ROOT,
  stdio: "inherit",
});
writeState(latest.line);
console.log(`version-auto: processed ${latest.line} → ${latest.bump} bump`);
