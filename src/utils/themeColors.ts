/**
 * Colour math for App theme — derives readable text, surfaces, accents, and
 * dark/light syntax mode from an arbitrary background hex.
 */

export interface DerivedThemePalette {
  raised: string;
  overlay: string;
  border: string;
  secondary: string;
  muted: string;
  accent: string;
  plannerHeaderBg: string;
  plannerHeaderFg: string;
}

const HEX6 = /^#?([0-9a-f]{6})$/i;

export function normalizeHex(hex: string): string | null {
  const m = HEX6.exec(hex.trim());
  if (!m) return null;
  return `#${m[1].toLowerCase()}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = normalizeHex(hex) ?? "#000000";
  const h = n.slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** sRGB relative luminance (0–1). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function isDarkBackground(hex: string): boolean {
  return relativeLuminance(hex) < 0.42;
}

/** Mix two hex colours; `t` is weight of `b` (0 = all `a`). */
export function mixHex(a: string, b: string, t: number): string {
  const ta = Math.max(0, Math.min(1, t));
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(
    ca.r + (cb.r - ca.r) * ta,
    ca.g + (cb.g - ca.g) * ta,
    ca.b + (cb.b - ca.b) * ta,
  );
}

export function withAlphaHex(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const aa = Math.round(a * 255)
    .toString(16)
    .padStart(2, "0");
  return `${normalizeHex(hex) ?? hex}${aa}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function accentFromBackground(bg: string, isDark: boolean): string {
  const { r, g, b } = hexToRgb(bg);
  const { h, s } = rgbToHsl(r, g, b);
  const sat = s < 0.12 ? 0.55 : Math.min(0.78, s + 0.25);
  const light = isDark ? 0.62 : 0.38;
  const { r: ar, g: ag, b: ab } = hslToRgb(h, sat, light);
  return rgbToHex(ar, ag, ab);
}

/**
 * Derive surface tokens from a base background + primary text colour.
 */
export function deriveThemePalette(
  bg: string,
  fg: string,
  isDark: boolean,
): DerivedThemePalette {
  const black = "#000000";
  const white = "#ffffff";
  const slateSecondary = "#94a3b8";
  const slateMuted = "#64748b";

  const raised = isDark ? mixHex(bg, white, 0.08) : mixHex(bg, black, 0.05);
  const overlay = isDark ? mixHex(bg, white, 0.14) : mixHex(bg, black, 0.09);
  const border = isDark ? mixHex(bg, white, 0.2) : mixHex(bg, black, 0.14);
  const secondary = mixHex(fg, slateSecondary, isDark ? 0.55 : 0.45);
  const muted = mixHex(fg, slateMuted, 0.4);
  const accent = accentFromBackground(bg, isDark);

  const plannerHeaderBg = isDark
    ? mixHex(accent, black, 0.22)
    : mixHex(bg, accent, 0.42);
  const plannerHeaderFg = isDark ? white : mixHex(accent, black, 0.55);

  return {
    raised,
    overlay,
    border,
    secondary,
    muted,
    accent,
    plannerHeaderBg,
    plannerHeaderFg,
  };
}

export interface CustomThemeFields {
  bg: string;
  fg: string;
  gutterBg: string;
  gutterFg: string;
  borderCol: string;
  activeLine: string;
  activeGutter: string;
  isDark: boolean;
}

/** Build CodeMirror + shell fields from a single user-chosen background colour. */
export function deriveCustomThemeFields(bgInput: string): CustomThemeFields | null {
  const bg = normalizeHex(bgInput);
  if (!bg) return null;

  const isDark = isDarkBackground(bg);
  const fg = isDark ? mixHex(bg, "#ffffff", 0.9) : mixHex(bg, "#000000", 0.86);
  const gutterBg = isDark ? mixHex(bg, "#000000", 0.06) : mixHex(bg, "#ffffff", 0.12);
  const gutterFg = mixHex(fg, isDark ? "#475569" : "#94a3b8", 0.55);
  const borderCol = isDark ? mixHex(bg, "#ffffff", 0.18) : mixHex(bg, "#000000", 0.12);
  const activeGutter = isDark ? mixHex(bg, "#ffffff", 0.07) : mixHex(bg, "#000000", 0.05);
  const activeLine = withAlphaHex(
    isDark ? mixHex(bg, "#ffffff", 0.06) : mixHex(bg, "#000000", 0.04),
    0.5,
  );

  return {
    bg,
    fg,
    gutterBg,
    gutterFg,
    borderCol,
    activeLine,
    activeGutter,
    isDark,
  };
}
