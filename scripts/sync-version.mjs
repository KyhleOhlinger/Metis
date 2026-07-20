/**
 * Sync app version from package.json (canonical) to Tauri + Rust manifests.
 * Run via `npm run version:sync` or automatically after `version:bump:*`.
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(VERSION)) {
  console.error(`sync-version: invalid semver in package.json: ${VERSION}`);
  process.exit(1);
}

function updateCargoToml() {
  const file = path.join(ROOT, "src-tauri", "Cargo.toml");
  const next = fs.readFileSync(file, "utf8").replace(/^version = ".*"$/m, `version = "${VERSION}"`);
  fs.writeFileSync(file, next);
}

function updateTauriConf() {
  const file = path.join(ROOT, "src-tauri", "tauri.conf.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.version = VERSION;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function updateCargoLock() {
  const file = path.join(ROOT, "src-tauri", "Cargo.lock");
  let text = fs.readFileSync(file, "utf8");
  const block = /(\[\[package\]\]\nname = "metis"\nversion = )"[^"]+"/;
  if (!block.test(text)) {
    console.error("sync-version: could not find metis package in Cargo.lock");
    process.exit(1);
  }
  text = text.replace(block, `$1"${VERSION}"`);
  fs.writeFileSync(file, text);
}

updateCargoToml();
updateTauriConf();
updateCargoLock();
console.log(`sync-version: synced v${VERSION} → Cargo.toml, tauri.conf.json, Cargo.lock`);
