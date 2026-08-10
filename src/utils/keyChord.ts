/** Serializable keyboard chord for shortcuts (stored in settings.json). */
export interface KeyChord {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

const LETTER = /^[a-z]$/;
const DIGIT = /^[0-9]$/;

/** Normalize a key name for stable storage and comparison. */
export function normalizeKeyName(key: string): string {
  const k = key.trim();
  if (!k) return "";
  if (LETTER.test(k)) return k;
  if (DIGIT.test(k)) return k;
  if (k.length === 1) return k;
  if (k.startsWith("Arrow")) return k;
  if (k === "Enter" || k === "Tab" || k === "Backspace" || k === "Escape") return k;
  if (k === " ") return "Space";
  return k;
}

export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  return (
    normalizeKeyName(a.key) === normalizeKeyName(b.key) &&
    !!a.mod === !!b.mod &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt
  );
}

/** Build a chord from a keydown event (returns null for bare modifier keys). */
export function chordFromKeyboardEvent(event: KeyboardEvent): KeyChord | null {
  const key = normalizeKeyName(event.key);
  if (!key || key === "Shift" || key === "Control" || key === "Meta" || key === "Alt") {
    return null;
  }
  return {
    key,
    mod: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

export function eventMatchesChord(event: KeyboardEvent, chord: KeyChord): boolean {
  if (event.repeat) return false;
  const mod = event.metaKey || event.ctrlKey;
  if (chord.mod && !mod) return false;
  if (!chord.mod && mod) return false;
  if (chord.shift !== !!event.shiftKey) return false;
  if (chord.alt !== !!event.altKey) return false;
  return normalizeKeyName(event.key) === normalizeKeyName(chord.key);
}

/** CodeMirror 6 key string (Mod = Cmd on macOS, Ctrl elsewhere). */
export function chordToCmKey(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.mod) parts.push("Mod");
  if (chord.shift) parts.push("Shift");
  if (chord.alt) parts.push("Alt");
  parts.push(cmKeyToken(chord.key));
  return parts.join("-");
}

function cmKeyToken(key: string): string {
  const k = normalizeKeyName(key);
  if (k === "\\") return "\\\\";
  if (k === ",") return ",";
  if (k === "Space") return "Space";
  if (LETTER.test(k)) return k;
  return k;
}

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
}

/** Human-readable shortcut for UI (macOS-style symbols on Mac). */
export function formatChordDisplay(chord: KeyChord): string {
  const mac = isMacPlatform();
  const parts: string[] = [];
  if (chord.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (chord.shift) parts.push(mac ? "⇧" : "Shift");
  if (chord.alt) parts.push(mac ? "⌥" : "Alt");
  parts.push(formatKeyLabel(chord.key, mac));
  return parts.join(mac ? "" : "+");
}

function formatKeyLabel(key: string, mac: boolean): string {
  const k = normalizeKeyName(key);
  if (k === "ArrowUp") return mac ? "↑" : "↑";
  if (k === "ArrowDown") return mac ? "↓" : "↓";
  if (k === "ArrowLeft") return mac ? "←" : "←";
  if (k === "ArrowRight") return mac ? "→" : "→";
  if (k === "Enter") return mac ? "↵" : "Enter";
  if (k === "Tab") return mac ? "⇥" : "Tab";
  if (k === "Space") return "Space";
  if (k === "\\") return "\\";
  if (LETTER.test(k)) return k.toUpperCase();
  return k;
}

export function isEditableFieldTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return !!el.closest(".cm-editor");
}

/** Tauri/muda accelerator string (e.g. `CmdOrCtrl+Shift+N`). Returns null when unsupported. */
export function chordToMenuAccelerator(chord: KeyChord): string | null {
  const key = menuAcceleratorKey(chord.key);
  if (!key) return null;
  const parts: string[] = [];
  if (chord.mod) parts.push("CmdOrCtrl");
  if (chord.shift) parts.push("Shift");
  if (chord.alt) parts.push("Alt");
  parts.push(key);
  return parts.join("+");
}

function menuAcceleratorKey(key: string): string | null {
  const k = normalizeKeyName(key);
  if (LETTER.test(k)) return k.toUpperCase();
  if (DIGIT.test(k)) return k;
  switch (k) {
    case ",":
      return ",";
    case "\\":
      return "\\";
    case "ArrowUp":
      return "ArrowUp";
    case "ArrowDown":
      return "ArrowDown";
    case "ArrowLeft":
      return "ArrowLeft";
    case "ArrowRight":
      return "ArrowRight";
    case "Enter":
      return "Enter";
    case "Tab":
      return "Tab";
    case "Space":
      return "Space";
    default:
      return null;
  }
}
