/**
 * AI provider profile helpers — user-defined endpoints (name, URL, key, optional default model).
 */

import type {
  AiProviderProfile,
  LegacyAIProvider,
  Persona,
  ProviderKind,
  Settings,
} from "../types/persona";
import { DEFAULT_SETTINGS } from "../types/persona";
import { normalizeHex } from "./themeColors";

/** Shipped Jekyll export defaults removed in v0.9.x — strip on load so settings stay blank. */
const LEGACY_JEKYLL_SHIPPED_AUTHOR = "kyhle";
const LEGACY_JEKYLL_SHIPPED_CATEGORIES = ["Technical"];
const LEGACY_JEKYLL_SHIPPED_IMAGE_SUBFOLDER = "Metis";
const LEGACY_JEKYLL_SHIPPED_SITE_URL = "https://ohlinger.co";
const LEGACY_JEKYLL_SHIPPED_DESCRIPTION =
  "Hi all, My name is Kyhle Öhlinger and this blog post forms part of my personal blog. If you enjoy any of the posts, feel free to reach out and let me know :) ";

function categoriesMatch(a: string[] | undefined, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}

function stripShippedJekyllDefaults(saved: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = { ...saved };
  if (out.jekyllAuthor === LEGACY_JEKYLL_SHIPPED_AUTHOR) delete out.jekyllAuthor;
  if (categoriesMatch(out.jekyllDefaultCategories, LEGACY_JEKYLL_SHIPPED_CATEGORIES)) {
    delete out.jekyllDefaultCategories;
  }
  if (out.jekyllImageSubfolder === LEGACY_JEKYLL_SHIPPED_IMAGE_SUBFOLDER) {
    delete out.jekyllImageSubfolder;
  }
  if (out.jekyllSiteUrl === LEGACY_JEKYLL_SHIPPED_SITE_URL) delete out.jekyllSiteUrl;
  if (out.jekyllDescription === LEGACY_JEKYLL_SHIPPED_DESCRIPTION) {
    delete out.jekyllDescription;
  }
  const root = out.jekyllBlogRoot?.trim();
  if (root && /KyhleOhlinger\.github\.io/i.test(root)) {
    delete out.jekyllBlogRoot;
  }
  return out;
}

export const PRESET_OPENAI = "preset-openai";
export const PRESET_GEMINI = "preset-gemini";
export const PRESET_GROQ = "preset-groq";
export const PRESET_PERPLEXITY = "preset-perplexity";
export const PRESET_ANTHROPIC = "preset-anthropic";
export const PRESET_LITELLM = "preset-litellm";

/** Shipped defaults — users can edit keys/URLs; ids must stay stable for migration. */
export const DEFAULT_PROVIDER_PROFILES: AiProviderProfile[] = [
  {
    id: PRESET_OPENAI,
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    defaultModel: "gpt-4o",
    providerKind: "openai",
  },
  {
    id: PRESET_GEMINI,
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "",
    defaultModel: "gemini-flash-latest",
    providerKind: "google",
  },
  {
    id: PRESET_GROQ,
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: "",
    defaultModel: "llama-3.3-70b-versatile",
    providerKind: "openai-compatible",
  },
  {
    id: PRESET_PERPLEXITY,
    name: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    apiKey: "",
    defaultModel: "sonar-pro",
    providerKind: "openai-compatible",
  },
  {
    id: PRESET_ANTHROPIC,
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "",
    defaultModel: "claude-sonnet-4-20250514",
    providerKind: "anthropic",
  },
  {
    id: PRESET_LITELLM,
    name: "LiteLLM Gateway (local)",
    baseUrl: "http://127.0.0.1:4000/v1",
    apiKey: "",
    defaultModel: "",
    providerKind: "openai-compatible",
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

/** SDK factory selection — see `providerRegistry.ts`. */
export function providerKindForProfile(profile: AiProviderProfile): ProviderKind {
  if (profile.providerKind) return profile.providerKind;
  if (profile.adapter === "gemini-native") return "google";
  switch (profile.id) {
    case PRESET_OPENAI:
      return "openai";
    case PRESET_GEMINI:
      return "google";
    case PRESET_ANTHROPIC:
      return "anthropic";
    default:
      return "openai-compatible";
  }
}

export function isGoogleProvider(profile: AiProviderProfile): boolean {
  return providerKindForProfile(profile) === "google";
}

function migrateProfileRow(
  row: AiProviderProfile,
  preset?: AiProviderProfile,
): AiProviderProfile {
  const providerKind = providerKindForProfile(row);
  let baseUrl = row.baseUrl.trim();
  if (providerKind === "google" && baseUrl.includes("/openai")) {
    baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  }
  return {
    id: row.id,
    name: row.name.trim(),
    baseUrl,
    apiKey: row.apiKey ?? "",
    defaultModel: row.defaultModel?.trim() || preset?.defaultModel,
    providerKind,
  };
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
    byId.set(row.id, migrateProfileRow(
      {
        id: row.id,
        name: row.name.trim(),
        baseUrl: row.baseUrl.trim(),
        apiKey: row.apiKey ?? "",
        defaultModel: row.defaultModel?.trim() || preset?.defaultModel,
        providerKind: row.providerKind,
        adapter: row.adapter ?? preset?.adapter,
      },
      preset,
    ));
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
  const cleaned = stripShippedJekyllDefaults(saved);
  let profiles = mergeProviderProfiles(cleaned.providerProfiles);

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
    cleaned.defaultProviderProfileId ??
    (saved.defaultProvider ? LEGACY_TO_PRESET[saved.defaultProvider] : null) ??
    DEFAULT_SETTINGS.defaultProviderProfileId;

  if (
    defaultProviderProfileId &&
    !profiles.some((p) => p.id === defaultProviderProfileId)
  ) {
    defaultProviderProfileId = profiles[0]?.id ?? PRESET_OPENAI;
  }

  let spellcheckEnabled = cleaned.spellcheckEnabled;
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
    ...cleaned,
    providerProfiles: profiles,
    defaultProviderProfileId,
    allowedAiHosts: collectAllowedAiHosts(profiles),
    quickActions: cleaned.quickActions?.length
      ? cleaned.quickActions
      : DEFAULT_SETTINGS.quickActions,
    spellcheckEnabled,
    editorBgPresetId: cleaned.editorBgPresetId ?? DEFAULT_SETTINGS.editorBgPresetId,
    editorBgCustomColor: (() => {
      const raw = cleaned.editorBgCustomColor ?? DEFAULT_SETTINGS.editorBgCustomColor;
      return normalizeHex(raw ?? "") ?? DEFAULT_SETTINGS.editorBgCustomColor;
    })(),
    stickyDefaults: (() => {
      const raw = cleaned.stickyDefaults ?? {};
      const legacy = raw as { wrap?: boolean; includeWrapBlock?: boolean };
      const includeWrapBlock =
        legacy.includeWrapBlock !== undefined
          ? legacy.includeWrapBlock
          : legacy.wrap === true
            ? true
            : DEFAULT_SETTINGS.stickyDefaults?.includeWrapBlock;
      const { wrap: _legacyWrap, ...rest } = legacy;
      return {
        ...DEFAULT_SETTINGS.stickyDefaults,
        ...rest,
        includeWrapBlock,
      };
    })(),
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
