import type { CSSProperties } from "react";
import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import {
  metisHighlightStyleDark,
  metisHighlightStyleLight,
} from "../editorExtensions";

export const BG_PRESETS = [
  { id: "dark",   label: "Dark",   bg: "#16171a", fg: "#e2e8f0", gutterBg: "#16171a", gutterFg: "#475569", borderCol: "#2d2e35", activeLine: "#1e1f2480", activeGutter: "#1e1f24", isDark: true  },
  { id: "black",  label: "Black",  bg: "#000000", fg: "#e2e8f0", gutterBg: "#0d0d0d", gutterFg: "#475569", borderCol: "#1a1a1a", activeLine: "#1a1a1a80", activeGutter: "#111111", isDark: true  },
  { id: "slate",  label: "Slate",  bg: "#1e2030", fg: "#cdd6f4", gutterBg: "#1e2030", gutterFg: "#6e738d", borderCol: "#363a4f", activeLine: "#2a2d3e80", activeGutter: "#252839", isDark: true  },
  { id: "purple", label: "Purple", bg: "#2b1f3f", fg: "#efe7ff", gutterBg: "#241935", gutterFg: "#a78bfa", borderCol: "#4c3a67", activeLine: "#3a2a5480", activeGutter: "#312247", isDark: true  },
  { id: "pink",   label: "Pink",   bg: "#fff1f7", fg: "#4a1331", gutterBg: "#fde7f2", gutterFg: "#b4537a", borderCol: "#f5c8dd", activeLine: "#f9d6e880", activeGutter: "#f7d0e4", isDark: false },
  { id: "white",  label: "White",  bg: "#ffffff", fg: "#1e293b", gutterBg: "#f8fafc", gutterFg: "#94a3b8", borderCol: "#e2e8f0", activeLine: "#dbeafe50", activeGutter: "#f1f5f9", isDark: false },
  { id: "cream",  label: "Cream",  bg: "#f5f0e8", fg: "#3b2a1a", gutterBg: "#ede4d0", gutterFg: "#7c6a52", borderCol: "#d9ccbb", activeLine: "#e8dfcc60", activeGutter: "#e8dfcc", isDark: false },
] as const;

export type BgPreset = (typeof BG_PRESETS)[number];

export const bgCompartment = new Compartment();
export const highlightCompartment = new Compartment();
export const spellcheckCompartment = new Compartment();

export function highlightForPreset(p: BgPreset) {
  return p.isDark ? metisHighlightStyleDark : metisHighlightStyleLight;
}

export function plannerThemeVars(p: BgPreset): CSSProperties {
  const paletteById: Record<BgPreset["id"], { raised: string; overlay: string; border: string; secondary: string; muted: string }> = {
    dark: { raised: "#1e1f24", overlay: "#26272d", border: "#2d2e35", secondary: "#94a3b8", muted: "#64748b" },
    black: { raised: "#111214", overlay: "#1a1b1f", border: "#25262b", secondary: "#8d96a6", muted: "#5d6573" },
    slate: { raised: "#252839", overlay: "#2a2d3e", border: "#363a4f", secondary: "#a3abc4", muted: "#737c98" },
    purple: { raised: "#312247", overlay: "#3a2a54", border: "#4c3a67", secondary: "#c4b5fd", muted: "#a78bfa" },
    pink: { raised: "#fde7f2", overlay: "#f9d6e8", border: "#f5c8dd", secondary: "#8b3e63", muted: "#b4537a" },
    white: { raised: "#f8fafc", overlay: "#eef2f7", border: "#dbe3ee", secondary: "#475569", muted: "#64748b" },
    cream: { raised: "#ede4d0", overlay: "#e6dcc7", border: "#d9ccbb", secondary: "#6e5c46", muted: "#8a7760" },
  };
  const t = paletteById[p.id];
  return {
    "--planner-surface-base": p.bg,
    "--planner-surface-raised": t.raised,
    "--planner-surface-overlay": t.overlay,
    "--planner-border": t.border,
    "--planner-text-primary": p.fg,
    "--planner-text-secondary": t.secondary,
    "--planner-text-muted": t.muted,
  } as CSSProperties;
}

export function makeBgTheme(p: BgPreset) {
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
      ".cm-cursor": { borderLeftColor: "#7c3aed", borderLeftWidth: "2px" },
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
