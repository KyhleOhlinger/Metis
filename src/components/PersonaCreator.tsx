import { useState, useEffect } from "react";
import { usePersonaStore } from "../store/usePersonaStore";
import ModelPicker from "./ModelPicker";
import {
  type Persona,
  type AIProvider,
  PROVIDER_LABELS,
  DEFAULT_MODELS,
  ICON_PRESETS,
} from "../types/persona";

interface Props {
  /** Persona to edit, or undefined for "create new" */
  editing?: Persona;
  onClose: () => void;
}

export default function PersonaCreator({ editing, onClose }: Props) {
  const upsertPersona = usePersonaStore((s) => s.upsertPersona);

  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState(editing?.icon ?? "✍️");
  const [provider, setProvider] = useState<AIProvider>(editing?.provider ?? "openai");
  const [model, setModel] = useState(editing?.model ?? DEFAULT_MODELS.openai);
  const [systemPrompt, setSystemPrompt] = useState(editing?.systemPrompt ?? "");
  const [error, setError] = useState("");

  // Reset to the provider's default model when switching providers (new personas only)
  useEffect(() => {
    if (!editing) setModel(DEFAULT_MODELS[provider]);
  }, [provider, editing]);

  function handleSave() {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!systemPrompt.trim()) { setError("System prompt is required."); return; }
    if (!model.trim()) { setError("Model is required."); return; }

    const persona: Persona = {
      id: editing?.id ?? `persona-${Date.now()}`,
      name: name.trim(),
      icon,
      provider,
      model: model.trim(),
      systemPrompt: systemPrompt.trim(),
    };
    upsertPersona(persona);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[480px] max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-surface-raised shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">
            {editing ? "Edit Persona" : "New Persona"}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* Icon picker */}
          <div>
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {ICON_PRESETS.map((emoji) => (
                <button
                  key={emoji}
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

          {/* Name */}
          <div>
            <Label>Name</Label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Research Assistant"
              className="mt-1 w-full rounded-md border border-border bg-surface-overlay px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>

          {/* Provider */}
          <div>
            <Label>Provider</Label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AIProvider)}
              className="mt-1 w-full rounded-md border border-border bg-surface-overlay px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              {(Object.keys(PROVIDER_LABELS) as AIProvider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </div>

          {/* Model — cached, searchable, auto-fetched */}
          <div>
            <Label>Model</Label>
            <div className="mt-1">
              <ModelPicker
                provider={provider}
                value={model}
                onChange={setModel}
                size="md"
              />
            </div>
          </div>

          {/* System prompt */}
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

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
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
