import { useState, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/store/useStore";
import {
  usePersonaStore,
  selectActivePersona,
} from "@/store/usePersonaStore";
import PersonaCreator from "../PersonaCreator";
import { ChevronLeft, ChevronRight } from "./shared/ui";
import { InfoTab } from "./info/InfoTab";
import { AITab } from "./ai/AITab";
import { SettingsTab } from "./settings/SettingsTab";

interface Props {
  isOpen: boolean;
  onToggle: () => void;
}

function CollapsedStrip({ onToggle }: { onToggle: () => void }) {
  return (
    <aside className="flex h-full w-8 flex-col items-center bg-surface-raised pt-2">
      <button
        onClick={onToggle}
        title="Open Command Center"
        className="rounded p-1 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
      >
        <ChevronLeft />
      </button>
    </aside>
  );
}

export default function CommandCenter({ isOpen, onToggle }: Props) {
  const { activeFilePath, activeFileContent, isDirty, vaultPath, files } = useStore(
    useShallow((s) => ({
      activeFilePath: s.activeFilePath,
      activeFileContent: s.activeFileContent,
      isDirty: s.isDirty,
      vaultPath: s.vaultPath,
      files: s.files,
    })),
  );
  const loadFromDisk = usePersonaStore((s) => s.loadFromDisk);
  const activePersona = usePersonaStore(selectActivePersona);
  const personaSlice = usePersonaStore(
    useShallow((s) => ({
      personas: s.personas,
      activePersonaId: s.activePersonaId,
      settings: s.settings,
      history: s.history,
      setActivePersona: s.setActivePersona,
      addHistory: s.addHistory,
      clearHistory: s.clearHistory,
      upsertProviderProfile: s.upsertProviderProfile,
      removeProviderProfile: s.removeProviderProfile,
      setDefaultProviderProfileId: s.setDefaultProviderProfileId,
      updateSettings: s.updateSettings,
    })),
  );

  const [tab, setTab] = useState<"info" | "ai" | "settings">("info");
  const [showNewPersonaModal, setShowNewPersonaModal] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = document.querySelector("[data-cc-scroll-region]");
      if (el instanceof HTMLElement) {
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [tab]);

  // Load personas + settings from disk on first mount
  useEffect(() => {
    loadFromDisk();
  }, [loadFromDisk]);

  // Consume a scope request dispatched from the Sidebar context menu
  const pendingScope = usePersonaStore((s) => s.pendingScope);
  const setPendingScope = usePersonaStore((s) => s.setPendingScope);
  useEffect(() => {
    if (!pendingScope) return;
    // Open the panel and navigate to the AI tab — the AITab picks up the scope
    setTab("ai");
    if (!isOpen) onToggle();
    setPendingScope(null);
  }, [pendingScope, isOpen, onToggle, setPendingScope]);

  // Ensure the panel is visible whenever a selection quick-action is triggered.
  // AITab may not be mounted when the panel is collapsed or on a different tab,
  // so we open + switch here.  Clearing selectionQuery and running the agent
  // are both handled inside AITab's own effect once it mounts.
  const selectionQuery = usePersonaStore((s) => s.selectionQuery);
  useEffect(() => {
    if (!selectionQuery) return;
    setTab("ai");
    if (!isOpen) onToggle();
  }, [selectionQuery, isOpen, onToggle]);

  const { wordCount, lineCount, charCount } = useMemo(() => ({
    wordCount: activeFileContent.split(/\s+/).filter(Boolean).length,
    lineCount: activeFileContent.split("\n").length,
    charCount: activeFileContent.length,
  }), [activeFileContent]);

  if (!isOpen) return <CollapsedStrip onToggle={onToggle} />;

  return (
    <>
      <aside className="flex h-full flex-col bg-surface-raised">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-border pl-3 pr-1.5 py-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-text-muted">
            Command Center
          </span>
          <button
            onClick={onToggle}
            title="Collapse panel"
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
          >
            <ChevronRight />
          </button>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────── */}
        <div className="flex border-b border-border">
          {(["info", "ai", "settings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "flex-1 py-1.5 text-xs font-medium transition-colors",
                tab === t
                  ? "border-b-2 border-accent text-text-primary"
                  : "text-text-muted hover:text-text-secondary",
              ].join(" ")}
            >
              {t === "info" ? "Info" : t === "ai" ? "AI ✦" : <span className="text-base leading-none">⚙</span>}
            </button>
          ))}
        </div>

        {/* ── Panels ─────────────────────────────────────────────── */}
        {/* flex flex-col so that tab roots using flex-1 get a real flex parent
            and overflow-y-auto can create a properly bounded scroll region.
            min-h-0 prevents the default min-height:auto from blocking shrink. */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {tab === "info" && (
            <InfoTab
              vaultPath={vaultPath}
              files={files}
              activeFilePath={activeFilePath}
              isDirty={isDirty}
              wordCount={wordCount}
              lineCount={lineCount}
              charCount={charCount}
            />
          )}
          {tab === "ai" && (
            <AITab
              activePersona={activePersona}
              personas={personaSlice.personas}
              activePersonaId={personaSlice.activePersonaId}
              settings={personaSlice.settings}
              history={personaSlice.history}
              activeFileContent={activeFileContent}
              activeFilePath={activeFilePath}
              vaultPath={vaultPath}
              files={files}
              initialScope={pendingScope ?? undefined}
              onSelectPersona={personaSlice.setActivePersona}
              onAddHistory={personaSlice.addHistory}
              onClearHistory={personaSlice.clearHistory}
              onNewPersona={() => setShowNewPersonaModal(true)}
              onOpenSettings={() => setTab("settings")}
            />
          )}
          {tab === "settings" && (
            <SettingsTab
              settings={personaSlice.settings}
              upsertProviderProfile={personaSlice.upsertProviderProfile}
              removeProviderProfile={personaSlice.removeProviderProfile}
              setDefaultProviderProfileId={personaSlice.setDefaultProviderProfileId}
              onUpdateSettings={personaSlice.updateSettings}
            />
          )}
        </div>
      </aside>

      {showNewPersonaModal && (
        <PersonaCreator
          onClose={() => setShowNewPersonaModal(false)}
        />
      )}
    </>
  );
}
