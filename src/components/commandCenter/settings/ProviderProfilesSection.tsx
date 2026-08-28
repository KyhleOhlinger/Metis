import { useState, useEffect } from "react";
import type { AiProviderProfile } from "@/types/persona";
import { testProviderConnection } from "@/services/llmService";
import { assertSafeProviderUrl } from "@/utils/providerUrlSafety";

export type TestStatus =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "ok"; detail: string }
  | { phase: "error"; message: string };

export function TestConnectionRow({
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

export function ProviderProfilesSection({
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

  function commit(): AiProviderProfile | null {
    try {
      assertSafeProviderUrl(baseUrl.trim());
    } catch (e) {
      setTestStatus({
        phase: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
    const next: AiProviderProfile = {
      ...profile,
      name: name.trim() || profile.name,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      defaultModel: defaultModel.trim() || undefined,
      providerKind: profile.providerKind ?? "openai-compatible",
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
      providerKind: profile.providerKind ?? "openai-compatible",
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
            onClick={() => {
              if (commit()) setTestStatus({ phase: "idle" });
            }}
            className="w-full rounded border border-accent/50 bg-accent/10 py-1 text-[10px] text-accent hover:bg-accent/20"
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}
