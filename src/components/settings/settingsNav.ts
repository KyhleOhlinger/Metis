import { useMemo } from "react";
import type { SettingsSectionId } from "@/types/persona";
import { isCoreEnabled, type CorePluginId } from "@/plugins/corePlugins";
import { usePluginStore } from "@/plugins/usePluginStore";

export const SETTINGS_NAV: {
  id: SettingsSectionId;
  label: string;
  plugin?: CorePluginId;
}[] = [
  { id: "general", label: "General" },
  { id: "planner", label: "Planner", plugin: "planner" },
  { id: "editor", label: "App theme" },
  { id: "sticky", label: "Sticky notes", plugin: "sticky-notes" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "plugins", label: "Plugins" },
  { id: "ai", label: "AI", plugin: "ai" },
  { id: "personas", label: "Personas" },
  { id: "export", label: "Export", plugin: "export" },
  { id: "backup", label: "Backup", plugin: "backup" },
  { id: "about", label: "About" },
];

/** Settings rows whose core plugin is off are omitted. */
export function useVisibleSettingsNav() {
  const core = usePluginStore((s) => s.core);
  return useMemo(
    () => SETTINGS_NAV.filter((item) => !item.plugin || isCoreEnabled(core, item.plugin)),
    [core],
  );
}
