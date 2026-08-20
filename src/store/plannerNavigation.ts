/** Cross-surface navigation into the Planner (toolbar calendar, etc.). */

export type PlannerNavigateTarget =
  | { kind: "daily"; dateIso: string }
  | { kind: "weekly"; dateIso: string }
  | { kind: "monthly"; year: number; monthIndex: number }
  | { kind: "tab"; tab: "daily" | "weekly" | "monthly" | "templates" | "tracker" | "goals" | "reviews" }
  | { kind: "tracker"; focus?: { type: "holiday" | "pto" | "conference" | "trip"; id: string } };
