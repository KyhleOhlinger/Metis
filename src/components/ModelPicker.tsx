/**
 * ModelPicker — combobox for selecting an AI model for a provider profile.
 */

import { useState, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePersonaStore } from "../store/usePersonaStore";
import { findProviderProfile } from "../utils/providerProfiles";
import {
  curatedModelsForProfile,
  curatedSmallModelId,
  type CuratedModel,
} from "../services/aiService";

interface ModelPickerProps {
  profileId: string;
  value: string;
  onChange: (model: string) => void;
  size?: "md" | "sm";
}

const TIER_LABEL: Record<CuratedModel["tier"], string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  reasoning: "Reasoning",
};

const TIER_COLOR: Record<CuratedModel["tier"], string> = {
  small: "text-emerald-400",
  medium: "text-blue-400",
  large: "text-purple-400",
  reasoning: "text-amber-400",
};

export default function ModelPicker({
  profileId,
  value,
  onChange,
  size = "md",
}: ModelPickerProps) {
  const { settings, modelCache, modelFetchStatus, fetchModelsForProfile } =
    usePersonaStore(
      useShallow((s) => ({
        settings: s.settings,
        modelCache: s.modelCache,
        modelFetchStatus: s.modelFetchStatus,
        fetchModelsForProfile: s.fetchModelsForProfile,
      })),
    );

  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  const profile = findProviderProfile(settings, profileId);
  const hasKey = !!profile?.apiKey?.trim();
  const cached = modelCache[profileId];
  const isLoading = modelFetchStatus[profileId] === "loading";
  const placeholder =
    profile?.defaultModel?.trim() ||
    (profile ? curatedSmallModelId(profile) : "model-id");

  useEffect(() => {
    setInputValue(value);
  }, [value, profileId]);

  useEffect(() => {
    if (hasKey && profile) {
      void fetchModelsForProfile(profile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, profile?.apiKey]);

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

  const query = inputValue.trim().toLowerCase();
  const preferred = curatedModelsForProfile(profileId);

  const tierOf = (id: string): CuratedModel["tier"] | undefined =>
    preferred.find((p) => p.id === id)?.tier;

  type Suggestion = { id: string; tier?: CuratedModel["tier"] };
  let suggestions: Suggestion[];

  const isFiltering = query && query !== value.toLowerCase();

  if (isFiltering) {
    const fetchedIds = cached?.models ?? [];
    const pool = fetchedIds.length > 0 ? fetchedIds : preferred.map((p) => p.id);
    suggestions = pool
      .filter((id) => id.toLowerCase().includes(query))
      .slice(0, 8)
      .map((id) => ({ id, tier: tierOf(id) }));
  } else {
    suggestions = preferred;
  }

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

  const inputCls =
    size === "sm"
      ? "flex-1 min-w-0 rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
      : "flex-1 min-w-0 rounded-md border border-border bg-surface-overlay px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono";

  const refreshCls =
    size === "sm"
      ? "shrink-0 rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
      : "shrink-0 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed";

  const providerLabel = profile?.name ?? "provider";

  return (
    <div ref={containerRef} className="relative">
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
            setTimeout(() => {
              if (!containerRef.current?.contains(document.activeElement)) {
                setOpen(false);
                const trimmed = inputValue.trim();
                if (trimmed) onChange(trimmed);
              }
            }, 150);
          }}
          placeholder={placeholder}
          className={inputCls}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (profile) void fetchModelsForProfile(profile, true);
          }}
          disabled={!hasKey || isLoading}
          title={
            hasKey
              ? "Refresh model list"
              : `Add an API key for ${providerLabel} in Settings → API Providers`
          }
          className={refreshCls}
        >
          {isLoading ? "…" : "↺"}
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <div
          className={`absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-surface-raised shadow-xl ${
            size === "sm" ? "text-[10px]" : "text-xs"
          }`}
        >
          {suggestions.map(({ id, tier }) => (
            <button
              key={id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
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

      {!hasKey && (
        <p
          className={`mt-1 text-text-muted opacity-60 ${
            size === "sm" ? "text-[9px]" : "text-[10px]"
          }`}
        >
          Add an API key for <strong>{providerLabel}</strong> in{" "}
          <span className="font-medium">Settings → API Providers</span> to fetch
          the full model list.
        </p>
      )}
    </div>
  );
}
