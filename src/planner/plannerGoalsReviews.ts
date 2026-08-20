/** Goals and performance reviews persistence. */

import { readPlannerRaw } from "./plannerPersistence";
import { debouncePlannerSave } from "./plannerManifestIO";
import {
  makeRowId,
  type GoalSection,
  type ReviewTableRow,
  type ReviewsTableState,
} from "./plannerTypes";

const GOALS_FILE = "goals.json" as const;
const REVIEWS_FILE = "reviews.json" as const;

const DEFAULT_REVIEW_HEADERS = [
  "Review Cycle",
  "Manager Review - Strengths",
  "Manager Review - Areas of Opportunity",
  "Personal Review - Strengths",
  "Personal Review - Areas of Opportunity",
] as const;

export function defaultGoalSections(): GoalSection[] {
  return [
    { id: makeRowId(), title: "Business related", content: "" },
    { id: makeRowId(), title: "Self-Improvement", content: "" },
  ];
}

export function loadGoals(): GoalSection[] {
  try {
    const raw = readPlannerRaw(GOALS_FILE);
    if (!raw) return defaultGoalSections();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultGoalSections();
    if (parsed.length === 0) return [];
    const out: GoalSection[] = [];
    for (const item of parsed) {
      const row = item as Partial<GoalSection>;
      if (!row || typeof row.title !== "string") continue;
      out.push({
        id: typeof row.id === "string" ? row.id : makeRowId(),
        title: row.title,
        content: typeof row.content === "string" ? row.content : "",
        targetDate: typeof row.targetDate === "string" ? row.targetDate : undefined,
        archived: row.archived === true,
      });
    }
    return out.length ? out : defaultGoalSections();
  } catch {
    return defaultGoalSections();
  }
}

export function saveGoals(sections: GoalSection[]) {
  debouncePlannerSave(GOALS_FILE, sections);
}

export function normalizeReviewHeaders(raw: unknown): [string, string, string, string, string] {
  const d = [...DEFAULT_REVIEW_HEADERS] as [string, string, string, string, string];
  if (!Array.isArray(raw)) return d;
  return [
    typeof raw[0] === "string" ? raw[0] : d[0],
    typeof raw[1] === "string" ? raw[1] : d[1],
    typeof raw[2] === "string" ? raw[2] : d[2],
    typeof raw[3] === "string" ? raw[3] : d[3],
    typeof raw[4] === "string" ? raw[4] : d[4],
  ];
}

export function normalizeReviewRow(o: unknown, newId: () => string): ReviewTableRow | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id ? r.id : newId();
  return {
    id,
    cycleLabel: typeof r.cycleLabel === "string" ? r.cycleLabel : "",
    managerStrengths: typeof r.managerStrengths === "string" ? r.managerStrengths : "",
    managerOpportunity: typeof r.managerOpportunity === "string" ? r.managerOpportunity : "",
    personalStrengths: typeof r.personalStrengths === "string" ? r.personalStrengths : "",
    personalOpportunity: typeof r.personalOpportunity === "string" ? r.personalOpportunity : "",
  };
}

export function defaultReviewsState(): ReviewsTableState {
  return {
    headers: [...DEFAULT_REVIEW_HEADERS] as [string, string, string, string, string],
    rows: [],
  };
}

export function loadReviews(): ReviewsTableState {
  try {
    const raw = readPlannerRaw(REVIEWS_FILE);
    if (!raw) return defaultReviewsState();
    const parsed = JSON.parse(raw) as { headers?: unknown; rows?: unknown };
    const headers = normalizeReviewHeaders(parsed.headers);
    const rows: ReviewTableRow[] = [];
    if (Array.isArray(parsed.rows)) {
      for (const item of parsed.rows) {
        const row = normalizeReviewRow(item, makeRowId);
        if (row) rows.push(row);
      }
    }
    return { headers, rows };
  } catch {
    return defaultReviewsState();
  }
}

export function saveReviews(state: ReviewsTableState) {
  debouncePlannerSave(REVIEWS_FILE, state);
}
