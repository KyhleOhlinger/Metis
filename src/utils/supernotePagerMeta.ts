import { invoke } from "@tauri-apps/api/core";

export type SupernoteFileSyncMeta = {
  pulledAtMs: number;
  deviceDate?: string | null;
};

const LAST_SHOWN_PREFIX = "metis.supernote.lastShown:";
const LAST_SHOWN_CAP = 200;

function lastShownKey(filePath: string): string {
  return `${LAST_SHOWN_PREFIX}${filePath}`;
}

export function readLastShownMs(filePath: string): number | null {
  try {
    const raw = localStorage.getItem(lastShownKey(filePath));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function markLastShownNow(filePath: string): number {
  const now = Date.now();
  try {
    localStorage.setItem(lastShownKey(filePath), String(now));
    pruneLastShownKeys();
  } catch {
    /* quota / private mode */
  }
  return now;
}

function pruneLastShownKeys() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LAST_SHOWN_PREFIX)) keys.push(k);
  }
  if (keys.length <= LAST_SHOWN_CAP) return;
  const ranked = keys
    .map((k) => ({ k, t: Number(localStorage.getItem(k) ?? 0) }))
    .sort((a, b) => a.t - b.t);
  const drop = ranked.length - LAST_SHOWN_CAP;
  for (let i = 0; i < drop; i++) {
    localStorage.removeItem(ranked[i].k);
  }
}

export function formatSyncClock(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function formatPagerCaption(
  meta: SupernoteFileSyncMeta | null,
  lastShownMs: number | null,
): string {
  const nomad = meta?.deviceDate?.trim() || "—";
  const synced = formatSyncClock(meta?.pulledAtMs);
  const shown = formatSyncClock(lastShownMs);
  return `Nomad ${nomad} · Last sync ${synced} · Last shown ${shown}`;
}

export async function fetchSupernoteSyncMeta(
  filePath: string,
): Promise<SupernoteFileSyncMeta | null> {
  try {
    const dto = await invoke<SupernoteFileSyncMeta | null>("get_supernote_sync_meta", {
      path: filePath,
    });
    return dto ?? null;
  } catch {
    return null;
  }
}
