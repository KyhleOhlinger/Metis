import { useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePersonaStore } from "../store/usePersonaStore";
import ModelPicker from "./ModelPicker";
import { type Persona, ICON_PRESETS } from "../types/persona";
import { findProviderProfile } from "../utils/providerProfiles";
import { curatedSmallModelId } from "../services/aiService";

interface Props {
  editing?: Persona;
  onClose: () => void;
}

export default function PersonaCreator({ editing, onClose }: Props) {
  const { upsertPersona, settings } = usePersonaStore(
    useShallow((s) => ({
      upsertPersona: s.upsertPersona,
      settings: s.settings,
    })),
  );

  const defaultProfileId =
    settings.defaultProviderProfileId ??
    settings.providerProfiles[0]?.id ??
    "preset-openai";

  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState(editing?.icon ?? "✍️");
  const [providerProfileId, setProviderProfileId] = useState(
    editing?.providerProfileId ?? defaultProfileId,
  );
  const [model, setModel] = useState(editing?.model ?? "gpt-4o");
  const [systemPrompt, setSystemPrompt] = useState(editing?.systemPrompt ?? "");
  const [error, setError] = useState("");

  const profiles = settings.providerProfiles;

  useEffect(() => {
    if (editing) return;
    const profile = findProviderProfile(settings, providerProfileId);
    if (profile) {
      setModel(
        profile.defaultModel?.trim() || curatedSmallModelId(profile),
      );
    }
  }, [providerProfileId, editing, settings]);

  function handleSave() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!systemPrompt.trim()) {
      setError("System prompt is required.");
      return;
    }
    if (!model.trim()) {
      setError("Model is required.");
      return;
    }

    const persona: Persona = {
      id: editing?.id ?? `persona-${Date.now()}`,
      name: name.trim(),
      icon,
      providerProfileId,
      model: model.trim(),
      systemPrompt: systemPrompt.trim(),
    };
    upsertPersona(persona);
    onClose();
  }

  const activeProfile = findProviderProfile(settings, providerProfileId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[480px] max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-surface-raised shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">
            {editing ? "Edit Persona" : "New Persona"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {ICON_PRESETS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setIcon(emoji)}
                  className={[
                    "h-8 w-8 rounded-md text-base transition-colors",
                    icon === emoji
                      ? "bg-accent/20 ring-1 ring-accent"
                      : "bg-surface-overlay hover:bg-surface-base",
                  ].join(" ")}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Name</Label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Research Assistant"
              className="mt-1 w-full rounded-md border border-border bg-surface-overlay px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <Label>API provider</Label>
            <select
              value={providerProfileId}
              onChange={(e) => setProviderProfileId(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface-overlay px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {activeProfile && !activeProfile.apiKey?.trim() && (
              <p className="mt-1 text-[10px] text-amber-400/90">
                No API key configured for this provider yet.
              </p>
            )}
          </div>

          <div>
            <Label>Model</Label>
            <div className="mt-1">
              <ModelPicker
                profileId={providerProfileId}
                value={model}
                onChange={setModel}
                size="md"
              />
            </div>
          </div>

          <div>
            <Label>System Prompt</Label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              placeholder="You are a helpful assistant..."
              className="mt-1 w-full resize-none rounded-md border border-border bg-surface-overlay px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
            >
              {editing ? "Save Changes" : "Create Persona"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
      {children}
    </span>
  );
}
