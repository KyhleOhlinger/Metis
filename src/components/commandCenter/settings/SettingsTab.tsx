import { useState } from "react";
import type { AiProviderProfile } from "@/types/persona";
import { usePersonaStore } from "@/store/usePersonaStore";
import QuickActionsSettings from "../../QuickActionsSettings";
import { makeProviderProfileId } from "@/utils/providerProfiles";
import { testProviderConnection } from "@/services/llmService";
import { FieldLabel } from "../shared/ui";
import { appConfirm } from "@/store/useToastStore";
import { CollapsibleSection } from "./CollapsibleSection";
import { PersonasSettingsSection } from "./PersonasSettingsSection";
import { ProviderProfilesSection, TestConnectionRow, type TestStatus } from "./ProviderProfilesSection";

export function SettingsTab({
  filterSection,
  settings,
  upsertProviderProfile,
  removeProviderProfile,
  setDefaultProviderProfileId,
  onUpdateSettings,
}: {
  /** When set, only render AI or Personas blocks (used by SettingsPanel). */
  filterSection?: "ai" | "personas";
  settings: ReturnType<typeof usePersonaStore.getState>["settings"];
  upsertProviderProfile: (profile: AiProviderProfile) => void;
  removeProviderProfile: (id: string) => void;
  setDefaultProviderProfileId: (id: string) => void;
  onUpdateSettings: (patch: Partial<typeof settings>) => void;
}) {
  const showPersonas = !filterSection || filterSection === "personas";
  const showAi = !filterSection || filterSection === "ai";
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
      providerKind: "openai-compatible",
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

  const embeddedInCommandCenter = filterSection === undefined;

  return (
    <div
      className={
        embeddedInCommandCenter
          ? "flex-1 min-h-0 overflow-y-auto p-3 space-y-1"
          : "space-y-1"
      }
      {...(embeddedInCommandCenter ? { "data-cc-scroll-region": true } : {})}
    >

      {/* ── Personas ─────────────────────────────────────────────────────── */}
      {showPersonas && <CollapsibleSection
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
        <PersonasSettingsSection hideHeader newPersonaTrigger={newPersonaTrigger} />
      </CollapsibleSection>}

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      {showAi && <CollapsibleSection
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
      </CollapsibleSection>}

      {/* ── AI & privacy (history) ───────────────────────────────────────── */}
      {showAi && <CollapsibleSection title="AI & privacy" defaultOpen={false}>
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
      </CollapsibleSection>}

      {/* ── API Providers ─────────────────────────────────────────────────── */}
      {showAi && <CollapsibleSection
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
          <ProviderProfilesSection
            key={p.id}
            profile={p}
            isDefault={settings.defaultProviderProfileId === p.id}
            onSetDefault={() => setDefaultProviderProfileId(p.id)}
            onSave={upsertProviderProfile}
            onRemove={async () => {
              const ok = await appConfirm(
                `Remove provider "${p.name}"? Personas using it will switch to the default.`,
                { title: "Remove provider", confirmLabel: "Remove", danger: true },
              );
              if (ok) removeProviderProfile(p.id);
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
      </CollapsibleSection>}
    </div>
  );
}
