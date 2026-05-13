/**
 * ModelPicker — a Cursor-style combobox for selecting an AI model.
 *
 * Behaviour:
 *   • Always shows an editable text input so users can type any model name.
 *   • On focus, a dropdown appears with up to 5 curated suggestions per
 *     provider (small / medium / large / reasoning tiers).
 *   • While typing, suggestions are filtered from the full fetched model list
 *     (if available) or from the curated defaults — max 8 results.
 *   • A refresh button (↺) triggers a background re-fetch.  Disabled with a
 *     tooltip when no API key is configured for the provider.
 *   • Pressing Enter or clicking away commits the typed value.
 *   • No separate "manual entry" mode — the input IS the entry point.
 */

import { useState, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePersonaStore } from "../store/usePersonaStore";
import {
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  type AIProvider,
} from "../types/persona";
import {
  PROVIDER_PREFERRED_MODELS,
  type CuratedModel,
} from "../services/aiService";

interface ModelPickerProps {
  provider: AIProvider;
  value: string;
  onChange: (model: string) => void;
  /** Size variant — "md" for PersonaCreator modal, "sm" for inline Settings form */
  size?: "md" | "sm";
}

// ── Tier display metadata ─────────────────────────────────────────────────────

const TIER_LABEL: Record<CuratedModel["tier"], string> = {
  small:     "Small",
  medium:    "Medium",
  large:     "Large",
  reasoning: "Reasoning",
};

const TIER_COLOR: Record<CuratedModel["tier"], string> = {
  small:     "text-emerald-400",
  medium:    "text-blue-400",
  large:     "text-purple-400",
  reasoning: "text-amber-400",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ModelPicker({
  provider,
  value,
  onChange,
  size = "md",
}: ModelPickerProps) {
  const {
    settings,
    modelCache,
    modelFetchStatus,
    fetchModelsForProvider,
  } = usePersonaStore(
    useShallow((s) => ({
      settings: s.settings,
      modelCache: s.modelCache,
      modelFetchStatus: s.modelFetchStatus,
      fetchModelsForProvider: s.fetchModelsForProvider,
    })),
  );

  const [open, setOpen]             = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const containerRef                = useRef<HTMLDivElement>(null);

  const providerConfig = settings.providers[provider];
  const hasKey         = !!providerConfig?.apiKey?.trim();
  const cached         = modelCache[provider];
  const isLoading      = modelFetchStatus[provider] === "loading";

  // ── Sync input when external value or provider changes ────────────────────
  useEffect(() => {
    setInputValue(value);
  }, [value, provider]);

  // ── Auto-fetch on provider / key change (respects 30-min TTL cache) ───────
  useEffect(() => {
    if (hasKey && providerConfig) {
      fetchModelsForProvider(provider, providerConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, providerConfig?.apiKey]);

  // ── Close dropdown on outside click, commit typed value ───────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        const trimmed = inputValue.trim();
        if (trimmed) onChange(trimmed);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [inputValue, onChange]);

  // ── Build suggestion list ─────────────────────────────────────────────────
  const query     = inputValue.trim().toLowerCase();
  const preferred = PROVIDER_PREFERRED_MODELS[provider];

  // Tier lookup for any model ID (covers preferred + extras from fetched list)
  const tierOf = (id: string): CuratedModel["tier"] | undefined =>
    preferred.find((p) => p.id === id)?.tier;

  type Suggestion = { id: string; tier?: CuratedModel["tier"] };
  let suggestions: Suggestion[];

  const isFiltering = query && query !== value.toLowerCase();

  if (isFiltering) {
    // Search across the full fetched list when user types
    const fetchedIds = cached?.models ?? [];
    const pool       = fetchedIds.length > 0 ? fetchedIds : preferred.map((p) => p.id);
    suggestions = pool
      .filter((id) => id.toLowerCase().includes(query))
      .slice(0, 8)
      .map((id) => ({ id, tier: tierOf(id) }));
  } else {
    // Default: show the curated 5
    suggestions = preferred;
  }

  // ── Interaction handlers ──────────────────────────────────────────────────
  const handleSelect = (id: string) => {
    onChange(id);
    setInputValue(id);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (trimmed) onChange(trimmed);
      setOpen(false);
    }
  };

  // ── Style helpers ─────────────────────────────────────────────────────────
  const inputCls =
    size === "sm"
      ? "flex-1 min-w-0 rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
      : "flex-1 min-w-0 rounded-md border border-border bg-surface-overlay px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono";

  const refreshCls =
    size === "sm"
      ? "shrink-0 rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
      : "shrink-0 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative">

      {/* ── Input row ─────────────────────────────────────────────────── */}
      <div className="flex gap-1.5">
        <input
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Delay so an onMouseDown on a suggestion fires first
            setTimeout(() => {
              if (!containerRef.current?.contains(document.activeElement)) {
                setOpen(false);
                const trimmed = inputValue.trim();
                if (trimmed) onChange(trimmed);
              }
            }, 150);
          }}
          placeholder={DEFAULT_MODELS[provider]}
          className={inputCls}
          spellCheck={false}
          autoComplete="off"
        />

        {/* Refresh / fetch button */}
        <button
          onMouseDown={(e) => e.preventDefault()} // keep input focus
          onClick={() => {
            if (providerConfig) fetchModelsForProvider(provider, providerConfig, true);
          }}
          disabled={!hasKey || isLoading}
          title={
            hasKey
              ? "Refresh model list"
              : `Add a ${PROVIDER_LABELS[provider]} key in Settings → API Providers to fetch models`
          }
          className={refreshCls}
        >
          {isLoading ? (
            <svg
              className="animate-spin"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          ) : (
            "↺"
          )}
        </button>
      </div>

      {/* ── Suggestions dropdown — max-h-60 + overflow-y-auto so long lists scroll */}
      {open && suggestions.length > 0 && (
        <div
          className={`absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-surface-raised shadow-xl ${
            size === "sm" ? "text-[10px]" : "text-xs"
          }`}
        >
          {suggestions.map(({ id, tier }) => (
            <button
              key={id}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent input blur before click
                handleSelect(id);
              }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-surface-overlay ${
                id === value
                  ? "bg-surface-overlay text-accent"
                  : "text-text-primary"
              }`}
            >
              <span className="truncate font-mono">{id}</span>
              {tier && (
                <span
                  className={`ml-3 shrink-0 font-sans text-[9px] font-semibold uppercase tracking-wider ${TIER_COLOR[tier]}`}
                >
                  {TIER_LABEL[tier]}
                </span>
              )}
            </button>
          ))}

          {/* Footer: cache info + search hint */}
          {cached && (
            <div
              className={`border-t border-border px-3 py-1 text-text-muted opacity-50 ${
                size === "sm" ? "text-[8px]" : "text-[9px]"
              }`}
            >
              {isFiltering
                ? `Searching ${cached.models.length} fetched models`
                : `${cached.models.length} models available · type to search all`}
            </div>
          )}
        </div>
      )}

      {/* ── No API key hint ────────────────────────────────────────────── */}
      {!hasKey && (
        <p
          className={`mt-1 text-text-muted opacity-60 ${
            size === "sm" ? "text-[9px]" : "text-[10px]"
          }`}
        >
          Add a <strong>{PROVIDER_LABELS[provider]}</strong> key in{" "}
          <span className="font-medium">Settings → API Providers</span> to fetch
          the full model list.
        </p>
      )}
    </div>
  );
}
