/**
 * AI provider profile helpers — user-defined endpoints (name, URL, key, optional default model).
 */

import type {
  AiProviderProfile,
  LegacyAIProvider,
  Persona,
  ProviderAdapter,
  Settings,
} from "../types/persona";
import { DEFAULT_SETTINGS } from "../types/persona";

export const PRESET_OPENAI = "preset-openai";
export const PRESET_GEMINI = "preset-gemini";
export const PRESET_GROQ = "preset-groq";
export const PRESET_PERPLEXITY = "preset-perplexity";

/** Shipped defaults — users can edit keys/URLs; ids must stay stable for migration. */
export const DEFAULT_PROVIDER_PROFILES: AiProviderProfile[] = [
  {
    id: PRESET_OPENAI,
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    defaultModel: "gpt-4o",
    adapter: "openai-compat",
  },
  {
    id: PRESET_GEMINI,
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: "",
    defaultModel: "gemini-flash-latest",
    adapter: "gemini-native",
  },
  {
    id: PRESET_GROQ,
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: "",
    defaultModel: "llama-3.3-70b-versatile",
    adapter: "openai-compat",
  },
  {
    id: PRESET_PERPLEXITY,
    name: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    apiKey: "",
    defaultModel: "sonar-pro",
    adapter: "openai-compat",
  },
];

const LEGACY_TO_PRESET: Record<LegacyAIProvider, string> = {
  openai: PRESET_OPENAI,
  gemini: PRESET_GEMINI,
  groq: PRESET_GROQ,
  perplexity: PRESET_PERPLEXITY,
};

export function makeProviderProfileId(): string {
  return `prov-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Parse hostname from a base URL for allowlist / preflight checks. */
export function hostFromBaseUrl(baseUrl: string): string | null {
  const raw = baseUrl.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Collect unique hostnames from all configured profiles (non-empty API keys optional). */
export function collectAllowedAiHosts(profiles: AiProviderProfile[]): string[] {
  const hosts = new Set<string>();
  for (const p of profiles) {
    const h = hostFromBaseUrl(p.baseUrl);
    if (h) hosts.add(h);
  }
  return [...hosts].sort();
}

export function findProviderProfile(
  settings: Settings,
  id: string | null | undefined,
): AiProviderProfile | undefined {
  if (!id) return undefined;
  return settings.providerProfiles.find((p) => p.id === id);
}

export function profileForPersona(
  settings: Settings,
  persona: Persona,
): AiProviderProfile | undefined {
  return findProviderProfile(settings, persona.providerProfileId);
}

/** Merge preset rows with persisted profiles; inject new presets on upgrade. */
export function mergeProviderProfiles(
  persisted: AiProviderProfile[] | undefined,
): AiProviderProfile[] {
  const byId = new Map<string, AiProviderProfile>();
  for (const preset of DEFAULT_PROVIDER_PROFILES) {
    byId.set(preset.id, { ...preset });
  }
  for (const row of persisted ?? []) {
    if (!row?.id || !row.name?.trim() || !row.baseUrl?.trim()) continue;
    const preset = byId.get(row.id);
    byId.set(row.id, {
      id: row.id,
      name: row.name.trim(),
      baseUrl: row.baseUrl.trim(),
      apiKey: row.apiKey ?? "",
      defaultModel: row.defaultModel?.trim() || preset?.defaultModel,
      adapter: row.adapter ?? preset?.adapter ?? "openai-compat",
    });
  }
  return [...byId.values()];
}

type LegacySettings = Settings & {
  providers?: Partial<
    Record<
      LegacyAIProvider,
      { apiKey?: string; baseUrl?: string }
    >
  >;
  defaultProvider?: LegacyAIProvider;
};

/** Upgrade settings.json from the old fixed four-provider map. */
export function migrateSettings(saved: Partial<LegacySettings>): Settings {
  let profiles = mergeProviderProfiles(saved.providerProfiles);

  const legacy = saved.providers;
  if (legacy && typeof legacy === "object") {
    for (const [key, cfg] of Object.entries(legacy) as [
      LegacyAIProvider,
      { apiKey?: string; baseUrl?: string } | undefined,
    ][]) {
      const presetId = LEGACY_TO_PRESET[key];
      if (!presetId || !cfg) continue;
      const idx = profiles.findIndex((p) => p.id === presetId);
      if (idx < 0) continue;
      const prev = profiles[idx];
      const apiKey = (cfg.apiKey ?? "").trim() || prev.apiKey;
      const baseUrl = (cfg.baseUrl ?? "").trim() || prev.baseUrl;
      profiles[idx] = { ...prev, apiKey, baseUrl };
    }
  }

  let defaultProviderProfileId =
    saved.defaultProviderProfileId ??
    (saved.defaultProvider ? LEGACY_TO_PRESET[saved.defaultProvider] : null) ??
    DEFAULT_SETTINGS.defaultProviderProfileId;

  if (
    defaultProviderProfileId &&
    !profiles.some((p) => p.id === defaultProviderProfileId)
  ) {
    defaultProviderProfileId = profiles[0]?.id ?? PRESET_OPENAI;
  }

  let spellcheckEnabled = saved.spellcheckEnabled;
  if (spellcheckEnabled === undefined) {
    try {
      spellcheckEnabled = localStorage.getItem("metis_spellcheck") === "true";
      if (spellcheckEnabled) localStorage.removeItem("metis_spellcheck");
    } catch {
      spellcheckEnabled = DEFAULT_SETTINGS.spellcheckEnabled;
    }
  }

  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    providerProfiles: profiles,
    defaultProviderProfileId,
    allowedAiHosts: collectAllowedAiHosts(profiles),
    quickActions: saved.quickActions?.length
      ? saved.quickActions
      : DEFAULT_SETTINGS.quickActions,
    spellcheckEnabled,
    editorBgPresetId: saved.editorBgPresetId ?? DEFAULT_SETTINGS.editorBgPresetId,
    stickyDefaults: {
      ...DEFAULT_SETTINGS.stickyDefaults,
      ...saved.stickyDefaults,
    },
  };
}

type LegacyPersona = Persona & { provider?: LegacyAIProvider };

export function migratePersona(
  persona: LegacyPersona,
  settings: Settings,
): Persona {
  if (persona.providerProfileId) {
    return {
      id: persona.id,
      name: persona.name,
      icon: persona.icon,
      systemPrompt: persona.systemPrompt,
      model: persona.model,
      providerProfileId: persona.providerProfileId,
      disabled: persona.disabled,
    };
  }
  const legacy = persona.provider;
  const profileId = legacy ? LEGACY_TO_PRESET[legacy] : settings.defaultProviderProfileId ?? PRESET_OPENAI;
  const profile = findProviderProfile(settings, profileId);
  const model =
    persona.model?.trim() ||
    profile?.defaultModel ||
    DEFAULT_PROVIDER_PROFILES[0].defaultModel!;

  return {
    id: persona.id,
    name: persona.name,
    icon: persona.icon,
    systemPrompt: persona.systemPrompt,
    model,
    providerProfileId: profileId,
    disabled: persona.disabled,
  };
}

/** Official Google Generative Language API host (exact match — blocks typosquatting). */
export const OFFICIAL_GEMINI_API_HOST = "generativelanguage.googleapis.com";

export function isOfficialGeminiApiHost(hostname: string): boolean {
  return hostname.trim().toLowerCase() === OFFICIAL_GEMINI_API_HOST;
}

export function inferAdapter(baseUrl: string, explicit?: ProviderAdapter): ProviderAdapter {
  if (explicit) return explicit;
  const host = hostFromBaseUrl(baseUrl);
  if (host && isOfficialGeminiApiHost(host)) return "gemini-native";
  return "openai-compat";
}
