import { useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { ICON_PRESETS, type Persona } from "@/types/persona";
import { usePersonaStore } from "@/store/usePersonaStore";
import ModelPicker from "../../ModelPicker";
import { SYSTEM_PERSONA_IDS } from "@/systemPersonas/registry";
import { profileForPersona, findProviderProfile } from "@/utils/providerProfiles";
import { curatedSmallModelId } from "@/services/llmService";
import { FieldLabel } from "../shared/ui";
import { appConfirm } from "@/store/useToastStore";

export function PersonasSettingsSection({
  hideHeader = false,
  newPersonaTrigger = 0,
}: {
  hideHeader?: boolean;
  newPersonaTrigger?: number;
}) {
  const { personas, upsertPersona, deletePersona } = usePersonaStore(
    useShallow((s) => ({
      personas: s.personas,
      upsertPersona: s.upsertPersona,
      deletePersona: s.deletePersona,
    })),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // When the parent increments the trigger, open the new-persona form
  useEffect(() => {
    if (newPersonaTrigger > 0) {
      setShowNewForm(true);
      setExpandedId(null);
    }
  }, [newPersonaTrigger]);

  return (
    <div>
      {!hideHeader && (
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Personas
          </p>
          <button
            onClick={() => { setShowNewForm(true); setExpandedId(null); }}
            className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
            title="New persona"
          >
            + New
          </button>
        </div>
      )}

      <div className="space-y-3">
        {/* System Default personas */}
        {(() => {
          const systemPersonas = [...personas].filter((p) => SYSTEM_PERSONA_IDS.has(p.id));
          const customPersonas = [...personas].filter((p) => !SYSTEM_PERSONA_IDS.has(p.id));
          const renderRow = (persona: Persona) => {
            const isSystem = SYSTEM_PERSONA_IDS.has(persona.id);
            return (
              <PersonaRow
                key={persona.id}
                persona={persona}
                isSystemDefault={isSystem}
                expanded={expandedId === persona.id}
                onToggle={() =>
                  setExpandedId((prev) => {
                    setShowNewForm(false);
                    return prev === persona.id ? null : persona.id;
                  })
                }
                onToggleEnabled={() =>
                  upsertPersona({ ...persona, disabled: !persona.disabled })
                }
                onSave={(updated) => { upsertPersona(updated); setExpandedId(null); }}
                onDelete={async () => {
                  const ok = await appConfirm(`Delete persona "${persona.name}"?`, {
                    title: "Delete persona",
                    confirmLabel: "Delete",
                    danger: true,
                  });
                  if (!ok) return;
                  deletePersona(persona.id);
                  if (expandedId === persona.id) setExpandedId(null);
                }}
              />
            );
          };
          return (
            <>
              {systemPersonas.length > 0 && (
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">
                    System Default
                  </p>
                  <div className="space-y-1">{systemPersonas.map(renderRow)}</div>
                </div>
              )}
              {customPersonas.length > 0 && (
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">
                    Custom
                  </p>
                  <div className="space-y-1">{customPersonas.map(renderRow)}</div>
                </div>
              )}
            </>
          );
        })()}

        {showNewForm && (
          <PersonaInlineForm
            onSave={(p) => { upsertPersona(p); setShowNewForm(false); }}
            onCancel={() => setShowNewForm(false)}
          />
        )}
      </div>
    </div>
  );
}

interface PersonaRowProps {
  persona: Persona;
  isSystemDefault: boolean;
  expanded: boolean;
  onToggle: () => void;
  onToggleEnabled: () => void;
  onSave: (updated: Persona) => void;
  onDelete: () => void;
}

function PersonaRow({ persona, isSystemDefault, expanded, onToggle, onToggleEnabled, onSave, onDelete }: PersonaRowProps) {
  const settings = usePersonaStore((s) => s.settings);
  const profile = profileForPersona(settings, persona);
  const providerLabel = profile?.name ?? "Unknown provider";
  const enabled = !persona.disabled;
  return (
    <div className={`rounded-md border overflow-hidden transition-opacity ${enabled ? "border-border bg-surface-overlay" : "border-border/50 bg-surface-overlay/50 opacity-60"}`}>
      {/* Collapsed header */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="text-base leading-none">{persona.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium text-text-primary truncate">{persona.name}</p>
            {isSystemDefault && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-text-muted bg-surface-raised border border-border/60">
                System
              </span>
            )}
          </div>
          <p className="text-[10px] text-text-muted">
            {providerLabel} · {persona.model}
          </p>
        </div>

        {/* Enable / disable toggle */}
        <button
          onClick={onToggleEnabled}
          title={enabled ? "Disable — hide from AI tab" : "Enable — show in AI tab"}
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none ${enabled ? "bg-accent" : "bg-surface-raised border border-border"}`}
        >
          <span className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-3.5" : "translate-x-0.5"}`} />
        </button>

        <button
          onClick={onToggle}
          title={expanded ? "Collapse" : "Edit"}
          className="rounded p-0.5 text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            {expanded
              ? <polyline points="18 15 12 9 6 15" />
              : <polyline points="6 9 12 15 18 9" />}
          </svg>
        </button>

        {/* Delete — hidden for system defaults */}
        {!isSystemDefault && (
          <button
            onClick={onDelete}
            title="Delete persona"
            className="rounded p-0.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border px-2 pb-2 pt-2">
          <PersonaInlineForm
            initial={persona}
            isSystemDefault={isSystemDefault}
            onSave={onSave}
            onCancel={onToggle}
          />
        </div>
      )}
    </div>
  );
}

interface PersonaInlineFormProps {
  initial?: Persona;
  /** When true (built-in Librarian / Task Manager), name and system prompt are fixed — only icon, provider, and model are editable. */
  isSystemDefault?: boolean;
  onSave: (p: Persona) => void;
  onCancel: () => void;
}

function PersonaInlineForm({ initial, isSystemDefault = false, onSave, onCancel }: PersonaInlineFormProps) {
  const settings = usePersonaStore((s) => s.settings);
  const defaultProfileId =
    settings.defaultProviderProfileId ??
    settings.providerProfiles[0]?.id ??
    "preset-openai";

  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "✍️");
  const [providerProfileId, setProviderProfileId] = useState(
    initial?.providerProfileId ?? defaultProfileId,
  );
  const [model, setModel] = useState(initial?.model ?? "gpt-4o");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [error, setError] = useState("");
  const [showFullPrompt, setShowFullPrompt] = useState(false);

  const profiles = settings.providerProfiles;

  function handleSave() {
    const finalName = isSystemDefault && initial ? initial.name : name.trim();
    const finalPrompt = isSystemDefault && initial ? initial.systemPrompt : systemPrompt.trim();
    if (!finalName.trim()) { setError("Name is required."); return; }
    if (!finalPrompt.trim()) { setError("System prompt is required."); return; }
    if (!model.trim()) { setError("Model is required."); return; }
    onSave({
      id: initial?.id ?? `persona-${Date.now()}`,
      name: finalName.trim(),
      icon,
      providerProfileId,
      model: model.trim(),
      systemPrompt: finalPrompt.trim(),
      ...(initial?.disabled !== undefined ? { disabled: initial.disabled } : {}),
    });
  }

  return (
    <div className="space-y-2">
      {/* Icon row */}
      <div>
        <FieldLabel>Icon</FieldLabel>
        <div className="flex flex-wrap gap-1 mt-1">
          {ICON_PRESETS.map((e) => (
            <button
              key={e}
              onClick={() => setIcon(e)}
              className={[
                "h-6 w-6 rounded text-xs transition-colors",
                icon === e ? "bg-accent/20 ring-1 ring-accent" : "bg-surface-base hover:bg-surface-raised",
              ].join(" ")}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Name — fixed for system default personas */}
      <div>
        <FieldLabel>Name</FieldLabel>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={isSystemDefault}
          placeholder="e.g. Research Assistant"
          title={isSystemDefault ? "Built-in persona name cannot be changed" : undefined}
          className={[
            "mt-0.5 w-full rounded border border-border px-2 py-1 text-xs placeholder:text-text-muted focus:outline-none",
            isSystemDefault
              ? "cursor-default bg-surface-raised/60 text-text-muted border-border/70"
              : "bg-surface-base text-text-primary focus:border-accent",
          ].join(" ")}
        />
      </div>

      {/* API provider profile */}
      <div>
        <FieldLabel>API provider</FieldLabel>
        <select
          value={providerProfileId}
          onChange={(e) => {
            const id = e.target.value;
            setProviderProfileId(id);
            if (!initial) {
              const profile = findProviderProfile(settings, id);
              if (profile) {
                setModel(
                  profile.defaultModel?.trim() || curatedSmallModelId(profile),
                );
              }
            }
          }}
          className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Model — cached, searchable, auto-fetched */}
      <div>
        <FieldLabel>Model</FieldLabel>
        <div className="mt-0.5">
          <ModelPicker
            profileId={providerProfileId}
            value={model}
            onChange={setModel}
            size="sm"
          />
        </div>
      </div>

      {/* System prompt — read-only for system default personas (expand still helps reading) */}
      <div>
        <div className="flex items-center justify-between">
          <FieldLabel>System Prompt</FieldLabel>
          <button
            type="button"
            onClick={() => setShowFullPrompt((v) => !v)}
            className="text-[9px] text-text-muted hover:text-text-primary transition-colors"
          >
            {showFullPrompt ? "collapse" : "expand"}
          </button>
        </div>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          readOnly={isSystemDefault}
          rows={showFullPrompt ? 8 : 3}
          placeholder="You are a helpful assistant..."
          title={isSystemDefault ? "Built-in persona instructions cannot be changed" : undefined}
          className={[
            "mt-0.5 w-full resize-none rounded border px-2 py-1 text-xs placeholder:text-text-muted focus:outline-none",
            isSystemDefault
              ? "cursor-default bg-surface-raised/60 text-text-muted border-border/70"
              : "border-border bg-surface-base text-text-primary focus:border-accent",
          ].join(" ")}
        />
      </div>

      {error && <p className="text-[10px] text-red-400">{error}</p>}

      <div className="flex justify-end gap-1.5 pt-0.5">
        <button
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
        >
          {initial ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}
