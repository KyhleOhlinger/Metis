/**
 * Compare the running app version to `package.json` on GitHub.
 *
 * Metis never ships installers. This is a source-only check: GET the public
 * package.json from a pinned GitHub path, parse semver, and tell the UI if
 * GitHub is ahead. No vault content or credentials are sent.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";

export const METIS_SOURCE_OWNER = "KyhleOhlinger";
export const METIS_SOURCE_REPO_NAME = "Metis";
export const METIS_SOURCE_REPO = `${METIS_SOURCE_OWNER}/${METIS_SOURCE_REPO_NAME}`;
export const METIS_SOURCE_URL = `https://github.com/${METIS_SOURCE_REPO}`;

const RAW_HOST = "raw.githubusercontent.com";
const BRANCHES = ["main", "master"] as const;
const MAX_PACKAGE_JSON_BYTES = 32_768;

export type SourceUpdateResult = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  sourceUrl: string;
};

function parseSemver(value: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative if `a` is older than `b`. Zero if equal or unparsable. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function packageJsonUrl(branch: string): string {
  return `https://${RAW_HOST}/${METIS_SOURCE_REPO}/${branch}/package.json`;
}

/** SECURITY: only GET our own public package.json on GitHub raw. */
function assertPinnedPackageJsonUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Update check refused: not HTTPS");
  }
  if (parsed.hostname !== RAW_HOST) {
    throw new Error("Update check refused: unexpected host");
  }
  const prefix = `/${METIS_SOURCE_REPO}/`;
  if (!parsed.pathname.startsWith(prefix) || !parsed.pathname.endsWith("/package.json")) {
    throw new Error("Update check refused: unexpected path");
  }
}

function versionFromPackageJson(body: string): string {
  if (body.length > MAX_PACKAGE_JSON_BYTES) {
    throw new Error("Remote package.json is unexpectedly large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error("Remote package.json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Remote package.json is not an object");
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || !parseSemver(version)) {
    throw new Error("Remote package.json has no valid version");
  }
  return version.trim().replace(/^v/, "");
}

async function fetchRemoteVersion(localVersion: string): Promise<string> {
  let lastError: unknown;
  for (const branch of BRANCHES) {
    const url = packageJsonUrl(branch);
    assertPinnedPackageJsonUrl(url);
    try {
      const res = await tauriFetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": `Metis/${localVersion}`,
        },
      });
      if (!res.ok) {
        lastError = new Error(`GitHub returned ${res.status} for ${branch}`);
        continue;
      }
      return versionFromPackageJson(await res.text());
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not read GitHub package.json");
}

export async function checkSourceUpdate(): Promise<SourceUpdateResult> {
  const currentVersion = (await invoke<string>("get_app_version")).trim().replace(/^v/, "");
  const latestVersion = await fetchRemoteVersion(currentVersion || "desktop");
  return {
    currentVersion: currentVersion || "unknown",
    latestVersion,
    updateAvailable: compareSemver(currentVersion, latestVersion) < 0,
    sourceUrl: METIS_SOURCE_URL,
  };
}
