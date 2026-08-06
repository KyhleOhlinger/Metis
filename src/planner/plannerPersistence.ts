/**
 * Disk-backed planner persistence (shared profile dir or vault `.metis/planner/`).
 */

import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";

export type PlannerStorageMode = "shared" | "vault";

export type PlannerFileKey =
  | "manifest.json"
  | "templates.json"
  | "layout-templates.json"
  | "goals.json"
  | "reviews.json"
  | "field-heights.json";

export interface PlannerConfig {
  mode: PlannerStorageMode;
  setup_required: boolean;
  active_dir: string;
  mirror_dir: string;
  mirror_last_synced_unix?: number | null;
}

export interface PlannerMirrorStatus {
  mode: PlannerStorageMode;
  mirror_dir: string;
  mirror_last_synced_unix?: number | null;
  registered_vault_count: number;
}

export interface PlannerRestoreCheck {
  offer_restore: boolean;
  vault_mirror_has_data: boolean;
  shared_empty: boolean;
}

interface PlannerSaveResult {
  mirror_error?: string | null;
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
let activeMode: PlannerStorageMode = "shared";
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

async function loadFileFromDisk(vaultPath: string, fileKey: PlannerFileKey): Promise<string | null> {
  return invoke<string | null>("planner_load_file", { vaultPath, fileKey });
}

async function migrateLegacyLocalStorage(vaultPath: string): Promise<void> {
  const bundle: Record<string, string> = {};
  for (const fileKey of allFileKeys()) {
    const legacy = readLegacyLocalStorage(fileKey);
    if (legacy) bundle[fileKey] = legacy;
  }
  if (Object.keys(bundle).length === 0) return;

  const sharedManifest = await loadFileFromDisk(vaultPath, "manifest.json");
  if (sharedManifest) return;

  await invoke("planner_import_bundle", {
    vaultPath,
    target: "shared",
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
    const result = await invoke<PlannerSaveResult>("planner_save_files", { vaultPath, files });
    for (const fileKey of filesToSave) {
      if (files[fileKey] != null) dirtyFiles.delete(fileKey);
    }
    if (result.mirror_error) {
      const msg = `Saved; backup sync failed: ${result.mirror_error}`;
      setPlannerSyncStatus("saved", msg);
      toastError(msg);
    } else {
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

export function getPlannerStorageMode(): PlannerStorageMode {
  return activeMode;
}

export async function checkPlannerRestore(vaultPath: string): Promise<PlannerRestoreCheck> {
  return invoke<PlannerRestoreCheck>("planner_check_restore", { vaultPath });
}

export async function restoreSharedFromVault(vaultPath: string): Promise<void> {
  await invoke("planner_restore_shared_from_vault", { vaultPath });
}

export async function syncSharedMirror(vaultPath: string): Promise<void> {
  setPlannerSyncStatus("syncing");
  try {
    await invoke("planner_sync_shared_mirror", { vaultPath });
    setPlannerSyncStatus("saved");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setPlannerSyncStatus("error", message);
    throw err;
  }
}

export async function initPlannerPersistence(
  vaultPath: string,
  mode: PlannerStorageMode,
): Promise<void> {
  await flushPlannerSaves();

  const gen = ++initGeneration;
  activeVaultPath = vaultPath;
  activeMode = mode;
  ready = false;
  cache.clear();
  dirtyFiles.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  await migrateLegacyLocalStorage(vaultPath);
  if (gen !== initGeneration) return;

  await Promise.all(
    allFileKeys().map(async (fileKey) => {
      const raw = await loadFileFromDisk(vaultPath, fileKey);
      if (gen !== initGeneration) return;
      cache.set(fileKey, raw);
    }),
  );

  if (gen !== initGeneration) return;
  ready = true;
}

export async function resetPlannerPersistence(): Promise<void> {
  initGeneration++;
  await flushPlannerSaves();
  activeVaultPath = null;
  activeMode = "shared";
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

export async function switchPlannerVaultMode(
  vaultPath: string,
  mode: PlannerStorageMode,
  seedFromShared: boolean,
): Promise<PlannerConfig> {
  await flushPlannerSaves();
  const cfg = await setPlannerVaultMode(vaultPath, mode, seedFromShared);
  useStore.getState().setPlannerConfig(cfg.mode, cfg.setup_required);
  useStore.getState().bumpPlannerReload();
  return cfg;
}

export async function fetchPlannerConfig(vaultPath: string): Promise<PlannerConfig> {
  const config = await invoke<{
    mode: string;
    setup_required: boolean;
    active_dir: string;
    mirror_dir: string;
    mirror_last_synced_unix?: number | null;
  }>("planner_get_config", { vaultPath });
  return {
    mode: config.mode === "vault" ? "vault" : "shared",
    setup_required: config.setup_required,
    active_dir: config.active_dir,
    mirror_dir: config.mirror_dir,
    mirror_last_synced_unix: config.mirror_last_synced_unix ?? null,
  };
}

export async function fetchPlannerMirrorStatus(vaultPath: string): Promise<PlannerMirrorStatus> {
  const status = await invoke<{
    mode: string;
    mirror_dir: string;
    mirror_last_synced_unix?: number | null;
    registered_vault_count: number;
  }>("planner_get_mirror_status", { vaultPath });
  return {
    mode: status.mode === "vault" ? "vault" : "shared",
    mirror_dir: status.mirror_dir,
    mirror_last_synced_unix: status.mirror_last_synced_unix ?? null,
    registered_vault_count: status.registered_vault_count,
  };
}

export async function setPlannerVaultMode(
  vaultPath: string,
  mode: PlannerStorageMode,
  seedFromShared: boolean,
): Promise<PlannerConfig> {
  const config = await invoke<{
    mode: string;
    setup_required: boolean;
    active_dir: string;
    mirror_dir: string;
    mirror_last_synced_unix?: number | null;
  }>("planner_set_vault_mode", { vaultPath, mode, seedFromShared });
  return {
    mode: config.mode === "vault" ? "vault" : "shared",
    setup_required: config.setup_required,
    active_dir: config.active_dir,
    mirror_dir: config.mirror_dir,
    mirror_last_synced_unix: config.mirror_last_synced_unix ?? null,
  };
}

export async function copyVaultPlannerToShared(vaultPath: string): Promise<void> {
  await invoke("planner_copy_vault_to_shared", { vaultPath });
}

export async function copySharedPlannerToVault(vaultPath: string): Promise<void> {
  await invoke("planner_copy_shared_to_vault", { vaultPath });
}

export function formatMirrorSyncTime(unix: number | null | undefined): string {
  if (!unix) return "Never";
  return new Date(unix * 1000).toLocaleString();
}
