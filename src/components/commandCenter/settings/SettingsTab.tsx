import { useState } from "react";
import type { AiProviderProfile } from "@/types/persona";
import { usePersonaStore } from "@/store/usePersonaStore";
import QuickActionsSettings from "../../QuickActionsSettings";
import { makeProviderProfileId } from "@/utils/providerProfiles";
import { assertSafeProviderUrl, packagedHttpsHostHint } from "@/utils/providerUrlSafety";
import { testProviderConnection } from "@/services/llmService";
import { ccInputCls, FieldLabel, Hint, SectionAction } from "../shared/ui";
import { changeDefaultProviderWithPrompt } from "@/utils/defaultProviderChange";
import { appConfirm } from "@/store/useToastStore";
import { CollapsibleSection } from "./CollapsibleSection";
import { PersonasSettingsSection } from "./PersonasSettingsSection";
import { ProviderProfilesSection, TestConnectionRow, type TestStatus } from "./ProviderProfilesSection";

export function SettingsTab({
  filterSection,
  settings,
  upsertProviderProfile,
  removeProviderProfile,
  onUpdateSettings,
}: {
  /** When set, only render AI or Personas blocks (used by SettingsPanel). */
  filterSection?: "ai" | "personas";
  settings: ReturnType<typeof usePersonaStore.getState>["settings"];
  upsertProviderProfile: (profile: AiProviderProfile) => void;
  removeProviderProfile: (id: string) => void;
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
    try {
      assertSafeProviderUrl(draftUrl.trim());
    } catch (e) {
      setDraftTestStatus({
        phase: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    const profile = draftProfile();
    upsertProviderProfile(profile);
    if (!settings.defaultProviderProfileId) {
      void handleSetDefault(profile.id);
    }
    resetDraftForm();
  }

  async function handleSetDefault(profileId: string) {
    const state = usePersonaStore.getState();
    await changeDefaultProviderWithPrompt({
      newProfileId: profileId,
      currentDefaultId: state.settings.defaultProviderProfileId,
      personas: state.personas,
      settings: state.settings,
      setDefaultProviderProfileId: state.setDefaultProviderProfileId,
      setAllPersonasProviderProfile: state.setAllPersonasProviderProfile,
    });
  }

  const sectionBtnCls =
    "rounded px-1.5 py-0.5 text-[10px] font-medium text-text-muted transition-colors hover:bg-surface-base/50 hover:text-text-primary";

  const embeddedInCommandCenter = filterSection === undefined;
  const inputCls = `${ccInputCls} mt-0.5`;

  return (
    <div
      className={
        embeddedInCommandCenter
          ? "flex-1 min-h-0 space-y-3 overflow-y-auto p-3"
          : "space-y-3"
      }
      {...(embeddedInCommandCenter ? { "data-cc-scroll-region": true } : {})}
    >
      {embeddedInCommandCenter && (
        <div className="space-y-1.5">
          <p className="text-[11px] leading-relaxed text-text-secondary">
            Providers, personas, quick actions, and privacy for the AI tab.
          </p>
          <SectionAction onClick={() => usePersonaStore.getState().openSettings("ai")}>
            Full settings (⌘,)…
          </SectionAction>
        </div>
      )}
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
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={settings.storeAiHistory !== false}
              onChange={(e) => onUpdateSettings({ storeAiHistory: e.target.checked })}
              className="mt-0.5 rounded border-border"
            />
            <span>
              <span className="font-medium text-text-primary">Store conversation history</span>
              {" "}
              in this session (last 50 runs) and in the Agent Run Log (preview index plus full
              request/response sidecars). Turn off to skip storing assistant replies.
            </span>
          </label>
          <div>
            <FieldLabel>Max characters per history entry</FieldLabel>
            <Hint>
              Large scopes can produce very long replies. Extra text is trimmed before storing. Use{" "}
              <span className="font-mono">0</span> for no limit.
            </Hint>
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
              className={`${ccInputCls} mt-1.5 w-28`}
            />
          </div>
          <p>
            Planner AI sends every tab unless you exclude sections in{" "}
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => usePersonaStore.getState().openSettings("planner")}
            >
              Settings → Planner
            </button>
            .
          </p>
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
        <Hint>
          Add an OpenAI-compatible API (name, base URL, API key).{" "}
          {packagedHttpsHostHint()} Other public HTTPS hosts need a capability/CSP rebuild.
        </Hint>

        {profiles.map((p) => (
          <ProviderProfilesSection
            key={p.id}
            profile={p}
            isDefault={settings.defaultProviderProfileId === p.id}
            onSetDefault={() => void handleSetDefault(p.id)}
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
          <div className="space-y-2 rounded-md border border-border bg-surface-base/40 p-2.5">
            <div className="flex items-center justify-between">
              <FieldLabel>New provider</FieldLabel>
              <button type="button" onClick={resetDraftForm} className="text-[10px] text-text-muted hover:text-text-primary">
                ✕
              </button>
            </div>
            <div>
              <FieldLabel>Name</FieldLabel>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. Anthropic, Local Ollama"
                className={inputCls}
              />
            </div>
            <div>
              <FieldLabel>Base URL</FieldLabel>
              <input
                type="text"
                value={draftUrl}
                onChange={(e) => {
                  setDraftUrl(e.target.value);
                  setDraftTestStatus({ phase: "idle" });
                }}
                placeholder="https://api.openai.com/v1"
                className={inputCls}
              />
            </div>
            <div>
              <FieldLabel>API key</FieldLabel>
              <input
                type="password"
                value={draftKey}
                onChange={(e) => {
                  setDraftKey(e.target.value);
                  setDraftTestStatus({ phase: "idle" });
                }}
                placeholder="Required"
                className={inputCls}
              />
            </div>
            <div>
              <FieldLabel>
                Default model <span className="font-normal opacity-60">(optional)</span>
              </FieldLabel>
              <input
                type="text"
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
                className={inputCls}
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
              className="w-full rounded bg-accent py-1 text-xs font-medium text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-40"
            >
              Save provider
            </button>
          </div>
        )}

        {configuredProfiles.length === 0 && !showAddForm && (
          <p className="text-[11px] text-text-muted">No API keys configured yet — add a provider above.</p>
        )}

        {settings.allowedAiHosts.length > 0 && (
          <Hint>Allowed hosts: {settings.allowedAiHosts.join(", ")}</Hint>
        )}

        <Hint>Keys are stored locally in the app data directory.</Hint>
        </div>
      </CollapsibleSection>}
    </div>
  );
}
