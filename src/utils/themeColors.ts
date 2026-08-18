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

/** Readable text on a solid accent-coloured control or selection row. */
export function accentForegroundOn(accent: string): string {
  return relativeLuminance(accent) < 0.45
    ? "#ffffff"
    : mixHex(accent, "#000000", 0.72);
}

/** Sidebar / list selection tint derived from surface + accent. */
export function accentMutedBackground(bg: string, accent: string, isDark: boolean): string {
  return isDark ? mixHex(accent, "#000000", 0.35) : mixHex(bg, accent, 0.38);
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

function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
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

  const surfaces = deriveSurfaceShades(bg);
  const raised = surfaces?.raised ?? (isDark ? mixHex(bg, white, 0.08) : mixHex(bg, black, 0.05));
  const overlay = surfaces?.overlay ?? (isDark ? mixHex(bg, white, 0.14) : mixHex(bg, black, 0.09));
  const border = surfaces?.border ?? (isDark ? mixHex(bg, white, 0.2) : mixHex(bg, black, 0.14));
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

export interface SurfaceShades {
  raised: string;
  overlay: string;
  border: string;
  gutter: string;
  activeGutter: string;
  activeLine: string;
}

/**
 * Derive multi-tone panel shades from a single base colour — mirrors built-in
 * presets (sidebar/header raised, editor base, gutter + active-line tints).
 */
export function deriveSurfaceShades(bgInput: string): (SurfaceShades & { bg: string; isDark: boolean }) | null {
  const bg = normalizeHex(bgInput);
  if (!bg) return null;

  const isDark = isDarkBackground(bg);
  const { h, s, l } = hexToHsl(bg);
  const chromatic = s >= 0.06;

  let raised: string;
  let overlay: string;
  let border: string;
  let gutter: string;

  if (isDark) {
    if (chromatic) {
      raised = hslToHex(h, Math.max(0, s - 0.02), Math.min(0.98, l + 0.035));
      overlay = hslToHex(h, Math.max(0, s - 0.04), Math.min(0.98, l + 0.069));
      border = hslToHex(h, Math.max(0, s - 0.06), Math.min(0.98, l + 0.12));
    } else {
      raised = mixHex(bg, "#ffffff", 0.08);
      overlay = mixHex(bg, "#ffffff", 0.14);
      border = mixHex(bg, "#ffffff", 0.2);
    }
    gutter = l < 0.06 ? mixHex(bg, "#ffffff", 0.05) : s > 0.12 ? hslToHex(h, s, Math.max(0, l - 0.02)) : bg;
  } else if (chromatic) {
    if (s < 0.5) {
      raised = hslToHex(h, Math.min(1, s + 0.1), Math.max(0, l - 0.06));
      overlay = hslToHex(h, Math.min(1, s + 0.06), Math.max(0, l - 0.09));
      border = hslToHex(h, Math.min(1, s * 0.9), Math.max(0, l - 0.13));
    } else {
      raised = hslToHex(h, s * 0.88, Math.max(0, l - 0.025));
      overlay = hslToHex(h, s * 0.75, Math.max(0, l - 0.065));
      border = hslToHex(h, s * 0.85, Math.max(0, l - 0.1));
    }
    gutter = raised;
  } else {
    raised = mixHex(bg, "#94a3b8", 0.035);
    overlay = mixHex(bg, "#94a3b8", 0.07);
    border = mixHex(bg, "#64748b", 0.14);
    gutter = raised;
  }

  const activeGutter = isDark ? raised : overlay;
  const activeLine = withAlphaHex(overlay, 0.5);

  return { bg, isDark, raised, overlay, border, gutter, activeGutter, activeLine };
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
  const shades = deriveSurfaceShades(bgInput);
  if (!shades) return null;

  const { bg, isDark, gutter, border, activeLine, activeGutter } = shades;
  const fg = isDark ? mixHex(bg, "#ffffff", 0.9) : mixHex(bg, "#000000", 0.86);
  const gutterFg = mixHex(fg, isDark ? "#475569" : "#94a3b8", 0.55);

  return {
    bg,
    fg,
    gutterBg: gutter,
    gutterFg,
    borderCol: border,
    activeLine,
    activeGutter,
    isDark,
  };
}

/** WCAG contrast ratio between two sRGB colours (1–21). */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Nudge lightness until `fg` meets a minimum contrast ratio on `bg`. */
export function ensureReadableOn(
  fg: string,
  bg: string,
  minRatio = 4.5,
): string {
  if (contrastRatio(fg, bg) >= minRatio) return fg;
  const bgIsDark = relativeLuminance(bg) < 0.5;
  let { h, s, l } = hexToHsl(fg);
  for (let i = 0; i < 14; i++) {
    const candidate = hslToHex(h, s, l);
    if (contrastRatio(candidate, bg) >= minRatio) return candidate;
    l = bgIsDark ? Math.min(0.98, l + 0.06) : Math.max(0.06, l - 0.06);
  }
  return bgIsDark ? "#ffffff" : "#0f172a";
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

/** Pick a token hue separated from the editor background hue. */
function separatedHue(bgHue: number, preferredHue: number, minDist = 0.13): number {
  if (hueDistance(bgHue, preferredHue) >= minDist) return preferredHue;
  const complement = (bgHue + 0.5) % 1;
  const roleOffset = preferredHue - 0.5;
  return (complement + roleOffset * 0.3 + 1) % 1;
}

function syntaxTokenColor(
  bg: string,
  preferredHue: number,
  sat: number,
  light: number,
  minContrast = 3.2,
): string {
  const { h: bgHue } = hexToHsl(bg);
  const hue = separatedHue(bgHue, preferredHue);
  return ensureReadableOn(hslToHex(hue, sat, light), bg, minContrast);
}

export interface SyntaxPalette {
  heading1: string;
  heading2: string;
  heading3: string;
  heading4: string;
  heading: string;
  strong: string;
  emphasis: string;
  strikethrough: string;
  link: string;
  url: string;
  monospace: string;
  processingInstruction: string;
  punctuation: string;
  keyword: string;
  controlKeyword: string;
  definitionKeyword: string;
  string: string;
  stringSpecial: string;
  number: string;
  bool: string;
  null: string;
  operator: string;
  functionVar: string;
  functionProp: string;
  typeName: string;
  className: string;
  propertyName: string;
  attributeName: string;
  attributeValue: string;
  lineComment: string;
  blockComment: string;
  meta: string;
  invalid: string;
}

/** Default dark-neutral syntax colours (slate / dark / black presets). */
export const SYNTAX_PALETTE_DARK: SyntaxPalette = {
  heading1: "#f1f5f9",
  heading2: "#e2e8f0",
  heading3: "#e2e8f0",
  heading4: "#cbd5e1",
  heading: "#cbd5e1",
  strong: "#f1f5f9",
  emphasis: "#e2e8f0",
  strikethrough: "#64748b",
  link: "#60a5fa",
  url: "#3b82f6",
  monospace: "#a78bfa",
  processingInstruction: "#475569",
  punctuation: "#64748b",
  keyword: "#c084fc",
  controlKeyword: "#f472b6",
  definitionKeyword: "#f472b6",
  string: "#86efac",
  stringSpecial: "#6ee7b7",
  number: "#fb923c",
  bool: "#f87171",
  null: "#f87171",
  operator: "#94a3b8",
  functionVar: "#60a5fa",
  functionProp: "#93c5fd",
  typeName: "#34d399",
  className: "#34d399",
  propertyName: "#93c5fd",
  attributeName: "#fbbf24",
  attributeValue: "#86efac",
  lineComment: "#475569",
  blockComment: "#475569",
  meta: "#64748b",
  invalid: "#ef4444",
};

/** Default light-neutral syntax colours (white / cream presets). */
export const SYNTAX_PALETTE_LIGHT: SyntaxPalette = {
  heading1: "#0f172a",
  heading2: "#1e293b",
  heading3: "#334155",
  heading4: "#475569",
  heading: "#475569",
  strong: "#0f172a",
  emphasis: "#334155",
  strikethrough: "#94a3b8",
  link: "#2563eb",
  url: "#1d4ed8",
  monospace: "#5b21b6",
  processingInstruction: "#94a3b8",
  punctuation: "#64748b",
  keyword: "#7c3aed",
  controlKeyword: "#db2777",
  definitionKeyword: "#db2777",
  string: "#047857",
  stringSpecial: "#0f766e",
  number: "#c2410c",
  bool: "#dc2626",
  null: "#dc2626",
  operator: "#475569",
  functionVar: "#2563eb",
  functionProp: "#1d4ed8",
  typeName: "#047857",
  className: "#047857",
  propertyName: "#1d4ed8",
  attributeName: "#b45309",
  attributeValue: "#047857",
  lineComment: "#64748b",
  blockComment: "#64748b",
  meta: "#94a3b8",
  invalid: "#dc2626",
};

/**
 * Derive markdown / code syntax colours from the editor background.
 * Neutral greys keep the tuned defaults; chromatic themes shift hues away
 * from the background and enforce readable contrast for prose tokens.
 */
export function deriveSyntaxPalette(
  bg: string,
  fg: string,
  isDark: boolean,
  secondary: string,
  muted: string,
): SyntaxPalette {
  const { s: bgSat } = hexToHsl(bg);
  if (bgSat < 0.12) {
    return isDark ? { ...SYNTAX_PALETTE_DARK } : { ...SYNTAX_PALETTE_LIGHT };
  }

  const proseHeading = ensureReadableOn(fg, bg, 4.5);
  const proseSub = ensureReadableOn(mixHex(fg, secondary, 0.28), bg, 4.0);
  const proseMuted = ensureReadableOn(mixHex(fg, muted, 0.45), bg, 3.5);
  const punct = ensureReadableOn(mixHex(muted, fg, 0.35), bg, 3.2);

  const tone = (hue: number, sat: number, light: number) =>
    syntaxTokenColor(bg, hue, sat, light);

  const satDark = 0.68;
  const satLight = 0.62;
  const lightDark = 0.72;
  const lightLight = 0.42;

  const s = isDark ? satDark : satLight;
  const l = isDark ? lightDark : lightLight;

  const link = tone(0.58, s, l);
  const url = tone(0.55, Math.min(0.8, s + 0.05), isDark ? l - 0.06 : l - 0.04);
  const mono = tone(0.72, s, isDark ? l + 0.04 : l - 0.02);
  const keyword = tone(0.78, s, l);
  const control = tone(0.88, s, l);
  const str = tone(0.38, s, l);
  const strSp = tone(0.42, s, isDark ? l + 0.02 : l - 0.02);
  const num = tone(0.08, Math.min(0.85, s + 0.1), isDark ? l + 0.02 : l);
  const bool = tone(0.02, s, l);
  const typ = tone(0.45, s, l);
  const attr = tone(0.12, Math.min(0.85, s + 0.08), isDark ? l + 0.06 : l + 0.02);

  return {
    heading1: proseHeading,
    heading2: proseHeading,
    heading3: proseSub,
    heading4: proseSub,
    heading: proseSub,
    strong: proseHeading,
    emphasis: proseSub,
    strikethrough: proseMuted,
    link,
    url,
    monospace: mono,
    processingInstruction: punct,
    punctuation: punct,
    keyword,
    controlKeyword: control,
    definitionKeyword: control,
    string: str,
    stringSpecial: strSp,
    number: num,
    bool,
    null: bool,
    operator: proseMuted,
    functionVar: link,
    functionProp: url,
    typeName: typ,
    className: typ,
    propertyName: url,
    attributeName: attr,
    attributeValue: str,
    lineComment: proseMuted,
    blockComment: proseMuted,
    meta: proseMuted,
    invalid: ensureReadableOn(isDark ? "#ef4444" : "#dc2626", bg, 3.0),
  };
}
