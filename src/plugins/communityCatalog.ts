/**
 * Official community plugin catalog from the Metis GitHub repo.
 * Installs only copy manifest.json + styles.css from this repository.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { assertSafeProviderUrl } from "@/utils/providerUrlSafety";
import { METIS_SOURCE_REPO } from "@/services/sourceUpdateCheck";
import type { CommunityCatalogEntry } from "./corePlugins";

const RAW_HOST = "raw.githubusercontent.com";
const BRANCHES = ["main", "master"] as const;
const MAX_CATALOG_BYTES = 65_536;
const MAX_FILE_BYTES = 262_144;

function catalogUrl(branch: string): string {
  return `https://${RAW_HOST}/${METIS_SOURCE_REPO}/${branch}/community-plugins.json`;
}

function pluginFileUrl(branch: string, pluginId: string, file: "manifest.json" | "styles.css"): string {
  return `https://${RAW_HOST}/${METIS_SOURCE_REPO}/${branch}/community-plugins/${pluginId}/${file}`;
}

function assertPinnedCatalogUrl(url: string, kind: "catalog" | "plugin"): void {
  assertSafeProviderUrl(url);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== RAW_HOST) {
    throw new Error("Plugin catalog refused: unexpected host");
  }
  const prefix = `/${METIS_SOURCE_REPO}/`;
  if (!parsed.pathname.startsWith(prefix)) {
    throw new Error("Plugin catalog refused: unexpected path");
  }
  if (kind === "catalog" && !parsed.pathname.endsWith("/community-plugins.json")) {
    throw new Error("Plugin catalog refused: unexpected file");
  }
  if (kind === "plugin") {
    const ok =
      /\/community-plugins\/[a-z][a-z0-9-]{1,62}\/(manifest\.json|styles\.css)$/.test(
        parsed.pathname,
      );
    if (!ok) throw new Error("Plugin package refused: unexpected file");
  }
}

function parseCatalog(body: string): CommunityCatalogEntry[] {
  if (body.length > MAX_CATALOG_BYTES) {
    throw new Error("Plugin catalog is unexpectedly large");
  }
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) {
    throw new Error("Plugin catalog must be a JSON array");
  }
  const out: CommunityCatalogEntry[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const author = typeof rec.author === "string" ? rec.author.trim() : "Unknown";
    const description = typeof rec.description === "string" ? rec.description.trim() : "";
    const repo = typeof rec.repo === "string" ? rec.repo.trim() : METIS_SOURCE_REPO;
    if (!id || !name) continue;
    if (repo !== METIS_SOURCE_REPO) continue;
    out.push({ id, name, author, description, repo });
  }
  return out;
}

async function getUserAgent(): Promise<string> {
  try {
    const v = (await invoke<string>("get_app_version")).trim();
    return `Metis/${v || "desktop"}`;
  } catch {
    return "Metis/desktop";
  }
}

async function getText(url: string, kind: "catalog" | "plugin"): Promise<string | null> {
  assertPinnedCatalogUrl(url, kind);
  const ua = await getUserAgent();
  const res = await tauriFetch(url, {
    method: "GET",
    headers: { Accept: "text/plain, application/json", "User-Agent": ua },
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) {
    throw new Error("Remote plugin file is too large");
  }
  return text;
}

export async function fetchCommunityCatalog(): Promise<CommunityCatalogEntry[]> {
  let lastError: unknown;
  for (const branch of BRANCHES) {
    try {
      const body = await getText(catalogUrl(branch), "catalog");
      if (body == null) {
        lastError = new Error(`GitHub returned no catalog on ${branch}`);
        continue;
      }
      return parseCatalog(body);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not load plugin catalog");
}

export async function fetchOfficialPluginFiles(
  pluginId: string,
): Promise<{ manifestJson: string; stylesCss: string | null }> {
  let lastError: unknown;
  for (const branch of BRANCHES) {
    try {
      const manifestJson = await getText(pluginFileUrl(branch, pluginId, "manifest.json"), "plugin");
      if (!manifestJson) {
        lastError = new Error(`No manifest for ${pluginId} on ${branch}`);
        continue;
      }
      const stylesCss = await getText(pluginFileUrl(branch, pluginId, "styles.css"), "plugin");
      return { manifestJson, stylesCss };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not download plugin");
}
