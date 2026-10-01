/**
 * html2canvas cannot parse modern computed colors (`color()`, `color-mix()`,
 * `oklch()`, …). WebKit may throw "Colour is not supported" and hang the UI.
 * Rewrite to rgb/hex using canvas `fillStyle` (which the engine normalizes).
 */
const COLOR_PROPS = [
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "column-rule-color",
] as const;

const UNSAFE_COLOR = /color-mix\(|oklch\(|oklab\(|\blch\(|\blab\(|color\s*\(|light-dark\(/i;

function needsFlatten(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (!v || v === "none" || v === "transparent" || v === "currentcolor") return false;
  if (v.startsWith("#") || v.startsWith("rgb") || v.startsWith("hsl")) return false;
  return true;
}

function canvasNormalizeColor(raw: string): string | null {
  const value = raw.trim();
  if (!value || value === "none") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000000";
    ctx.fillStyle = value;
    const out = ctx.fillStyle;
    return typeof out === "string" ? out : null;
  } catch {
    return parseSrgbColorFunction(value);
  }
}

function parseSrgbColorFunction(value: string): string | null {
  const m = value.match(
    /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i,
  );
  if (!m) return null;
  const ch = (n: string) => Math.max(0, Math.min(255, Math.round(Number(n) * 255)));
  const r = ch(m[1]);
  const g = ch(m[2]);
  const b = ch(m[3]);
  const a = m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4])));
  return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`;
}

function flattenOne(el: HTMLElement, fallback: string): void {
  const view = el.ownerDocument.defaultView;
  if (!view) return;
  let cs: CSSStyleDeclaration;
  try {
    cs = view.getComputedStyle(el);
  } catch {
    return;
  }
  for (const prop of COLOR_PROPS) {
    let raw = "";
    try {
      raw = cs.getPropertyValue(prop);
    } catch {
      continue;
    }
    if (!raw) continue;
    if (!needsFlatten(raw) && !UNSAFE_COLOR.test(raw)) {
      continue;
    }
    const normalized = canvasNormalizeColor(raw);
    el.style.setProperty(prop, normalized ?? fallback);
  }

  let shadow = "";
  try {
    shadow = cs.getPropertyValue("box-shadow");
  } catch {
    shadow = "";
  }
  if (shadow && UNSAFE_COLOR.test(shadow)) {
    el.style.boxShadow = "none";
  }
}

export function flattenCssColorsForPdf(root: HTMLElement, fallback: string): void {
  flattenOne(root, fallback);
  root.querySelectorAll<HTMLElement>("*").forEach((el) => flattenOne(el, fallback));
}
