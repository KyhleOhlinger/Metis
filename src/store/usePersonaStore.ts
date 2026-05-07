import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  Persona,
  QuickAction,
  Settings,
  HistoryEntry,
  ExecutionScope,
  AIProvider,
  ProviderConfig,
} from "../types/persona";
import { DEFAULT_PERSONAS, DEFAULT_QUICK_ACTIONS, DEFAULT_SETTINGS } from "../types/persona";
import { curatedSmallModelId, fetchProviderModels } from "../services/aiService";

const ALL_PROVIDERS: AIProvider[] = ["openai", "gemini", "groq", "perplexity"];

function configuredProviders(providers: Settings["providers"]): AIProvider[] {
  return ALL_PROVIDERS.filter((p) => (providers[p]?.apiKey ?? "").trim().length > 0);
}

// ── Model cache types ─────────────────────────────────────────────────────────

interface ModelCacheEntry {
  models: string[];
  /** Date.now() timestamp when this entry was populated */
  fetchedAt: number;
}

/** How long a cached model list is considered fresh (30 minutes). */
const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;

// ── State interface ───────────────────────────────────────────────────────────

interface PersonaState {
  personas: Persona[];
  activePersonaId: string | null;
  settings: Settings;
  history: HistoryEntry[];

  /** True while the store is loading from disk on first mount */
  loading: boolean;

  // ── Model cache ─────────────────────────────────────────────────────────────
  /** Cached model lists keyed by provider, populated by fetchModelsForProvider. */
  modelCache: Partial<Record<AIProvider, ModelCacheEntry>>;
  /** Per-provider fetch status so the UI can show a spinner. */
  modelFetchStatus: Partial<Record<AIProvider, "loading" | "error">>;
  /** Per-provider error message from the last failed fetch. */
  modelFetchError: Partial<Record<AIProvider, string>>;

  /**
   * Fetch (or serve from cache) the available chat models for a provider.
   * Pass `force = true` to bypass the TTL and always re-fetch.
   * No-ops if the cache is still fresh or a fetch is already in flight.
   */
  fetchModelsForProvider: (
    provider: AIProvider,
    config: ProviderConfig,
    force?: boolean,
  ) => Promise<void>;

  /**
   * Set by the Sidebar "Run with Persona" context menu action.
   * CommandCenter watches this and applies the scope + opens the AI tab.
   */
  pendingScope: ExecutionScope | null;

  /**
   * Set by the SelectionToolbar when the user clicks a quick AI action on
   * highlighted text.  The AITab watches this, pre-fills the input, and
   * auto-runs the active persona.  Cleared after consumption.
   */
  selectionQuery: {
    /** The highlighted text to act on */
    selectedText: string;
    /** The pre-built user message (e.g. "Improve the following text:\n\n...") */
    userMessage: string;
    /** Whether the AITab should auto-run immediately after pre-filling */
    autoRun: boolean;
    /**
     * When true and the agent returns a plain-text response (no tool calls),
     * the AITab automatically creates a pending insert_at_cursor write at the
     * end of the original selection so the user can Apply inline.
     * Used by actions like "Extract action items".
     */
    insertAfterSelection?: boolean;
    /** Character offset of the selection end, captured at toolbar click time. */
    selectionEndOffset?: number;
    /**
     * ID of the persona that should handle this action.
     * When present, AITab uses this persona instead of the currently active one.
     * null / undefined → fall back to the active persona.
     */
    personaId?: string | null;
  } | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  loadFromDisk: () => Promise<void>;
  setPendingScope: (scope: ExecutionScope | null) => void;
  setSelectionQuery: (q: PersonaState["selectionQuery"]) => void;
  savePersonas: () => Promise<void>;
  saveSettings: () => Promise<void>;

  setActivePersona: (id: string | null) => void;
  upsertPersona: (persona: Persona) => void;
  deletePersona: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateProviderConfig: (
    provider: Settings["defaultProvider"],
    patch: Partial<Settings["providers"][keyof Settings["providers"]]>
  ) => void;

  addHistory: (entry: HistoryEntry) => void;
  clearHistory: () => void;

  /** Add a new quick action or replace an existing one (matched by id). */
  upsertQuickAction: (action: QuickAction) => void;
  /** Remove a quick action by id. The built-in "ask" action cannot be removed. */
  deleteQuickAction: (id: string) => void;
  /** Persist a new ordering of quick actions supplied as an ordered id array. */
  reorderQuickActions: (orderedIds: string[]) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const usePersonaStore = create<PersonaState>((set, get) => ({
  personas: DEFAULT_PERSONAS,
  activePersonaId: DEFAULT_PERSONAS[0].id,
  settings: DEFAULT_SETTINGS,
  history: [],
  loading: false,
  modelCache: {},
  modelFetchStatus: {},
  modelFetchError: {},
  pendingScope: null,
  selectionQuery: null,

  fetchModelsForProvider: async (provider, config, force = false) => {
    const { modelCache, modelFetchStatus } = get();

    // Skip if cache is still fresh and force-refresh was not requested
    if (!force && modelCache[provider]) {
      const age = Date.now() - modelCache[provider]!.fetchedAt;
      if (age < MODEL_CACHE_TTL_MS) return;
    }

    // Skip if a fetch is already in-flight for this provider
    if (modelFetchStatus[provider] === "loading") return;

    set((s) => ({
      modelFetchStatus: { ...s.modelFetchStatus, [provider]: "loading" },
      modelFetchError:  { ...s.modelFetchError,  [provider]: undefined },
    }));

    const result = await fetchProviderModels(provider, config);

    if (result.ok) {
      set((s) => ({
        modelCache: {
          ...s.modelCache,
          [provider]: { models: result.models, fetchedAt: Date.now() },
        },
        modelFetchStatus: { ...s.modelFetchStatus, [provider]: undefined },
      }));
    } else {
      set((s) => ({
        modelFetchStatus: { ...s.modelFetchStatus, [provider]: "error" },
        modelFetchError:  { ...s.modelFetchError,  [provider]: result.error },
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
      // Inject any default personas that were added after the user's initial install
      // (e.g. The Librarian). Persisted custom personas are preserved as-is.
      const persistedIds = new Set(persisted.map((p) => p.id));
      const newDefaults = DEFAULT_PERSONAS.filter((p) => !persistedIds.has(p.id));
      let merged = persisted.length > 0
        ? [...persisted, ...newDefaults]
        : DEFAULT_PERSONAS;

      const saved = JSON.parse(settingsJson) as Partial<Settings>;
      let settings: Settings = {
        ...DEFAULT_SETTINGS,
        ...saved,
        // Ensure quickActions always has a value; existing installs won't have it
        quickActions: saved.quickActions?.length
          ? saved.quickActions
          : DEFAULT_QUICK_ACTIONS,
      };

      let mutatedOnLoad = false;
      const only = configuredProviders(settings.providers);
      if (only.length === 1) {
        const p = only[0];
        const model = curatedSmallModelId(p);
        if (merged.some((per) => per.provider !== p || per.model !== model)) {
          merged = merged.map((persona) => ({ ...persona, provider: p, model }));
          mutatedOnLoad = true;
        }
        if (settings.defaultProvider !== p) {
          settings = { ...settings, defaultProvider: p };
          mutatedOnLoad = true;
        }
      }

      set({
        personas: merged,
        activePersonaId: merged[0]?.id ?? null,
        settings,
      });

      if (mutatedOnLoad) {
        void get().savePersonas();
        void get().saveSettings();
      }
    } catch (e) {
      console.warn("[Metis] Could not load personas/settings from disk:", e);
    } finally {
      set({ loading: false });
    }
  },

  savePersonas: async () => {
    const { personas } = get();
    try {
      await invoke("save_personas", { json: JSON.stringify(personas) });
    } catch (e) {
      console.error("[Metis] Failed to save personas:", e);
    }
  },

  saveSettings: async () => {
    const { settings } = get();
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
      // Compute the next active id from the already-filtered list so we never
      // point at the persona that was just removed (bug: the old code took
      // s.personas[0] before filtering, which could be the deleted persona).
      const activePersonaId =
        s.activePersonaId === id ? (personas[0]?.id ?? null) : s.activePersonaId;
      return { personas, activePersonaId };
    });
    get().savePersonas();
  },

  updateSettings: (patch) => {
    let savePersonasFile = false;
    set((s) => {
      const nextSettings = { ...s.settings, ...patch };
      let personas = s.personas;

      if (patch.defaultProvider !== undefined) {
        const p = patch.defaultProvider;
        const model = curatedSmallModelId(p);
        if (s.personas.some((per) => per.provider !== p || per.model !== model)) {
          personas = s.personas.map((persona) => ({ ...persona, provider: p, model }));
          savePersonasFile = true;
        }
      }

      return { settings: nextSettings, personas };
    });
    get().saveSettings();
    if (savePersonasFile) void get().savePersonas();
  },

  updateProviderConfig: (provider, patch) => {
    let savePersonasFile = false;
    set((s) => {
      const nextProviders: Settings["providers"] = {
        ...s.settings.providers,
        [provider]: { ...(s.settings.providers[provider] ?? {}), ...patch },
      };
      let nextSettings: Settings = { ...s.settings, providers: nextProviders };
      let personas = s.personas;

      const cfg = configuredProviders(nextProviders);
      if (cfg.length === 1) {
        const p = cfg[0];
        const model = curatedSmallModelId(p);
        if (s.personas.some((per) => per.provider !== p || per.model !== model)) {
          personas = s.personas.map((persona) => ({ ...persona, provider: p, model }));
          savePersonasFile = true;
        }
        if (nextSettings.defaultProvider !== p) {
          nextSettings = { ...nextSettings, defaultProvider: p };
        }
      }

      return { settings: nextSettings, personas };
    });
    get().saveSettings();
    if (savePersonasFile) void get().savePersonas();
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
    // The "ask" action is the permanent fallback — prevent accidental removal
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
      // Rebuild the array in the new order; ignore unknown ids for safety
      const reordered = orderedIds
        .map((id) => current.find((a) => a.id === id))
        .filter((a): a is QuickAction => a != null);
      return { settings: { ...s.settings, quickActions: reordered } };
    });
    get().saveSettings();
  },
}));

// ── Selector helpers ──────────────────────────────────────────────────────────

export function selectActivePersona(state: PersonaState): Persona | undefined {
  return state.personas.find((p) => p.id === state.activePersonaId);
}

export function selectProviderKey(
  state: PersonaState,
  provider: Settings["defaultProvider"]
): string {
  return state.settings.providers[provider]?.apiKey ?? "";
}

// Note: context building is handled by src/services/contextBuilder.ts
// which uses a tiered strategy (direct → TF-IDF → scout) to stay within
// the model's token limit.  `get_folder_md_contents` is retained in Rust
// as a legacy fallback but is no longer the primary context-fetch path.
