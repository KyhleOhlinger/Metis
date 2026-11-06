import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  AiProviderProfile,
  Persona,
  QuickAction,
  Settings,
  SettingsSectionId,
  HistoryEntry,
  ExecutionScope,
} from "../types/persona";
import type { AgentRunLogEntry } from "../types/agentRunLog";
import { DEFAULT_PERSONAS, DEFAULT_QUICK_ACTIONS } from "../types/persona";
import { SYSTEM_PERSONA_IDS } from "../systemPersonas/registry";
import { fetchProviderModels } from "../services/llmService";
import { loadAgentRunLogFromDisk } from "../services/agentRunLogService";
import {
  collectAllowedAiHosts,
  migratePersona,
  migrateSettings,
  profileForPersona,
} from "../utils/providerProfiles";
import type { LegacyAIProvider } from "../types/persona";
import { formatError } from "../utils/formatError";
import { scrubSecretsFromMessage } from "../utils/scrubSecrets";

function patchSetting(key: string, value: unknown): void {
  void invoke("update_setting", { key, valueJson: JSON.stringify(value) }).catch((error) => {
    console.warn("[Metis] Setting patch failed:", scrubSecretsFromMessage(formatError(error)));
  });
}
import { syncMenuAccelerators } from "../services/menuAcceleratorSync";
import { toastError } from "./useToastStore";

export interface SelectionQuery {
  selectedText: string;
  userMessage: string;
  autoRun?: boolean;
  insertAfterSelection?: boolean;
  selectionEndOffset?: number;
  personaId?: string | null;
  /** When true, use `settings.defaultProviderProfileId` for the API call (active or pinned persona still supplies prompt/model). */
  useDefaultProvider?: boolean;
}

interface ModelCacheEntry {
  models: string[];
  fetchedAt: number;
}

const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;

function settingsWithHosts(settings: Settings): Settings {
  return {
    ...settings,
    allowedAiHosts: collectAllowedAiHosts(settings.providerProfiles),
  };
}

let settingsWrite: Promise<void> = Promise.resolve();
let personaWrite: Promise<void> = Promise.resolve();

function enqueueSettingsWrite(): Promise<void> {
  const run = settingsWrite.then(async () => {
    const settings = settingsWithHosts(usePersonaStore.getState().settings);
    usePersonaStore.setState({ settings });
    await invoke("save_settings", { json: JSON.stringify(settings) });
    await syncMenuAccelerators(settings);
  });
  settingsWrite = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch((e) => {
    console.error("[Metis] Failed to save settings:", scrubSecretsFromMessage(formatError(e)));
    toastError(`Could not save settings: ${formatError(e)}`);
  });
}

function enqueuePersonaWrite(): Promise<void> {
  const run = personaWrite.then(async () => {
    const personas = usePersonaStore.getState().personas;
    await invoke("save_personas", { json: JSON.stringify(personas) });
  });
  personaWrite = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch((e) => {
    console.error("[Metis] Failed to save personas:", scrubSecretsFromMessage(formatError(e)));
    toastError(`Could not save personas: ${formatError(e)}`);
  });
}

interface PersonaState {
  personas: Persona[];
  activePersonaId: string | null;
  settings: Settings;
  history: HistoryEntry[];
  agentRunLog: AgentRunLogEntry[];
  loading: boolean;

  modelCache: Partial<Record<string, ModelCacheEntry>>;
  modelFetchStatus: Partial<Record<string, "loading" | "error">>;
  modelFetchError: Partial<Record<string, string>>;

  fetchModelsForProfile: (
    profile: AiProviderProfile,
    force?: boolean,
  ) => Promise<void>;

  pendingScope: ExecutionScope | null;
  selectionQuery: SelectionQuery | null;

  settingsModalOpen: boolean;
  settingsModalSection: SettingsSectionId;

  loadFromDisk: (options?: { quiet?: boolean }) => Promise<void>;
  openSettings: (section?: SettingsSectionId) => void;
  setSettingsSection: (section: SettingsSectionId) => void;
  closeSettings: () => void;
  setPendingScope: (scope: ExecutionScope | null) => void;
  setSelectionQuery: (q: SelectionQuery | null) => void;
  savePersonas: () => Promise<void>;
  saveSettings: () => Promise<void>;

  setActivePersona: (id: string | null) => void;
  upsertPersona: (persona: Persona) => void;
  deletePersona: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;

  upsertProviderProfile: (profile: AiProviderProfile) => void;
  removeProviderProfile: (id: string) => void;
  setDefaultProviderProfileId: (id: string) => void;
  setAllPersonasProviderProfile: (providerProfileId: string) => void;

  addHistory: (entry: HistoryEntry) => void;
  clearHistory: () => void;

  prependAgentRunLog: (entry: AgentRunLogEntry) => void;
  setAgentRunLog: (entries: AgentRunLogEntry[]) => void;
  loadAgentRunLog: () => Promise<void>;

  upsertQuickAction: (action: QuickAction) => void;
  deleteQuickAction: (id: string) => void;
  reorderQuickActions: (orderedIds: string[]) => void;
}

export const usePersonaStore = create<PersonaState>((set, get) => ({
  personas: DEFAULT_PERSONAS,
  activePersonaId: DEFAULT_PERSONAS[0].id,
  settings: settingsWithHosts(migrateSettings({})),
  history: [],
  agentRunLog: [],
  loading: false,
  modelCache: {},
  modelFetchStatus: {},
  modelFetchError: {},
  pendingScope: null,
  selectionQuery: null,
  settingsModalOpen: false,
  settingsModalSection: "general",

  openSettings: (section = "general") =>
    set({ settingsModalOpen: true, settingsModalSection: section }),
  setSettingsSection: (section) => set({ settingsModalSection: section }),
  closeSettings: () => set({ settingsModalOpen: false }),

  fetchModelsForProfile: async (profile, force = false) => {
    const id = profile.id;
    const { modelCache, modelFetchStatus } = get();

    if (!force && modelCache[id]) {
      const age = Date.now() - modelCache[id]!.fetchedAt;
      if (age < MODEL_CACHE_TTL_MS) return;
    }
    if (modelFetchStatus[id] === "loading") return;

    set((s) => ({
      modelFetchStatus: { ...s.modelFetchStatus, [id]: "loading" },
      modelFetchError: { ...s.modelFetchError, [id]: undefined },
    }));

    const result = await fetchProviderModels(profile);

    if (result.ok) {
      set((s) => ({
        modelCache: {
          ...s.modelCache,
          [id]: { models: result.models, fetchedAt: Date.now() },
        },
        modelFetchStatus: { ...s.modelFetchStatus, [id]: undefined },
      }));
    } else {
      set((s) => ({
        modelFetchStatus: { ...s.modelFetchStatus, [id]: "error" },
        modelFetchError: { ...s.modelFetchError, [id]: result.error },
      }));
    }
  },

  loadFromDisk: async (options?: { quiet?: boolean }) => {
    if (!options?.quiet) set({ loading: true });
    try {
      const [personasJson, settingsJson] = await Promise.all([
        invoke<string>("load_personas"),
        invoke<string>("load_settings"),
      ]);

      const persisted = JSON.parse(personasJson) as Persona[];
      const persistedIds = new Set(persisted.map((p) => p.id));
      const newDefaults = DEFAULT_PERSONAS.filter((p) => !persistedIds.has(p.id));
      const rawPersonas =
        persisted.length > 0 ? [...persisted, ...newDefaults] : DEFAULT_PERSONAS;

      const saved = JSON.parse(settingsJson) as Partial<Settings>;
      const navigationRaw = await invoke<string>("load_vault_navigation").catch(() => "{}");
      let vaultNoteNavigation: Settings["vaultNoteNavigation"] = {};
      try {
        const parsed = JSON.parse(navigationRaw) as Settings["vaultNoteNavigation"];
        if (parsed && typeof parsed === "object") vaultNoteNavigation = parsed;
      } catch {
        vaultNoteNavigation = {};
      }
      let settings = migrateSettings({ ...saved, vaultNoteNavigation });
      settings = settingsWithHosts(settings);

      const personas = rawPersonas.map((p) => {
        const migrated = migratePersona(
          p as Persona & { provider?: LegacyAIProvider },
          settings,
        );
        const shipped = DEFAULT_PERSONAS.find((d) => d.id === p.id);
        if (shipped && SYSTEM_PERSONA_IDS.has(p.id)) {
          return {
            ...migrated,
            name: shipped.name,
            icon: shipped.icon,
            systemPrompt: shipped.systemPrompt,
          };
        }
        return migrated;
      });

      const previousId = get().activePersonaId;
      const activePersonaId =
        previousId && personas.some((persona) => persona.id === previousId)
          ? previousId
          : (personas[0]?.id ?? null);

      set({
        personas,
        activePersonaId,
        settings,
      });

      void syncMenuAccelerators(settings);
      void get().loadAgentRunLog();
    } catch (e) {
      console.warn(
        "[Metis] Could not load personas/settings from disk:",
        scrubSecretsFromMessage(formatError(e)),
      );
      const settings = settingsWithHosts(migrateSettings({}));
      set({ settings });
      void syncMenuAccelerators(settings);
    } finally {
      set({ loading: false });
    }
  },

  savePersonas: () => enqueuePersonaWrite(),

  saveSettings: () => enqueueSettingsWrite(),

  setPendingScope: (scope) => set({ pendingScope: scope }),
  setSelectionQuery: (q) => set({ selectionQuery: q }),

  setActivePersona: (id) => set({ activePersonaId: id }),

  upsertPersona: (persona) => {
    set((s) => {
      const exists = s.personas.some((p) => p.id === persona.id);
      const personas = exists
        ? s.personas.map((p) => (p.id === persona.id ? persona : p))
        : [...s.personas, persona];
      return { personas };
    });
    void invoke("upsert_persona", { personaJson: JSON.stringify(persona) }).catch((error) => {
      console.warn("[Metis] Persona patch failed:", scrubSecretsFromMessage(formatError(error)));
    });
  },

  deletePersona: (id) => {
    set((s) => {
      const personas = s.personas.filter((p) => p.id !== id);
      const activePersonaId =
        s.activePersonaId === id ? (personas[0]?.id ?? null) : s.activePersonaId;
      return { personas, activePersonaId };
    });
    void invoke("delete_persona", { id }).catch((error) => {
      console.warn("[Metis] Persona delete failed:", scrubSecretsFromMessage(formatError(error)));
    });
  },

  updateSettings: (patch) => {
    set((s) => {
      const next = settingsWithHosts({ ...s.settings, ...patch });
      return { settings: next };
    });
    const { vaultNoteNavigation, providerProfiles: _profiles, ...rest } = patch;
    if (vaultNoteNavigation) {
      void import("@/store/useStore").then(({ useStore }) => {
        const vaultPath = useStore.getState().vaultPath;
        if (!vaultPath) return;
        return invoke("patch_vault_navigation", {
          navigationJson: JSON.stringify(vaultNoteNavigation),
        });
      }).catch((error) => {
        console.warn("[Metis] Navigation patch failed:", scrubSecretsFromMessage(formatError(error)));
      });
    }
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patchSetting(key, value);
    }
    if (patch.providerProfiles || patch.defaultProviderProfileId) {
      patchSetting("allowedAiHosts", get().settings.allowedAiHosts ?? []);
    }
  },

  upsertProviderProfile: (profile) => {
    set((s) => {
      const list = [...s.settings.providerProfiles];
      const idx = list.findIndex((p) => p.id === profile.id);
      if (idx >= 0) list[idx] = profile;
      else list.push(profile);
      return { settings: settingsWithHosts({ ...s.settings, providerProfiles: list }) };
    });
    void invoke("upsert_provider_profile", { profileJson: JSON.stringify(profile) }).catch((error) => {
      console.warn("[Metis] Provider patch failed:", scrubSecretsFromMessage(formatError(error)));
    });
    patchSetting("allowedAiHosts", get().settings.allowedAiHosts ?? []);
  },

  removeProviderProfile: (id) => {
    set((s) => {
      const list = s.settings.providerProfiles.filter((p) => p.id !== id);
      let defaultProviderProfileId = s.settings.defaultProviderProfileId;
      if (defaultProviderProfileId === id) {
        defaultProviderProfileId = list[0]?.id ?? null;
      }
      const personas = s.personas.map((p) =>
        p.providerProfileId === id
          ? { ...p, providerProfileId: defaultProviderProfileId ?? p.providerProfileId }
          : p,
      );
      return {
        settings: settingsWithHosts({
          ...s.settings,
          providerProfiles: list,
          defaultProviderProfileId,
        }),
        personas,
      };
    });
    void invoke("remove_provider_profile", { id }).catch((error) => {
      console.warn("[Metis] Provider removal failed:", scrubSecretsFromMessage(formatError(error)));
    });
    patchSetting("allowedAiHosts", get().settings.allowedAiHosts ?? []);
  },

  setDefaultProviderProfileId: (id) => {
    get().updateSettings({ defaultProviderProfileId: id });
  },

  setAllPersonasProviderProfile: (providerProfileId) => {
    set((s) => ({
      personas: s.personas.map((p) => ({ ...p, providerProfileId })),
    }));
    for (const persona of get().personas) {
      void invoke("upsert_persona", { personaJson: JSON.stringify(persona) });
    }
  },

  addHistory: (entry) => {
    const { settings } = get();
    if (settings.storeAiHistory === false) return;

    const maxRaw = settings.aiHistoryMaxResponseChars;
    const max = maxRaw === undefined ? 32_000 : maxRaw;
    let response = entry.response;
    if (max > 0 && response.length > max) {
      response =
        `${response.slice(0, max)}\n\n… [trimmed for local history — change limit in Settings → AI & privacy]`;
    }

    set((s) => ({
      history: [{ ...entry, response }, ...s.history].slice(0, 50),
    }));
  },

  clearHistory: () => set({ history: [] }),

  prependAgentRunLog: (entry) =>
    set((s) => ({
      agentRunLog: [entry, ...s.agentRunLog.filter((e) => e.id !== entry.id)].slice(0, 1000),
    })),

  setAgentRunLog: (entries) => set({ agentRunLog: entries }),

  loadAgentRunLog: async () => {
    const entries = await loadAgentRunLogFromDisk();
    set({ agentRunLog: entries });
  },

  upsertQuickAction: (action) => {
    set((s) => {
      const current = s.settings.quickActions ?? DEFAULT_QUICK_ACTIONS;
      const idx = current.findIndex((a) => a.id === action.id);
      const updated =
        idx >= 0
          ? current.map((a, i) => (i === idx ? action : a))
          : [...current, action];
      return { settings: { ...s.settings, quickActions: updated } };
    });
    patchSetting("quickActions", get().settings.quickActions ?? DEFAULT_QUICK_ACTIONS);
  },

  deleteQuickAction: (id) => {
    if (id === "ask") return;
    set((s) => ({
      settings: {
        ...s.settings,
        quickActions: (s.settings.quickActions ?? DEFAULT_QUICK_ACTIONS).filter(
          (a) => a.id !== id,
        ),
      },
    }));
    patchSetting("quickActions", get().settings.quickActions ?? DEFAULT_QUICK_ACTIONS);
  },

  reorderQuickActions: (orderedIds) => {
    set((s) => {
      const current = s.settings.quickActions ?? DEFAULT_QUICK_ACTIONS;
      const reordered = orderedIds
        .map((id) => current.find((a) => a.id === id))
        .filter((a): a is QuickAction => a != null);
      return { settings: { ...s.settings, quickActions: reordered } };
    });
    patchSetting("quickActions", get().settings.quickActions ?? DEFAULT_QUICK_ACTIONS);
  },
}));

void import("@tauri-apps/api/webviewWindow")
  .then(({ getCurrentWebviewWindow }) =>
    getCurrentWebviewWindow().listen("settings-changed", () => {
      void usePersonaStore.getState().loadFromDisk({ quiet: true });
    }),
  )
  .catch(() => undefined);

export function selectActivePersona(state: PersonaState): Persona | undefined {
  return state.personas.find((p) => p.id === state.activePersonaId);
}

/** API key for the persona's linked provider profile. */
export function selectProfileApiKey(
  state: PersonaState,
  persona: Persona | undefined,
): string {
  if (!persona) return "";
  const profile = profileForPersona(state.settings, persona);
  return profile?.apiKey?.trim() ?? "";
}

export function selectProfileForPersona(
  state: PersonaState,
  persona: Persona | undefined,
): AiProviderProfile | undefined {
  if (!persona) return undefined;
  return profileForPersona(state.settings, persona);
}
