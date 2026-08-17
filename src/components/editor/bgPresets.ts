import type { CSSProperties } from "react";
import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import {
  metisHighlightStyleDark,
  metisHighlightStyleLight,
} from "../editorExtensions";
import {
  deriveCustomThemeFields,
  deriveThemePalette,
  normalizeHex,
} from "@/utils/themeColors";

export const CUSTOM_PRESET_ID = "custom";

export interface BgPreset {
  id: string;
  label: string;
  bg: string;
  fg: string;
  gutterBg: string;
  gutterFg: string;
  borderCol: string;
  activeLine: string;
  activeGutter: string;
  isDark: boolean;
}

export const BG_PRESETS: readonly BgPreset[] = [
  { id: "dark",   label: "Dark",   bg: "#16171a", fg: "#e2e8f0", gutterBg: "#16171a", gutterFg: "#475569", borderCol: "#2d2e35", activeLine: "#1e1f2480", activeGutter: "#1e1f24", isDark: true  },
  { id: "black",  label: "Black",  bg: "#000000", fg: "#e2e8f0", gutterBg: "#0d0d0d", gutterFg: "#475569", borderCol: "#1a1a1a", activeLine: "#1a1a1a80", activeGutter: "#111111", isDark: true  },
  { id: "slate",  label: "Slate",  bg: "#1e2030", fg: "#cdd6f4", gutterBg: "#1e2030", gutterFg: "#6e738d", borderCol: "#363a4f", activeLine: "#2a2d3e80", activeGutter: "#252839", isDark: true  },
  { id: "purple", label: "Purple", bg: "#2b1f3f", fg: "#efe7ff", gutterBg: "#241935", gutterFg: "#a78bfa", borderCol: "#4c3a67", activeLine: "#3a2a5480", activeGutter: "#312247", isDark: true  },
  { id: "pink",   label: "Pink",   bg: "#fff1f7", fg: "#4a1331", gutterBg: "#fde7f2", gutterFg: "#b4537a", borderCol: "#f5c8dd", activeLine: "#f9d6e880", activeGutter: "#f7d0e4", isDark: false },
  { id: "white",  label: "White",  bg: "#ffffff", fg: "#1e293b", gutterBg: "#f8fafc", gutterFg: "#94a3b8", borderCol: "#e2e8f0", activeLine: "#dbeafe50", activeGutter: "#f1f5f9", isDark: false },
  { id: "cream",  label: "Cream",  bg: "#f5f0e8", fg: "#3b2a1a", gutterBg: "#ede4d0", gutterFg: "#7c6a52", borderCol: "#d9ccbb", activeLine: "#e8dfcc60", activeGutter: "#e8dfcc", isDark: false },
] as const;

type BuiltInPresetId = (typeof BG_PRESETS)[number]["id"];

const BUILT_IN_PALETTE: Record<
  BuiltInPresetId,
  { raised: string; overlay: string; border: string; secondary: string; muted: string }
> = {
  dark: { raised: "#1e1f24", overlay: "#26272d", border: "#2d2e35", secondary: "#94a3b8", muted: "#64748b" },
  black: { raised: "#111214", overlay: "#1a1b1f", border: "#25262b", secondary: "#8d96a6", muted: "#5d6573" },
  slate: { raised: "#252839", overlay: "#2a2d3e", border: "#363a4f", secondary: "#a3abc4", muted: "#737c98" },
  purple: { raised: "#312247", overlay: "#3a2a54", border: "#4c3a67", secondary: "#c4b5fd", muted: "#a78bfa" },
  pink: { raised: "#fde7f2", overlay: "#f9d6e8", border: "#f5c8dd", secondary: "#8b3e63", muted: "#b4537a" },
  white: { raised: "#f8fafc", overlay: "#eef2f7", border: "#dbe3ee", secondary: "#475569", muted: "#64748b" },
  cream: { raised: "#ede4d0", overlay: "#e6dcc7", border: "#d9ccbb", secondary: "#6e5c46", muted: "#8a7760" },
};

const BUILT_IN_ACCENT: Record<BuiltInPresetId, string> = {
  dark: "#7c3aed",
  black: "#8b5cf6",
  slate: "#a78bfa",
  purple: "#c4b5fd",
  pink: "#be185d",
  white: "#6d28d9",
  cream: "#92400e",
};

const BUILT_IN_PLANNER_HEADER: Record<BuiltInPresetId, { bg: string; fg: string }> = {
  dark: { bg: "#7F00FF", fg: "#ffffff" },
  black: { bg: "#7F00FF", fg: "#ffffff" },
  slate: { bg: "#6d28d9", fg: "#ffffff" },
  purple: { bg: "#7c3aed", fg: "#ffffff" },
  pink: { bg: "#fbcfe8", fg: "#831843" },
  white: { bg: "#e2e8f0", fg: "#334155" },
  cream: { bg: "#d9ccbb", fg: "#3b2a1a" },
};

function isBuiltInId(id: string): id is BuiltInPresetId {
  return BG_PRESETS.some((p) => p.id === id);
}

export function buildCustomBgPreset(customColor: string): BgPreset | null {
  const fields = deriveCustomThemeFields(customColor);
  if (!fields) return null;
  return {
    id: CUSTOM_PRESET_ID,
    label: "Custom",
    ...fields,
  };
}

export function resolveBgPreset(
  id: string | undefined,
  customColor?: string | undefined,
): BgPreset {
  if (id === CUSTOM_PRESET_ID) {
    const hex = normalizeHex(customColor ?? "") ?? normalizeHex("#16171a")!;
    const custom = buildCustomBgPreset(hex);
    if (custom) return custom;
  }
  const builtIn = BG_PRESETS.find((p) => p.id === id);
  return builtIn ? { ...builtIn } : { ...BG_PRESETS[0] };
}

export const bgCompartment = new Compartment();
export const highlightCompartment = new Compartment();
export const spellcheckCompartment = new Compartment();

export function highlightForPreset(p: BgPreset) {
  return p.isDark ? metisHighlightStyleDark : metisHighlightStyleLight;
}

function themeTokensForPreset(p: BgPreset) {
  if (isBuiltInId(p.id)) {
    const t = BUILT_IN_PALETTE[p.id];
    const header = BUILT_IN_PLANNER_HEADER[p.id];
    return {
      ...t,
      accent: BUILT_IN_ACCENT[p.id],
      plannerHeaderBg: header.bg,
      plannerHeaderFg: header.fg,
    };
  }
  const derived = deriveThemePalette(p.bg, p.fg, p.isDark);
  return {
    raised: derived.raised,
    overlay: derived.overlay,
    border: derived.border,
    secondary: derived.secondary,
    muted: derived.muted,
    accent: derived.accent,
    plannerHeaderBg: derived.plannerHeaderBg,
    plannerHeaderFg: derived.plannerHeaderFg,
  };
}

export function editorPaneThemeVars(p: BgPreset): CSSProperties {
  const t = themeTokensForPreset(p);
  return {
    "--editor-surface-base": p.bg,
    "--editor-surface-raised": t.raised,
    "--editor-surface-overlay": t.overlay,
    "--editor-border": t.border,
    "--editor-text-primary": p.fg,
    "--editor-text-secondary": t.secondary,
    "--editor-text-muted": t.muted,
    "--editor-accent": t.accent,
    "--planner-header-bg": t.plannerHeaderBg,
    "--planner-header-fg": t.plannerHeaderFg,
    /* Legacy aliases — planner inline CodeMirror fields still reference these. */
    "--planner-surface-base": p.bg,
    "--planner-surface-raised": t.raised,
    "--planner-surface-overlay": t.overlay,
    "--planner-border": t.border,
    "--planner-text-primary": p.fg,
    "--planner-text-secondary": t.secondary,
    "--planner-text-muted": t.muted,
  } as CSSProperties;
}

/** Alias — planner shares the editor pane palette. */
export const plannerThemeVars = editorPaneThemeVars;

export function makeBgTheme(p: BgPreset) {
  const accent = themeTokensForPreset(p).accent;
  return EditorView.theme(
    {
      "&": { backgroundColor: `${p.bg} !important`, color: `${p.fg} !important` },
      ".cm-scroller": { backgroundColor: `${p.bg} !important` },
      ".cm-gutters": {
        backgroundColor: `${p.gutterBg} !important`,
        color: p.gutterFg,
        borderRight: `1px solid ${p.borderCol} !important`,
      },
      ".cm-activeLineGutter": { backgroundColor: `${p.activeGutter} !important` },
      ".cm-activeLine": { backgroundColor: `${p.activeLine} !important` },
      ".cm-cursor": { borderLeftColor: accent, borderLeftWidth: "2px" },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: `${p.isDark ? "rgba(76, 29, 149, 0.38)" : "rgba(124, 58, 237, 0.22)"} !important`,
      },
    },
    { dark: p.isDark },
  );
}

export const metisTheme = EditorView.theme(
  {
    "&": { height: "100%" },
    ".cm-scroller": { fontFamily: '"Inter","SF Pro Text",system-ui,sans-serif', overflow: "auto" },
    ".cm-content": {
      caretColor: "#7c3aed",
      padding: "1.5rem 1.5rem 1.5rem 1rem",
      minHeight: "100%",
      fontSize: "15px",
      lineHeight: "1.85",
      "--metis-editor-text-size": "15px",
    },
    ".cm-gutters": {
      fontFamily: '"JetBrains Mono","Fira Code",monospace',
      fontSize: "10px",
      paddingRight: "4px",
    },
    ".cm-lineNumbers .cm-gutterElement": { minWidth: "1.75rem" },
  },
  { dark: true },
);
