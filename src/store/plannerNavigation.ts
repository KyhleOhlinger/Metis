/** Cross-surface navigation into the Planner (toolbar calendar, etc.). */

export type PlannerNavigateTarget =
  | { kind: "daily"; dateIso: string }
  | { kind: "weekly"; dateIso: string }
  | { kind: "monthly"; year: number; monthIndex: number };
