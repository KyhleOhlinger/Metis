import type { SettingsSectionId } from "@/types/persona";

export const SETTINGS_NAV: { id: SettingsSectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "planner", label: "Planner" },
  { id: "editor", label: "App theme" },
  { id: "sticky", label: "Sticky notes" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "ai", label: "AI" },
  { id: "personas", label: "Personas" },
  { id: "export", label: "Export" },
  { id: "about", label: "About" },
];
