import { create } from "zustand";

const STORAGE_KEY = "metis.vaultActivity";

export interface VaultActivity {
  saveAt: number | null;
  saveError: string | null;
  backupAt: number | null;
  backupError: string | null;
  syncAt: number | null;
  syncError: string | null;
  closeError: string | null;
}

const emptyActivity = (): VaultActivity => ({
  saveAt: null,
  saveError: null,
  backupAt: null,
  backupError: null,
  syncAt: null,
  syncError: null,
  closeError: null,
});

function readAll(): Record<string, VaultActivity> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<VaultActivity>>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, VaultActivity>;
  } catch {
    return {};
  }
}

interface VaultActivityState {
  byVault: Record<string, VaultActivity>;
  record: (vaultPath: string, patch: Partial<VaultActivity>) => void;
}

export const useVaultActivityStore = create<VaultActivityState>((set) => ({
  byVault: readAll(),
  record: (vaultPath, patch) => {
    if (!vaultPath) return;
    set((state) => {
      const next = {
        ...emptyActivity(),
        ...state.byVault[vaultPath],
        ...patch,
      };
      const byVault = { ...state.byVault, [vaultPath]: next };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(byVault));
      } catch {
        /* the indicator still updates for this session */
      }
      return { byVault };
    });
  },
}));

export function recordVaultActivity(vaultPath: string | null, patch: Partial<VaultActivity>): void {
  if (!vaultPath) return;
  useVaultActivityStore.getState().record(vaultPath, patch);
}
