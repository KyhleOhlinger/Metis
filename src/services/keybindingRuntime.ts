import type { Settings } from "@/types/persona";
import {
  type KeyChord,
  chordsEqual,
  chordToCmKey,
  eventMatchesChord,
  formatChordDisplay,
} from "@/utils/keyChord";
import {
  KEYBINDING_BY_ID,
  KEYBINDING_REGISTRY,
  type KeybindingCommandId,
  type KeybindingDefinition,
} from "@/config/keybindingRegistry";

export function getChordsForCommand(
  id: KeybindingCommandId,
  settings: Settings,
): KeyChord[] {
  const def = KEYBINDING_BY_ID[id];
  if (!def) return [];

  const override = settings.keybindingOverrides?.[id];
  if (override === null) return [];
  if (override) return [override];

  const chords = [def.defaultChord];
  if (def.extraDefaults) chords.push(...def.extraDefaults);
  return chords;
}

export function getDisplayChord(
  id: KeybindingCommandId,
  settings: Settings,
): string | null {
  const chords = getChordsForCommand(id, settings);
  if (!chords.length) return "Disabled";
  return formatChordDisplay(chords[0]);
}

export function findCommandForChord(
  chord: KeyChord,
  settings: Settings,
  scope?: "app" | "editor",
): KeybindingCommandId | null {
  for (const def of KEYBINDING_REGISTRY) {
    if (scope && def.scope !== scope) continue;
    if (!def.rebindable) continue;
    for (const c of getChordsForCommand(def.id, settings)) {
      if (chordsEqual(c, chord)) return def.id;
    }
  }
  return null;
}

export function findConflicts(
  id: KeybindingCommandId,
  chord: KeyChord,
  settings: Settings,
): KeybindingCommandId[] {
  const conflicts: KeybindingCommandId[] = [];
  for (const def of KEYBINDING_REGISTRY) {
    if (!def.rebindable || def.id === id) continue;
    for (const c of getChordsForCommand(def.id, settings)) {
      if (chordsEqual(c, chord)) conflicts.push(def.id);
    }
  }
  return conflicts;
}

export function buildCmKeysForCommand(
  id: KeybindingCommandId,
  settings: Settings,
): string[] {
  return getChordsForCommand(id, settings).map(chordToCmKey);
}

export function rebindableDefinitions(): KeybindingDefinition[] {
  return KEYBINDING_REGISTRY.filter((d) => d.rebindable);
}

export function aiRunChordMatches(event: KeyboardEvent, settings: Settings): boolean {
  const chords = getChordsForCommand("ai-run", settings);
  return chords.some((c) => eventMatchesChord(event, c));
}
