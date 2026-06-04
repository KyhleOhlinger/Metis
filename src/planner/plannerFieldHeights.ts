const STORAGE_KEY = "metis_planner_field_heights_v1";

const MIN_PX = 48;
const MAX_PX = 720;

function clampHeight(px: number): number {
  return Math.min(MAX_PX, Math.max(MIN_PX, Math.round(px)));
}

function readAll(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = clampHeight(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Persisted editor height for a planner field (weekly cell, goal section, etc.). */
export function getPlannerFieldHeight(fieldId: string, defaultPx: number): number {
  const stored = readAll()[fieldId];
  return stored !== undefined ? stored : clampHeight(defaultPx);
}

export function setPlannerFieldHeight(fieldId: string, heightPx: number): void {
  const next = { ...readAll(), [fieldId]: clampHeight(heightPx) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode — ignore
  }
}
