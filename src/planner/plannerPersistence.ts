/**
 * Disk-backed planner persistence. Files live in `<vault>/.metis/planner/`.
 */

import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";

export type PlannerFileKey =
  | "manifest.json"
  | "templates.json"
  | "layout-templates.json"
  | "goals.json"
  | "reviews.json"
  | "field-heights.json";

export interface PlannerConfig {
  active_dir: string;
}

const LEGACY_LOCAL_STORAGE_MAP: Record<PlannerFileKey, string> = {
  "manifest.json": "metis_daily_task_view_v1",
  "templates.json": "metis_daily_task_templates_v1",
  "layout-templates.json": "metis_planner_layout_templates_v1",
  "goals.json": "metis_planner_goals_v1",
  "reviews.json": "metis_planner_reviews_v1",
  "field-heights.json": "metis_planner_field_heights_v1",
};

let activeVaultPath: string | null = null;
let ready = false;
let initGeneration = 0;
const cache = new Map<PlannerFileKey, string | null>();
const dirtyFiles = new Set<PlannerFileKey>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let savedResetTimer: ReturnType<typeof setTimeout> | null = null;
let flushChain: Promise<void> = Promise.resolve();

function setPlannerSyncStatus(
  status: "idle" | "pending" | "saving" | "syncing" | "saved" | "error",
  error?: string | null,
) {
  useStore.getState().setPlannerSyncStatus(status, error ?? null);
  if (status === "saved") {
    if (savedResetTimer) clearTimeout(savedResetTimer);
    savedResetTimer = setTimeout(() => {
      if (useStore.getState().plannerSyncStatus === "saved") {
        setPlannerSyncStatus("idle");
      }
      savedResetTimer = null;
    }, 2000);
  }
}

function enqueueFlush(task: () => Promise<void>): Promise<void> {
  flushChain = flushChain.then(task, task);
  return flushChain;
}

function allFileKeys(): PlannerFileKey[] {
  return Object.keys(LEGACY_LOCAL_STORAGE_MAP) as PlannerFileKey[];
}

function readLegacyLocalStorage(key: PlannerFileKey): string | null {
  const legacyKey = LEGACY_LOCAL_STORAGE_MAP[key];
  try {
    return localStorage.getItem(legacyKey);
  } catch {
    return null;
  }
}

function clearLegacyLocalStorage(): void {
  for (const legacyKey of Object.values(LEGACY_LOCAL_STORAGE_MAP)) {
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      // ignore
    }
  }
}

/** One IPC call prepares the vault planner and returns each requested file (null when missing). */
export async function loadPlannerFileMap(
  vaultPath: string,
  fileKeys: PlannerFileKey[],
): Promise<Map<PlannerFileKey, string | null>> {
  const files = await invoke<Record<string, string | null>>("planner_load_files", {
    vaultPath,
    fileKeys,
  });
  const out = new Map<PlannerFileKey, string | null>();
  for (const key of fileKeys) out.set(key, files[key] ?? null);
  return out;
}

async function loadFileFromDisk(vaultPath: string, fileKey: PlannerFileKey): Promise<string | null> {
  const files = await loadPlannerFileMap(vaultPath, [fileKey]);
  return files.get(fileKey) ?? null;
}

async function migrateLegacyLocalStorage(vaultPath: string): Promise<void> {
  const bundle: Record<string, string> = {};
  for (const fileKey of allFileKeys()) {
    const legacy = readLegacyLocalStorage(fileKey);
    if (legacy) bundle[fileKey] = legacy;
  }
  if (Object.keys(bundle).length === 0) return;

  const manifest = await loadFileFromDisk(vaultPath, "manifest.json");
  if (manifest) return;
  const allowed = await invoke<boolean>("planner_local_import_allowed", { vaultPath }).catch(
    () => false,
  );
  if (!allowed) return;

  await invoke("planner_import_bundle", {
    vaultPath,
    files: bundle,
  });
  clearLegacyLocalStorage();
}

async function flushDirtyFiles(): Promise<void> {
  flushTimer = null;
  if (!activeVaultPath || dirtyFiles.size === 0) return;
  const vaultPath = activeVaultPath;
  const filesToSave = [...dirtyFiles];
  const files: Record<string, string> = {};
  for (const fileKey of filesToSave) {
    const json = cache.get(fileKey);
    if (json != null) files[fileKey] = json;
  }
  if (Object.keys(files).length === 0) return;

  setPlannerSyncStatus("saving");
  try {
    await invoke("planner_save_files", { vaultPath, files });
    for (const fileKey of filesToSave) {
      if (files[fileKey] != null && cache.get(fileKey) === files[fileKey]) {
        dirtyFiles.delete(fileKey);
      }
    }
    if (dirtyFiles.size > 0 && activeVaultPath === vaultPath && !flushTimer) {
      setPlannerSyncStatus("pending");
      flushTimer = setTimeout(() => {
        void enqueueFlush(() =>
          flushDirtyFiles().catch((err) => {
            console.error("[planner] batch save failed", err);
          }),
        );
      }, 0);
    } else if (dirtyFiles.size === 0) {
      setPlannerSyncStatus("saved");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setPlannerSyncStatus("error", message);
    toastError(`Planner save failed: ${message}`);
    throw err;
  }
}

export function isPlannerPersistenceReady(): boolean {
  return ready;
}

export async function initPlannerPersistence(vaultPath: string): Promise<void> {
  await flushPlannerSaves();

  const gen = ++initGeneration;
  activeVaultPath = vaultPath;
  ready = false;
  cache.clear();
  dirtyFiles.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  await migrateLegacyLocalStorage(vaultPath);
  if (gen !== initGeneration) return;

  const loaded = await loadPlannerFileMap(vaultPath, allFileKeys());
  if (gen !== initGeneration) return;
  for (const fileKey of allFileKeys()) {
    cache.set(fileKey, loaded.get(fileKey) ?? null);
  }

  if (gen !== initGeneration) return;
  ready = true;
}

export async function resetPlannerPersistence(): Promise<void> {
  initGeneration++;
  await flushPlannerSaves();
  activeVaultPath = null;
  ready = false;
  cache.clear();
  dirtyFiles.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function readPlannerRaw(fileKey: PlannerFileKey): string | null {
  return cache.get(fileKey) ?? null;
}

export function schedulePlannerSave(fileKey: PlannerFileKey, json: string, delayMs = 350): void {
  if (!activeVaultPath) return;
  cache.set(fileKey, json);
  dirtyFiles.add(fileKey);
  setPlannerSyncStatus("pending");
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void enqueueFlush(() =>
      flushDirtyFiles().catch((err) => {
        console.error("[planner] batch save failed", err);
      }),
    );
  }, delayMs);
}

export async function flushPlannerSaves(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  return enqueueFlush(async () => {
    try {
      await flushDirtyFiles();
    } catch {
      // status already set
    }
  });
}

export async function fetchPlannerConfig(vaultPath: string): Promise<PlannerConfig> {
  const config = await invoke<{ active_dir: string }>("planner_get_config", { vaultPath });
  return { active_dir: config.active_dir };
}
