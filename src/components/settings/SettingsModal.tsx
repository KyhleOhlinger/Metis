import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePersonaStore } from "@/store/usePersonaStore";
import { SettingsPanel } from "../commandCenter/settings/SettingsPanel";

/** Obsidian-style preferences overlay — opened from the app menu or ⌘,. */
export default function SettingsModal() {
  const {
    open,
    section,
    closeSettings,
    setSettingsSection,
    settings,
    upsertProviderProfile,
    removeProviderProfile,
    setDefaultProviderProfileId,
    updateSettings,
  } = usePersonaStore(
    useShallow((s) => ({
      open: s.settingsModalOpen,
      section: s.settingsModalSection,
      closeSettings: s.closeSettings,
      setSettingsSection: s.setSettingsSection,
      settings: s.settings,
      upsertProviderProfile: s.upsertProviderProfile,
      removeProviderProfile: s.removeProviderProfile,
      setDefaultProviderProfileId: s.setDefaultProviderProfileId,
      updateSettings: s.updateSettings,
    })),
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSettings]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/55 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeSettings();
      }}
    >
      <div
        className="flex h-[min(720px,92vh)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-2xl shadow-black/40"
        role="dialog"
        aria-modal="true"
        aria-label="Metis Settings"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
          <button
            type="button"
            onClick={closeSettings}
            className="rounded p-1 text-text-muted hover:bg-surface-overlay hover:text-text-primary"
            title="Close settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <SettingsPanel
          layout="modal"
          section={section}
          onSectionChange={setSettingsSection}
          settings={settings}
          upsertProviderProfile={upsertProviderProfile}
          removeProviderProfile={removeProviderProfile}
          setDefaultProviderProfileId={setDefaultProviderProfileId}
          onUpdateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
