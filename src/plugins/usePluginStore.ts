import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  REQUIRED_CORE_PLUGIN_IDS,
  isCoreEnabledWhenLoaded,
  type CorePluginId,
  type VaultPluginStateDto,
} from "./corePlugins";
import { formatError } from "@/utils/formatError";
import { toastError } from "@/store/useToastStore";
import {
  HANDWRITING_OCR_PERSONA_ID,
  PLANNER_PERSONA_ID,
  TASK_PERSONA_ID,
} from "@/types/persona";

const empty: VaultPluginStateDto = {
  restrictedMode: true,
  core: {},
  enabled: [],
  installed: [],
  pendingSuggestions: [],
};

interface PluginStore extends VaultPluginStateDto {
  loaded: boolean;
  apply: (state: VaultPluginStateDto) => void;
  reset: () => void;
  loadForVault: () => Promise<void>;
  setCoreEnabled: (id: CorePluginId, enabled: boolean) => Promise<void>;
  setRestrictedMode: (restricted: boolean) => Promise<void>;
  setCommunityEnabled: (id: string, enabled: boolean) => Promise<void>;
  installFromDialog: () => Promise<void>;
  installFiles: (manifestJson: string, stylesCss?: string | null) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
}

function applyDto(set: (p: Partial<PluginStore>) => void, state: VaultPluginStateDto) {
  set({
    loaded: true,
    restrictedMode: state.restrictedMode,
    core: state.core ?? {},
    enabled: state.enabled ?? [],
    installed: state.installed ?? [],
    pendingSuggestions: state.pendingSuggestions ?? [],
  });
}

/** Drops a plugin IPC result that finishes after a newer load or vault switch. */
let pluginEpoch = 0;

function nextPluginEpoch(): number {
  pluginEpoch += 1;
  return pluginEpoch;
}

function pluginEpochCurrent(epoch: number): boolean {
  return epoch === pluginEpoch;
}

export const usePluginStore = create<PluginStore>((set) => ({
  ...empty,
  loaded: false,
  apply: (state) => applyDto(set, state),
  reset: () => {
    nextPluginEpoch();
    set({ ...empty, loaded: false });
  },
  loadForVault: async () => {
    const epoch = nextPluginEpoch();
    try {
      const state = await invoke<VaultPluginStateDto>("load_vault_plugins");
      if (!pluginEpochCurrent(epoch)) return;
      applyDto(set, state);
    } catch (err) {
      if (!pluginEpochCurrent(epoch)) return;
      toastError(`Could not load plugins: ${formatError(err)}`);
      set({ ...empty, loaded: true });
    }
  },
  setCoreEnabled: async (id, enabled) => {
    if (REQUIRED_CORE_PLUGIN_IDS.has(id) && !enabled) return;
    const epoch = nextPluginEpoch();
    try {
      const state = await invoke<VaultPluginStateDto>("set_core_plugin_enabled", { id, enabled });
      if (!pluginEpochCurrent(epoch)) return;
      applyDto(set, state);
    } catch (err) {
      toastError(`Could not update plugin: ${formatError(err)}`);
    }
  },
  setRestrictedMode: async (restricted) => {
    const epoch = nextPluginEpoch();
    try {
      const state = await invoke<VaultPluginStateDto>("set_plugin_restricted_mode", { restricted });
      if (!pluginEpochCurrent(epoch)) return;
      applyDto(set, state);
    } catch (err) {
      toastError(`Could not update Restricted Mode: ${formatError(err)}`);
    }
  },
  setCommunityEnabled: async (id, enabled) => {
    const epoch = nextPluginEpoch();
    try {
      const state = await invoke<VaultPluginStateDto>("set_community_plugin_enabled", { id, enabled });
      if (!pluginEpochCurrent(epoch)) return;
      applyDto(set, state);
    } catch (err) {
      toastError(`Could not update community plugin: ${formatError(err)}`);
    }
  },
  installFromDialog: async () => {
    const epoch = nextPluginEpoch();
    const state = await invoke<VaultPluginStateDto>("install_plugin_from_dialog");
    if (!pluginEpochCurrent(epoch)) return;
    applyDto(set, state);
  },
  installFiles: async (manifestJson, stylesCss) => {
    const epoch = nextPluginEpoch();
    const state = await invoke<VaultPluginStateDto>("install_community_plugin_files", {
      manifestJson,
      stylesCss: stylesCss ?? null,
    });
    if (!pluginEpochCurrent(epoch)) return;
    applyDto(set, state);
  },
  uninstall: async (id) => {
    const epoch = nextPluginEpoch();
    try {
      const state = await invoke<VaultPluginStateDto>("uninstall_community_plugin", { id });
      if (!pluginEpochCurrent(epoch)) return;
      applyDto(set, state);
    } catch (err) {
      toastError(`Could not uninstall plugin: ${formatError(err)}`);
    }
  },
}));

/** Snapshot: missing core keys default to enabled once the vault file has loaded. */
export function isCorePluginEnabled(id: CorePluginId): boolean {
  const { core, loaded } = usePluginStore.getState();
  return isCoreEnabledWhenLoaded(loaded, core, id);
}

export function useCorePluginEnabled(id: CorePluginId): boolean {
  return usePluginStore((s) => isCoreEnabledWhenLoaded(s.loaded, s.core, id));
}

export function isSystemPersonaAllowed(personaId: string): boolean {
  if (!isCorePluginEnabled("ai")) return false;
  if (personaId === TASK_PERSONA_ID) return isCorePluginEnabled("task-manager");
  if (personaId === HANDWRITING_OCR_PERSONA_ID) return isCorePluginEnabled("handwriting");
  if (personaId === PLANNER_PERSONA_ID) return isCorePluginEnabled("planner");
  return true;
}
