/**
 * Bump semver in package.json and sync to all version manifests.
 * Usage: node scripts/bump-version.mjs patch|minor|major
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const kind = process.argv[2];
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("Usage: node scripts/bump-version.mjs <patch|minor|major>");
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, "..");
const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split("-")[0].split(".").map(Number);

const next =
  kind === "major"
    ? `${major + 1}.0.0`
    : kind === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

pkg.version = next;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
execSync("node scripts/sync-version.mjs", { cwd: ROOT, stdio: "inherit" });
execSync("npm install --package-lock-only", { cwd: ROOT, stdio: "inherit" });
console.log(`bump-version: ${kind} → v${next}`);
