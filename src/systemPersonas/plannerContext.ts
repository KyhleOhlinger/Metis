/**
 * Planner context for AI — markdown from the **active** planner
 * (shared or vault, whichever this vault currently uses).
 *
 * Default: every tab (Daily Log, Weekly/Monthly Review, Reviews, Goals,
 * Templates, PTO & Events) and all dated entries. Sections are omitted only
 * when listed in Settings → Planner (`plannerAiExcludedSections`).
 *
 * SECURITY: Never send the inactive planner store. Flush pending UI saves
 * first so the model sees the same cells the user just edited.
 */

import { invoke } from "@tauri-apps/api/core";
import { usePersonaStore } from "@/store/usePersonaStore";
import {
  fetchPlannerConfig,
  flushPlannerSaves,
  type PlannerStorageMode,
} from "@/planner/plannerPersistence";
import {
  exportPlannerMonthMarkdown,
  exportPlannerWeekMarkdown,
  getTracker,
  getYearEntry,
  MONTH_INDEX,
  normalizePlannerAiExcludedSections,
  parseGoalSectionsJson,
  parseLayoutTemplatesJson,
  parseManifestJson,
  parseReviewsJson,
  parseTemplatesJson,
  parseWeekStartFromKey,
  PLANNER_AI_SECTION_OPTIONS,
  type GoalSection,
  type PlanTemplate,
  type PlannerLayoutTemplates,
  type PlannerTab,
  type ReviewsTableState,
  type TaskManifest,
  type TrackerData,
} from "@/planner/plannerStorage";
import type { PlannerPeriod } from "@/types/persona";

export { PLANNER_AI_SECTION_OPTIONS, normalizePlannerAiExcludedSections } from "@/planner/plannerTypes";

export function readPlannerAiExcludedSections(): PlannerTab[] {
  return normalizePlannerAiExcludedSections(
    usePersonaStore.getState().settings.plannerAiExcludedSections,
  );
}

export const PLANNER_BRIEFING_TRIGGER =
  "Write a concise briefing for today and this week from the planner context. " +
  "Cover: (1) today's planned work if a weekday, (2) the rest of the week, " +
  "(3) PTO/holidays/trips, (4) goals with near target dates. " +
  "Be specific to the provided dates. Do not invent entries. If a day is empty, say so. " +
  "End with 3 suggested next actions.";

export const PLANNER_WEEKLY_REVIEW_TRIGGER =
  "Draft a Weekly Review in Markdown from this week's Daily Log (Planned vs Did). " +
  "Use the existing weekly review text as a starting point if present. " +
  "Structure: what went well, what slipped, follow-ups for next week. " +
  "Do not invent work that is not in the log. Output only the review body — no preamble. " +
  "Paste-ready for the Weekly Review cell.";

export const PLANNER_MONTHLY_REVIEW_TRIGGER =
  "Draft a Monthly Review in Markdown from this month's daily logs, weekly notes, " +
  "and the existing monthly review/achievements if present. " +
  "Structure: themes, what shipped, what slipped, achievements, focus for next month. " +
  "Do not invent work that is not in the log. Output only the review body — no preamble. " +
  "Paste-ready for the Monthly Review cell.";

export type PlannerPersonaJob = "briefing" | "weekly-review" | "monthly-review";

export function plannerJobPeriod(job: PlannerPersonaJob): PlannerPeriod {
  return job === "monthly-review" ? "month" : "week";
}

export function plannerJobTrigger(job: PlannerPersonaJob): string {
  switch (job) {
    case "briefing":
      return PLANNER_BRIEFING_TRIGGER;
    case "weekly-review":
      return PLANNER_WEEKLY_REVIEW_TRIGGER;
    case "monthly-review":
      return PLANNER_MONTHLY_REVIEW_TRIGGER;
  }
}

export type PlannerContextResult = {
  context: string;
  chars: number;
  mode: PlannerStorageMode;
  empty: boolean;
  excludedSections: PlannerTab[];
};

function sectionEnabled(excluded: PlannerTab[], tab: PlannerTab): boolean {
  return !excluded.includes(tab);
}

function formatTrackerMarkdown(tracker: TrackerData): string {
  const lines: string[] = [
    `PTO allocation: ${tracker.pto_stats.total_allocation}`,
    "",
    "### Public holidays",
  ];
  if (!tracker.public_holidays.length) {
    lines.push("_None._");
  } else {
    for (const row of tracker.public_holidays) {
      lines.push(
        `- ${row.date} — ${row.name || "Holiday"} (${row.status})${row.notes.trim() ? ` — ${row.notes.trim()}` : ""}`,
      );
    }
  }
  lines.push("", "### PTO");
  if (!tracker.pto.length) {
    lines.push("_None._");
  } else {
    for (const row of tracker.pto) {
      lines.push(
        `- ${row.startDate}–${row.endDate} — ${row.description || "PTO"} ` +
          `(${row.status}; ${row.daysTaken}/${row.daysTotal} days)` +
          `${row.notes.trim() ? ` — ${row.notes.trim()}` : ""}`,
      );
    }
  }
  lines.push("", "### Conferences");
  if (!tracker.conferences.length) {
    lines.push("_None._");
  } else {
    for (const row of tracker.conferences) {
      lines.push(
        `- ${row.startDate}–${row.endDate} — ${row.eventName || "Conference"} ` +
          `(${row.location || "—"}; ${row.activity}; ${row.status})` +
          `${row.notes.trim() ? ` — ${row.notes.trim()}` : ""}`,
      );
    }
  }
  lines.push("", "### Office trips");
  if (!tracker.office_trips.length) {
    lines.push("_None._");
  } else {
    for (const row of tracker.office_trips) {
      lines.push(
        `- ${row.startDate}–${row.endDate} — ${row.tripName || "Office trip"} ` +
          `(${row.location || "—"}; ${row.activity}; ${row.status})` +
          `${row.notes.trim() ? ` — ${row.notes.trim()}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

function formatGoalsMarkdown(goals: GoalSection[]): string {
  if (!goals.length) return "_No goals._";
  return goals
    .map((g) => {
      const due = g.targetDate ? ` (target: ${g.targetDate})` : "";
      const archived = g.archived ? " — archived" : "";
      const body = g.content.trim() ? `\n\n${g.content.trim()}` : "";
      return `### ${g.title}${due}${archived}${body}`;
    })
    .join("\n\n");
}

function formatReviewsMarkdown(reviews: ReviewsTableState): string {
  if (!reviews.rows.length) return "_No performance review rows._";
  const [h0, h1, h2, h3, h4] = reviews.headers;
  const lines = [
    `| ${h0} | ${h1} | ${h2} | ${h3} | ${h4} |`,
    `| --- | --- | --- | --- | --- |`,
  ];
  for (const row of reviews.rows) {
    const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
    lines.push(
      `| ${cell(row.cycleLabel)} | ${cell(row.managerStrengths)} | ${cell(row.managerOpportunity)} | ${cell(row.personalStrengths)} | ${cell(row.personalOpportunity)} |`,
    );
  }
  return lines.join("\n");
}

function formatTemplatesMarkdown(
  templates: PlanTemplate[],
  layout: PlannerLayoutTemplates,
): string {
  const layoutBlock = [
    "### Layout labels",
    `- Daily primary: ${layout.dailyPrimaryLabel}`,
    `- Daily secondary: ${layout.dailySecondaryEnabled ? layout.dailySecondaryLabel : "off"}`,
    `- Weekly: ${layout.weeklyLeftHeader} / ${layout.weeklyRightHeader}`,
    `- Monthly: ${layout.monthlyLeftHeader} / ${layout.monthlyRightHeader}`,
    layout.monthlyPrompts.length
      ? `- Monthly prompts: ${layout.monthlyPrompts.join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (!templates.length) {
    return `${layoutBlock}\n\n_No plan templates._`;
  }
  const body = templates
    .map((t) => {
      const cadence =
        t.cadence === "interval" ? `every ${t.intervalDays} day(s)` : t.cadence;
      const enabled = t.enabled ? "enabled" : "disabled";
      return (
        `### ${t.name} (${cadence}, starts ${t.startDate}, ${t.recurrenceDay}, ${enabled})\n\n` +
        (t.content.trim() || "_Empty template._")
      );
    })
    .join("\n\n");
  return `${layoutBlock}\n\n${body}`;
}

function yearKeys(manifest: TaskManifest): string[] {
  return Object.keys(manifest)
    .filter((k) => k !== "tracker")
    .sort();
}

function monthKeys(year: string, manifest: TaskManifest): string[] {
  const entry = getYearEntry(manifest, year);
  return Object.keys(entry).sort(
    (a, b) => (MONTH_INDEX[a] ?? 99) - (MONTH_INDEX[b] ?? 99),
  );
}

function exportCalendarMarkdown(
  manifest: TaskManifest,
  layout: PlannerLayoutTemplates,
  excluded: PlannerTab[],
): string {
  const wantDaily = sectionEnabled(excluded, "daily");
  const wantWeekly = sectionEnabled(excluded, "weekly");
  const wantMonthly = sectionEnabled(excluded, "monthly");
  if (!wantDaily && !wantWeekly && !wantMonthly) return "";

  const chunks: string[] = [];
  for (const year of yearKeys(manifest)) {
    for (const month of monthKeys(year, manifest)) {
      const monthIndex = MONTH_INDEX[month];
      if (monthIndex === undefined) continue;
      const monthDate = new Date(Number(year), monthIndex, 1);
      const entry = getYearEntry(manifest, year)[month];
      if (!entry) continue;

      if (wantMonthly) {
        chunks.push(exportPlannerMonthMarkdown(manifest, monthDate, layout));
      }

      const weekKeys = new Set([
        ...Object.keys(entry.daily_logs),
        ...Object.keys(entry.weekly_reviews),
      ]);
      for (const wk of [...weekKeys].sort()) {
        const monday = parseWeekStartFromKey(Number(year), monthIndex, wk);
        if (!monday) continue;
        if (wantDaily && entry.daily_logs[wk]) {
          chunks.push(exportPlannerWeekMarkdown(manifest, monday, layout));
        }
        if (wantWeekly) {
          const review = entry.weekly_reviews[wk]?.content?.trim();
          if (review) {
            chunks.push(`## Weekly review — ${wk} (${year} ${month})\n\n${review}`);
          }
        }
      }
    }
  }
  return chunks.filter(Boolean).join("\n\n") || "_No calendar entries._";
}

async function loadActivePlannerFiles(vaultPath: string): Promise<{
  mode: PlannerStorageMode;
  manifest: TaskManifest;
  layout: PlannerLayoutTemplates;
  goals: GoalSection[];
  templates: PlanTemplate[];
  reviews: ReviewsTableState;
}> {
  await flushPlannerSaves();
  const config = await fetchPlannerConfig(vaultPath);
  const [manifestRaw, layoutRaw, goalsRaw, templatesRaw, reviewsRaw] = await Promise.all([
    invoke<string | null>("planner_load_file", { vaultPath, fileKey: "manifest.json" }),
    invoke<string | null>("planner_load_file", { vaultPath, fileKey: "layout-templates.json" }),
    invoke<string | null>("planner_load_file", { vaultPath, fileKey: "goals.json" }),
    invoke<string | null>("planner_load_file", { vaultPath, fileKey: "templates.json" }),
    invoke<string | null>("planner_load_file", { vaultPath, fileKey: "reviews.json" }),
  ]);
  return {
    mode: config.mode,
    manifest: parseManifestJson(manifestRaw),
    layout: parseLayoutTemplatesJson(layoutRaw),
    goals: parseGoalSectionsJson(goalsRaw),
    templates: parseTemplatesJson(templatesRaw),
    reviews: parseReviewsJson(reviewsRaw),
  };
}

function modeLabel(mode: PlannerStorageMode): string {
  return mode === "vault"
    ? "vault (this vault only)"
    : "shared (profile-wide; same calendar in every shared-mode vault)";
}

/**
 * Tracker excerpt for Task Manager. Honours the same Settings exclusions.
 */
export async function buildPlannerUpcomingSection(vaultPath: string): Promise<string> {
  const excluded = readPlannerAiExcludedSections();
  if (!sectionEnabled(excluded, "tracker")) return "";
  const { mode, manifest } = await loadActivePlannerFiles(vaultPath);
  const tracker = getTracker(manifest);
  const hasRows =
    tracker.public_holidays.length +
      tracker.pto.length +
      tracker.conferences.length +
      tracker.office_trips.length >
    0;
  if (!hasRows) return "";
  return [
    `## Active planner — PTO & Events`,
    ``,
    `_Mode: ${modeLabel(mode)}. Flag or skip vault tasks that fall on PTO, holidays, or trips._`,
    ``,
    formatTrackerMarkdown(tracker),
  ].join("\n");
}

export async function buildPlannerContext(
  vaultPath: string,
  options?: {
    includeCurrentFile?: boolean;
    currentFileContent?: string;
    currentFilePath?: string | null;
    excludedSections?: PlannerTab[];
  },
): Promise<PlannerContextResult> {
  const excluded = options?.excludedSections ?? readPlannerAiExcludedSections();
  const { mode, manifest, layout, goals, templates, reviews } =
    await loadActivePlannerFiles(vaultPath);

  const excludedLabels = excluded
    .map((id) => PLANNER_AI_SECTION_OPTIONS.find((s) => s.id === id)?.label ?? id)
    .join(", ");

  const parts: string[] = [
    `# Active planner`,
    ``,
    `- Storage: ${modeLabel(mode)}`,
    `- Generated: ${new Date().toISOString().slice(0, 10)}`,
    `- Sections: all planner tabs` +
      (excludedLabels ? ` except ${excludedLabels} (Settings → Planner)` : " (no Settings exclusions)"),
    `- Not included: the inactive planner store.`,
    ``,
  ];

  const calendar = exportCalendarMarkdown(manifest, layout, excluded);
  if (calendar) {
    parts.push("## Calendar (Daily Log, Weekly Review, Monthly Review)", "", calendar, "");
  }

  if (sectionEnabled(excluded, "tracker")) {
    parts.push("## PTO & Events", "", formatTrackerMarkdown(getTracker(manifest)), "");
  }
  if (sectionEnabled(excluded, "goals")) {
    parts.push("## Goals", "", formatGoalsMarkdown(goals), "");
  }
  if (sectionEnabled(excluded, "reviews")) {
    parts.push("## Reviews", "", formatReviewsMarkdown(reviews), "");
  }
  if (sectionEnabled(excluded, "templates")) {
    parts.push("## Templates", "", formatTemplatesMarkdown(templates, layout), "");
  }

  if (options?.includeCurrentFile) {
    const name = options.currentFilePath?.split("/").pop() ?? "Current note";
    const body = options.currentFileContent?.trim() || "(empty note)";
    parts.push(`## Current note — ${name}`, "", body, "");
  }

  const context = parts.join("\n").trim() + "\n";
  return {
    context,
    chars: context.length,
    mode,
    empty: context.length < 200,
    excludedSections: excluded,
  };
}
