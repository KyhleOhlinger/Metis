import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AiProviderProfile, Settings, SettingsSectionId, StickyNoteDefaults } from "@/types/persona";
import type { usePersonaStore } from "@/store/usePersonaStore";
import { KEYBINDINGS, KEYBINDING_CATEGORIES } from "@/config/keybindings";
import { STICKY_COLOR_PRESETS } from "@/utils/stickyNotes";
import metisIconUrl from "@/assets/metis_icon.png";
import { BG_PRESETS } from "../../editor/bgPresets";
import { SETTINGS_NAV } from "../../settings/settingsNav";
import { SettingsTab } from "./SettingsTab";

type StoreSettings = ReturnType<typeof usePersonaStore.getState>["settings"];

const WIDTH_PRESETS = ["8rem", "10rem", "12rem", "14rem", "16rem", "20rem"] as const;
const selectCls =
  "w-full rounded border border-border bg-surface-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none";
const labelCls = "text-[10px] font-semibold uppercase tracking-widest text-text-muted";

export function SettingsPanel({
  layout,
  section,
  onSectionChange,
  settings,
  upsertProviderProfile,
  removeProviderProfile,
  setDefaultProviderProfileId,
  onUpdateSettings,
}: {
  layout: "modal" | "embedded";
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  settings: StoreSettings;
  upsertProviderProfile: (profile: AiProviderProfile) => void;
  removeProviderProfile: (id: string) => void;
  setDefaultProviderProfileId: (id: string) => void;
  onUpdateSettings: (patch: Partial<Settings>) => void;
}) {
  const navWidth = layout === "modal" ? "w-40" : "w-32";

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <nav
        className={`${navWidth} shrink-0 overflow-y-auto border-r border-border bg-surface-base py-2`}
        aria-label="Settings categories"
      >
        {SETTINGS_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSectionChange(item.id)}
            className={[
              "block w-full px-3 py-2 text-left text-xs transition-colors",
              section === item.id
                ? "bg-accent/15 font-medium text-text-primary border-r-2 border-accent"
                : "text-text-muted hover:bg-surface-overlay hover:text-text-secondary",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-cc-scroll-region>
        {section === "general" && (
          <SettingsSection title="General">
            <GeneralSettingsSection settings={settings} onUpdate={onUpdateSettings} />
          </SettingsSection>
        )}
        {section === "editor" && (
          <SettingsSection title="Editor">
            <EditorSettingsSection settings={settings} onUpdate={onUpdateSettings} />
          </SettingsSection>
        )}
        {section === "sticky" && (
          <SettingsSection title="Sticky notes">
            <StickySettingsSection settings={settings} onUpdate={onUpdateSettings} />
          </SettingsSection>
        )}
        {section === "hotkeys" && (
          <SettingsSection title="Hotkeys">
            <HotkeysSettingsSection />
          </SettingsSection>
        )}
        {section === "ai" && (
          <SettingsTab
            filterSection="ai"
            settings={settings}
            upsertProviderProfile={upsertProviderProfile}
            removeProviderProfile={removeProviderProfile}
            setDefaultProviderProfileId={setDefaultProviderProfileId}
            onUpdateSettings={onUpdateSettings}
          />
        )}
        {section === "personas" && (
          <SettingsTab
            filterSection="personas"
            settings={settings}
            upsertProviderProfile={upsertProviderProfile}
            removeProviderProfile={removeProviderProfile}
            setDefaultProviderProfileId={setDefaultProviderProfileId}
            onUpdateSettings={onUpdateSettings}
          />
        )}
        {section === "about" && (
          <SettingsSection title="About Metis">
            <AboutSettingsSection />
          </SettingsSection>
        )}
      </div>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-muted">{title}</h3>
      {children}
    </div>
  );
}

function GeneralSettingsSection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="space-y-4 text-[11px] text-text-muted">
      <div>
        <p className={labelCls}>Spellcheck</p>
        <label className="mt-2 flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.spellcheckEnabled === true}
            onChange={(e) => onUpdate({ spellcheckEnabled: e.target.checked })}
            className="mt-0.5 rounded border-border"
          />
          <span>
            <span className="font-medium text-text-primary">Enable spellcheck</span>
            {" "}
            in the editor (wavy underlines for misspelled words).
          </span>
        </label>
      </div>
      <div>
        <p className={labelCls}>Dictionary</p>
        <select
          value={settings.spellcheckLanguage ?? "en_US"}
          onChange={(e) => onUpdate({ spellcheckLanguage: e.target.value })}
          className={`mt-1.5 ${selectCls}`}
        >
          <option value="en_US">English (US)</option>
          <option value="en_GB">English (UK)</option>
        </select>
      </div>
    </div>
  );
}

function EditorSettingsSection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  const activeId = settings.editorBgPresetId ?? "dark";
  return (
    <div className="space-y-3 text-[11px] text-text-muted">
      <p>Choose the default editor background. You can still change it per session from the editor toolbar.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BG_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onUpdate({ editorBgPresetId: p.id })}
            className={[
              "flex items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors",
              activeId === p.id
                ? "border-accent bg-accent/10"
                : "border-border bg-surface-overlay hover:border-accent/40",
            ].join(" ")}
          >
            <span
              className="h-5 w-5 shrink-0 rounded border border-white/20"
              style={{ backgroundColor: p.bg }}
            />
            <span className="text-xs text-text-primary">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StickySettingsSection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  const d = settings.stickyDefaults ?? {};
  const patch = (next: Partial<StickyNoteDefaults>) =>
    onUpdate({ stickyDefaults: { ...d, ...next } });

  return (
    <div className="space-y-4 text-[11px] text-text-muted">
      <p>Defaults for sticky notes inserted from the toolbar, drag-and-drop, or slash menu.</p>
      <div>
        <p className={labelCls}>Side</p>
        <select
          value={d.float ?? "right"}
          onChange={(e) => patch({ float: e.target.value as StickyNoteDefaults["float"] })}
          className={`mt-1.5 ${selectCls}`}
        >
          <option value="right">Float right</option>
          <option value="left">Float left</option>
          <option value="none">No float (full width)</option>
        </select>
      </div>
      <div>
        <p className={labelCls}>Width</p>
        <select
          value={
            d.width && WIDTH_PRESETS.some((w) => w === d.width) ? d.width : WIDTH_PRESETS[2]
          }
          onChange={(e) => patch({ width: e.target.value })}
          className={`mt-1.5 ${selectCls}`}
        >
          {WIDTH_PRESETS.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
        <input
          type="text"
          value={d.width ?? "12rem"}
          onChange={(e) => patch({ width: e.target.value.slice(0, 24) })}
          placeholder="e.g. 12rem, 180px"
          className={`mt-1.5 ${selectCls} font-mono`}
        />
      </div>
      <div>
        <p className={labelCls}>Text wrap</p>
        <label className="mt-2 flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={d.wrap !== false}
            onChange={(e) => patch({ wrap: e.target.checked })}
            className="mt-0.5 rounded border-border"
          />
          <span>
            <span className="font-medium text-text-primary">Wrap following lines beside the sticky (Visual)</span>
            {" "}
            — in Visual preview, the next N lines after the sticky (N = rendered sticky height; blank lines count)
            render beside the card. Source shows the sticky only; wrap lines stay editable markdown. Use{" "}
            <code className="text-[10px]">wrap=&quot;false&quot;</code> on a single sticky to override.
          </span>
        </label>
      </div>
      <div>
        <p className={labelCls}>Default colour</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1 sm:grid-cols-3">
          {STICKY_COLOR_PRESETS.map(({ color, label, swatch }) => (
            <button
              key={color}
              type="button"
              onClick={() => patch({ color })}
              className={[
                "flex items-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors",
                d.color === color
                  ? "bg-accent/15 ring-1 ring-accent"
                  : "bg-surface-overlay hover:bg-surface-base",
              ].join(" ")}
            >
              <span
                className="h-3.5 w-3.5 rounded-sm border border-white/20"
                style={{ backgroundColor: swatch }}
              />
              <span className="text-text-primary">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function HotkeysSettingsSection() {
  return (
    <div className="space-y-4 text-[11px]">
      <p className="text-text-muted">
        Keyboard shortcuts are fixed in this release. Custom rebinding is planned for a future update.
      </p>
      {KEYBINDING_CATEGORIES.map((cat) => {
        const rows = KEYBINDINGS.filter((k) => k.category === cat);
        if (!rows.length) return null;
        return (
          <div key={cat}>
            <p className={labelCls}>{cat}</p>
            <div className="mt-1.5 overflow-hidden rounded-md border border-border">
              {rows.map((row, i) => (
                <div
                  key={row.id}
                  className={[
                    "flex items-center justify-between gap-3 px-2.5 py-1.5",
                    i > 0 ? "border-t border-border/60" : "",
                  ].join(" ")}
                >
                  <span className="text-text-primary">{row.label}</span>
                  <kbd className="shrink-0 rounded border border-border bg-surface-base px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                    {row.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AboutSettingsSection() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("get_app_version")
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <img
        src={metisIconUrl}
        alt=""
        className="h-20 w-20 rounded-2xl border border-border object-cover shadow-md"
      />
      <div>
        <p className="text-sm font-semibold text-text-primary">
          Metis{version ? <span className="ml-1.5 font-normal text-text-muted">v{version}</span> : null}
        </p>
        <p className="mt-1 text-[11px] text-text-muted max-w-sm">
          A local-first, AI-augmented personal knowledge ecosystem.
        </p>
        <p className="mt-2 text-[10px] text-text-muted/80">
          Markdown vault · AI personas · Planner · Handwriting OCR
        </p>
      </div>
      <p className="text-[10px] text-text-muted/50">© 2026 Kyhle Öhlinger — MIT License</p>
    </div>
  );
}
