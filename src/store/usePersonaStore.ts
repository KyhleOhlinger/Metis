import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  AiProviderProfile,
  Persona,
  QuickAction,
  Settings,
  HistoryEntry,
  ExecutionScope,
} from "../types/persona";
import { DEFAULT_PERSONAS, DEFAULT_QUICK_ACTIONS } from "../types/persona";
import { fetchProviderModels } from "../services/aiService";
import {
  collectAllowedAiHosts,
  migratePersona,
  migrateSettings,
  profileForPersona,
} from "../utils/providerProfiles";
import type { LegacyAIProvider } from "../types/persona";

export interface SelectionQuery {
  selectedText: string;
  userMessage: string;
  autoRun?: boolean;
  insertAfterSelection?: boolean;
  selectionEndOffset?: number;
  personaId?: string | null;
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

interface PersonaState {
  personas: Persona[];
  activePersonaId: string | null;
  settings: Settings;
  history: HistoryEntry[];
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

  loadFromDisk: () => Promise<void>;
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

  addHistory: (entry: HistoryEntry) => void;
  clearHistory: () => void;

  upsertQuickAction: (action: QuickAction) => void;
  deleteQuickAction: (id: string) => void;
  reorderQuickActions: (orderedIds: string[]) => void;
}

export const usePersonaStore = create<PersonaState>((set, get) => ({
  personas: DEFAULT_PERSONAS,
  activePersonaId: DEFAULT_PERSONAS[0].id,
  settings: settingsWithHosts(migrateSettings({})),
  history: [],
  loading: false,
  modelCache: {},
  modelFetchStatus: {},
  modelFetchError: {},
  pendingScope: null,
  selectionQuery: null,

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

  loadFromDisk: async () => {
    set({ loading: true });
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
      let settings = migrateSettings(saved);
      settings = settingsWithHosts(settings);

      const personas = rawPersonas.map((p) =>
        migratePersona(
          p as Persona & { provider?: LegacyAIProvider },
          settings,
        ),
      );

      set({
        personas,
        activePersonaId: personas[0]?.id ?? null,
        settings,
      });
    } catch (e) {
      console.warn("[Metis] Could not load personas/settings from disk:", e);
      const settings = settingsWithHosts(migrateSettings({}));
      set({ settings });
    } finally {
      set({ loading: false });
    }
  },

  savePersonas: async () => {
    try {
      await invoke("save_personas", { json: JSON.stringify(get().personas) });
    } catch (e) {
      console.error("[Metis] Failed to save personas:", e);
    }
  },

  saveSettings: async () => {
    const settings = settingsWithHosts(get().settings);
    set({ settings });
    try {
      await invoke("save_settings", { json: JSON.stringify(settings) });
    } catch (e) {
      console.error("[Metis] Failed to save settings:", e);
    }
  },

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
    get().savePersonas();
  },

  deletePersona: (id) => {
    set((s) => {
      const personas = s.personas.filter((p) => p.id !== id);
      const activePersonaId =
        s.activePersonaId === id ? (personas[0]?.id ?? null) : s.activePersonaId;
      return { personas, activePersonaId };
    });
    get().savePersonas();
  },

  updateSettings: (patch) => {
    set((s) => {
      const next = settingsWithHosts({ ...s.settings, ...patch });
      return { settings: next };
    });
    get().saveSettings();
  },

  upsertProviderProfile: (profile) => {
    set((s) => {
      const list = [...s.settings.providerProfiles];
      const idx = list.findIndex((p) => p.id === profile.id);
      if (idx >= 0) list[idx] = profile;
      else list.push(profile);
      return { settings: settingsWithHosts({ ...s.settings, providerProfiles: list }) };
    });
    get().saveSettings();
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
    get().savePersonas();
    get().saveSettings();
  },

  setDefaultProviderProfileId: (id) => {
    get().updateSettings({ defaultProviderProfileId: id });
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
    get().saveSettings();
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
    get().saveSettings();
  },

  reorderQuickActions: (orderedIds) => {
    set((s) => {
      const current = s.settings.quickActions ?? DEFAULT_QUICK_ACTIONS;
      const reordered = orderedIds
        .map((id) => current.find((a) => a.id === id))
        .filter((a): a is QuickAction => a != null);
      return { settings: { ...s.settings, quickActions: reordered } };
    });
    get().saveSettings();
  },
}));

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

/** @deprecated Use selectProfileApiKey */
export function selectProviderKey(
  state: PersonaState,
  _provider: string,
): string {
  const persona = selectActivePersona(state);
  return selectProfileApiKey(state, persona);
}
