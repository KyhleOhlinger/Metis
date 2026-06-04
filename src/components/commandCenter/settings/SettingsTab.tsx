import { useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { ICON_PRESETS, type AiProviderProfile, type Persona } from "@/types/persona";
import { usePersonaStore } from "@/store/usePersonaStore";
import QuickActionsSettings from "../../QuickActionsSettings";
import ModelPicker from "../../ModelPicker";
import { SYSTEM_PERSONA_IDS } from "@/systemPersonas/registry";
import { profileForPersona, inferAdapter, findProviderProfile, makeProviderProfileId } from "@/utils/providerProfiles";
import { testProviderConnection, curatedSmallModelId } from "@/services/aiService";
import { FieldLabel } from "../shared/ui";

function CollapsibleSection({
  title,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between mb-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 py-0.5 text-left"
        >
          <svg
            width="8" height="8" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 text-text-muted"
            style={{
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 150ms ease",
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            {title}
          </span>
        </button>
        {action && (
          <div onClick={(e) => e.stopPropagation()} className="ml-2 shrink-0">
            {action}
          </div>
        )}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

type TestStatus =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "ok"; detail: string }
  | { phase: "error"; message: string };

export function SettingsTab({
  settings,
  upsertProviderProfile,
  removeProviderProfile,
  setDefaultProviderProfileId,
  onUpdateSettings,
}: {
  settings: ReturnType<typeof usePersonaStore.getState>["settings"];
  upsertProviderProfile: (profile: AiProviderProfile) => void;
  removeProviderProfile: (id: string) => void;
  setDefaultProviderProfileId: (id: string) => void;
  onUpdateSettings: (patch: Partial<typeof settings>) => void;
}) {
  const profiles = settings.providerProfiles;
  const configuredProfiles = profiles.filter((p) => (p.apiKey ?? "").trim().length > 0);

  const [showAddForm, setShowAddForm] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [draftUrl, setDraftUrl] = useState("https://api.openai.com/v1");
  const [draftModel, setDraftModel] = useState("");
  const [draftTestStatus, setDraftTestStatus] = useState<TestStatus>({ phase: "idle" });

  const [newPersonaTrigger, setNewPersonaTrigger] = useState(0);
  const [newActionTrigger, setNewActionTrigger] = useState(0);

  function resetDraftForm() {
    setShowAddForm(false);
    setDraftName("");
    setDraftKey("");
    setDraftUrl("https://api.openai.com/v1");
    setDraftModel("");
    setDraftTestStatus({ phase: "idle" });
  }

  function draftProfile(): AiProviderProfile {
    return {
      id: makeProviderProfileId(),
      name: draftName.trim() || "Custom provider",
      baseUrl: draftUrl.trim(),
      apiKey: draftKey.trim(),
      defaultModel: draftModel.trim() || undefined,
      adapter: inferAdapter(draftUrl.trim()),
    };
  }

  async function handleDraftTest() {
    if (!draftKey.trim() || !draftUrl.trim()) return;
    setDraftTestStatus({ phase: "testing" });
    const result = await testProviderConnection(draftProfile());
    setDraftTestStatus(
      result.ok
        ? { phase: "ok", detail: result.detail }
        : { phase: "error", message: result.error },
    );
  }

  function handleAddProvider() {
    if (!draftKey.trim() || !draftUrl.trim()) return;
    const profile = draftProfile();
    upsertProviderProfile(profile);
    if (!settings.defaultProviderProfileId) {
      setDefaultProviderProfileId(profile.id);
    }
    resetDraftForm();
  }

  const sectionBtnCls =
    "rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors";

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1" data-cc-scroll-region>

      {/* ── Personas ─────────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="Personas"
        action={
          <button
            onClick={() => setNewPersonaTrigger((n) => n + 1)}
            className={sectionBtnCls}
          >
            + New
          </button>
        }
      >
        <PersonasSection hideHeader newPersonaTrigger={newPersonaTrigger} />
      </CollapsibleSection>

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="Quick Actions"
        defaultOpen={false}
        action={
          <button
            onClick={() => setNewActionTrigger((n) => n + 1)}
            className={sectionBtnCls}
          >
            + New
          </button>
        }
      >
        <QuickActionsSettings hideHeader newActionTrigger={newActionTrigger} />
      </CollapsibleSection>

      {/* ── Spellcheck dictionary ─────────────────────────────────────────── */}
      <CollapsibleSection title="Spellcheck" defaultOpen={false}>
        <div className="space-y-2 text-[11px] text-text-muted">
          <p>Choose which dictionary the spellcheck linter uses.</p>
          <select
            value={settings.spellcheckLanguage ?? "en_US"}
            onChange={(e) => onUpdateSettings({ spellcheckLanguage: e.target.value })}
            className="w-full rounded border border-border bg-surface-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="en_US">English (US)</option>
            <option value="en_GB">English (UK)</option>
          </select>
          <p className="text-[10px] opacity-70">
            Toggle spellcheck on/off from the toolbar (Abc icon).
          </p>
        </div>
      </CollapsibleSection>

      {/* ── AI & privacy (history) ───────────────────────────────────────── */}
      <CollapsibleSection title="AI & privacy" defaultOpen={false}>
        <div className="space-y-3 text-[11px] text-text-muted">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.storeAiHistory !== false}
              onChange={(e) => onUpdateSettings({ storeAiHistory: e.target.checked })}
              className="mt-0.5 rounded border-border"
            />
            <span>
              <span className="font-medium text-text-primary">Store conversation history</span>
              {" "}
              in this session (last 50 runs). Turn off to avoid keeping assistant replies in memory.
            </span>
          </label>
          <div>
            <p className="font-medium text-text-primary mb-1">Max characters per history entry</p>
            <p className="text-[10px] leading-relaxed mb-1.5">
              Large scopes can produce very long replies. Extra text is trimmed before storing.
              Use <span className="font-mono">0</span> for no limit.
            </p>
            <input
              type="number"
              min={0}
              step={1000}
              value={settings.aiHistoryMaxResponseChars ?? 32_000}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 0) {
                  onUpdateSettings({ aiHistoryMaxResponseChars: n });
                }
              }}
              className="w-28 rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── API Providers ─────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="API Providers"
        defaultOpen={true}
        action={
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className={sectionBtnCls}
          >
            {showAddForm ? "Cancel" : "+ Add"}
          </button>
        }
      >
        <div className="space-y-3">
        <p className="text-[10px] text-text-muted leading-relaxed">
          Add any OpenAI-compatible API (OpenAI, Anthropic via <code className="text-[9px]">/v1</code>, Groq, Ollama, Azure, LiteLLM, etc.).
          Enter the provider name, base URL, and API key. Optional default model is used when creating new personas.
        </p>

        {profiles.map((p) => (
          <ProviderProfileSection
            key={p.id}
            profile={p}
            isDefault={settings.defaultProviderProfileId === p.id}
            onSetDefault={() => setDefaultProviderProfileId(p.id)}
            onSave={upsertProviderProfile}
            onRemove={() => {
              if (window.confirm(`Remove provider "${p.name}"? Personas using it will switch to the default.`)) {
                removeProviderProfile(p.id);
              }
            }}
          />
        ))}

        {showAddForm && (
          <div className="rounded-md border border-border bg-surface-overlay p-3 space-y-2">
            <div className="flex items-center justify-between">
              <FieldLabel>New provider</FieldLabel>
              <button onClick={resetDraftForm} className="text-[10px] text-text-muted hover:text-text-primary">
                ✕
              </button>
            </div>
            <div>
              <label className="text-[10px] text-text-muted">Name</label>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. Anthropic, Local Ollama"
                className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-muted">Base URL</label>
              <input
                type="text"
                value={draftUrl}
                onChange={(e) => {
                  setDraftUrl(e.target.value);
                  setDraftTestStatus({ phase: "idle" });
                }}
                placeholder="https://api.openai.com/v1"
                className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-muted">API key</label>
              <input
                type="password"
                value={draftKey}
                onChange={(e) => {
                  setDraftKey(e.target.value);
                  setDraftTestStatus({ phase: "idle" });
                }}
                placeholder="Required"
                className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-muted">Default model <span className="opacity-60">(optional)</span></label>
              <input
                type="text"
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
                className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <TestConnectionRow
              disabled={!draftKey.trim() || !draftUrl.trim()}
              status={draftTestStatus}
              onTest={handleDraftTest}
            />
            <button
              onClick={handleAddProvider}
              disabled={!draftKey.trim() || !draftUrl.trim()}
              className="w-full rounded bg-accent py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-40"
            >
              Save provider
            </button>
          </div>
        )}

        {configuredProfiles.length === 0 && !showAddForm && (
          <p className="text-[11px] text-text-muted">No API keys configured yet — add a provider above.</p>
        )}

        {settings.allowedAiHosts.length > 0 && (
          <p className="text-[9px] text-text-muted opacity-60">
            Allowed hosts: {settings.allowedAiHosts.join(", ")}
          </p>
        )}

        <p className="text-[10px] text-text-muted opacity-50 leading-relaxed">
          Keys are stored locally in the app data directory. Custom base URLs are allowed at runtime (no app rebuild).
        </p>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ── Personas section (inside Settings tab) ────────────────────────────────────

function PersonasSection({
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
                onDelete={() => {
                  if (!window.confirm(`Delete persona "${persona.name}"?`)) return;
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

// ── Single persona row (collapsed + expanded) ─────────────────────────────────

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

// ── Shared inline form (used for create + edit) ───────────────────────────────

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
function TestConnectionRow({
  disabled,
  status,
  onTest,
}: {
  disabled: boolean;
  status: TestStatus;
  onTest: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pt-0.5 flex-wrap">
      <button
        type="button"
        onClick={onTest}
        disabled={disabled || status.phase === "testing"}
        className="flex items-center gap-1 rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-secondary hover:border-accent hover:text-accent disabled:opacity-50 transition-colors"
      >
        {status.phase === "testing" ? "Testing…" : "Test connection"}
      </button>
      {status.phase === "ok" && (
        <span className="text-[10px] text-green-400">{status.detail}</span>
      )}
      {status.phase === "error" && (
        <span className="text-[10px] text-red-400 break-words min-w-0" title={status.message}>
          {status.message}
        </span>
      )}
    </div>
  );
}

function ProviderProfileSection({
  profile,
  isDefault,
  onSetDefault,
  onSave,
  onRemove,
}: {
  profile: AiProviderProfile;
  isDefault: boolean;
  onSetDefault: () => void;
  onSave: (profile: AiProviderProfile) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>({ phase: "idle" });
  const [name, setName] = useState(profile.name);
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl);
  const [apiKey, setApiKey] = useState(profile.apiKey);
  const [defaultModel, setDefaultModel] = useState(profile.defaultModel ?? "");

  useEffect(() => {
    setName(profile.name);
    setBaseUrl(profile.baseUrl);
    setApiKey(profile.apiKey);
    setDefaultModel(profile.defaultModel ?? "");
  }, [profile.id, profile.name, profile.baseUrl, profile.apiKey, profile.defaultModel]);

  function commit(): AiProviderProfile {
    const next: AiProviderProfile = {
      ...profile,
      name: name.trim() || profile.name,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      defaultModel: defaultModel.trim() || undefined,
      adapter: inferAdapter(baseUrl.trim(), profile.adapter),
    };
    onSave(next);
    return next;
  }

  async function runTest() {
    if (!apiKey.trim() || !baseUrl.trim()) {
      setTestStatus({ phase: "error", message: "Enter base URL and API key." });
      return;
    }
    setTestStatus({ phase: "testing" });
    const draft: AiProviderProfile = {
      ...profile,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      adapter: inferAdapter(baseUrl.trim(), profile.adapter),
    };
    const result = await testProviderConnection(draft);
    setTestStatus(
      result.ok
        ? { phase: "ok", detail: result.detail }
        : { phase: "error", message: result.error },
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface-overlay overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-text-primary">{profile.name}</span>
          {isDefault && (
            <span className="ml-2 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-medium text-accent">
              default
            </span>
          )}
          <p className="text-[9px] text-text-muted truncate">{profile.baseUrl}</p>
        </div>
        {!isDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            className="text-[9px] text-text-muted hover:text-accent transition-colors"
          >
            set default
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded p-0.5 text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
        >
          {expanded ? "▲" : "▼"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-0.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-2 pb-2 pt-2 space-y-1.5">
          <div>
            <label className="text-[10px] text-text-muted">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setTestStatus({ phase: "idle" });
              }}
              className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-text-muted">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setTestStatus({ phase: "idle" });
              }}
              className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-text-muted">API key</label>
              <button type="button" onClick={() => setShowKey((v) => !v)} className="text-[9px] text-text-muted">
                {showKey ? "hide" : "show"}
              </button>
            </div>
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestStatus({ phase: "idle" });
              }}
              className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-text-muted">Default model (optional)</label>
            <input
              type="text"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="Used when creating new personas"
              className="mt-0.5 w-full rounded border border-border bg-surface-base px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <TestConnectionRow
            disabled={!apiKey.trim() || !baseUrl.trim()}
            status={testStatus}
            onTest={runTest}
          />
          <button
            type="button"
            onClick={() => commit()}
            className="w-full rounded border border-accent/50 bg-accent/10 py-1 text-[10px] text-accent hover:bg-accent/20"
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}
