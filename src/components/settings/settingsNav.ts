import type { SettingsSectionId } from "@/types/persona";

export const SETTINGS_NAV: { id: SettingsSectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "sticky", label: "Sticky notes" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "ai", label: "AI" },
  { id: "personas", label: "Personas" },
  { id: "about", label: "About" },
];
