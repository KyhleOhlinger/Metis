/**
 * Resolves every relative `from "../…"` import under src/ and fails if the target
 * file does not exist. Catches wrong `../` depth after folder moves (e.g. commandCenter/).
 */
import fs from "fs";
import path from "path";

const SRC = path.resolve("src");
const EXT_TRY = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

function resolveImport(fromFile, spec) {
  const base = path.dirname(fromFile);
  const joined = path.normalize(path.join(base, spec));
  for (const suffix of EXT_TRY) {
    const candidate = joined + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

const files = walk(SRC);
const errors = [];

function resolveSpec(fromFile, spec) {
  if (spec.startsWith("@/")) {
    const joined = path.join(SRC, spec.slice(2));
    for (const suffix of EXT_TRY) {
      const candidate = joined + suffix;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
    return null;
  }
  if (!spec.startsWith(".")) return "skip";
  return resolveImport(fromFile, spec);
}

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
    const resolved = resolveSpec(file, spec);
    if (resolved === "skip") continue;
    if (!resolved) {
      errors.push(`${path.relative(process.cwd(), file)} → ${spec}`);
    }
  }
  for (const m of text.matchAll(/new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const base = path.dirname(file);
      const joined = path.normalize(path.join(base, spec));
      if (!fs.existsSync(joined)) {
        errors.push(`${path.relative(process.cwd(), file)} → new URL("${spec}")`);
      }
    }
  }
}

if (errors.length) {
  console.error("Unresolved relative imports:\n");
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log(`OK: ${files.length} files — all relative imports resolve.`);
