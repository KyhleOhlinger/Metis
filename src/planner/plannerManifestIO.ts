/** Planner JSON file load/save and debounced persistence. */

import { readPlannerRaw, schedulePlannerSave, type PlannerFileKey } from "./plannerPersistence";
import {
  dayNameFromDate,
  isDayName,
  parseIsoDateLocal,
  toIsoDate,
} from "./plannerDates";
import {
  DEFAULT_LAYOUT_TEMPLATES,
  makeEmptyMonthEntry,
  makeRowId,
  type ConferenceEntry,
  type OfficeTripEntry,
  type PlanTemplate,
  type PlannerLayoutTemplates,
  type PtoEntry,
  type PublicHolidayEntry,
  type TaskManifest,
  type TemplateCadence,
  type TrackerData,
  type WeekEntry,
  type WeeklyReviewEntry,
} from "./plannerTypes";

const MANIFEST_FILE = "manifest.json" as const;
const TEMPLATE_FILE = "templates.json" as const;
const LAYOUT_TEMPLATE_FILE = "layout-templates.json" as const;

export function debouncePlannerSave(fileKey: PlannerFileKey, value: unknown, delayMs = 350) {
  schedulePlannerSave(fileKey, JSON.stringify(value), delayMs);
}

export function savePlannerJsonNow(fileKey: PlannerFileKey, value: unknown) {
  schedulePlannerSave(fileKey, JSON.stringify(value), 0);
}

export function loadManifest(): TaskManifest {
  try {
    const raw = readPlannerRaw(MANIFEST_FILE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized: TaskManifest = {};

    for (const [year, months] of Object.entries(parsed ?? {})) {
      if (year === "tracker") {
        const source = (months ?? {}) as Partial<TrackerData>;
        const publicHolidays = Array.isArray(source.public_holidays) ? source.public_holidays as PublicHolidayEntry[] : [];
        const pto = Array.isArray(source.pto) ? source.pto as Array<Partial<PtoEntry> & { startDate?: string; endDate?: string }> : [];
        const conferences = Array.isArray(source.conferences)
          ? source.conferences as Array<Partial<ConferenceEntry> & { date?: string; startDate?: string; endDate?: string }>
          : [];
        const officeTrips = Array.isArray(source.office_trips)
          ? source.office_trips as Array<Partial<OfficeTripEntry> & { date?: string; startDate?: string; endDate?: string }>
          : [];
        normalized.tracker = {
          public_holidays: publicHolidays,
          pto: pto.map((row) => ({
            id: row.id ?? makeRowId(),
            description: row.description ?? "",
            startDate: row.startDate ?? toIsoDate(new Date()),
            endDate: row.endDate ?? row.startDate ?? toIsoDate(new Date()),
            daysTotal: Math.max(1, Number(row.daysTotal) || 1),
            daysTaken: Math.max(0, Number(row.daysTaken) || 0),
            status: row.status ?? "Coming Up",
            notes: row.notes ?? "",
          })),
          conferences: conferences.map((row) => ({
            id: row.id ?? makeRowId(),
            eventName: row.eventName ?? "",
            startDate: row.startDate ?? row.date ?? toIsoDate(new Date()),
            endDate: row.endDate ?? row.startDate ?? row.date ?? toIsoDate(new Date()),
            location: row.location ?? "",
            activity: row.activity === "Booked" ? "Booked" : "Pending",
            status: row.status ?? "Coming Up",
            notes: row.notes ?? "",
          })),
          office_trips: officeTrips.map((row) => ({
            id: row.id ?? makeRowId(),
            tripName: row.tripName ?? "",
            startDate: row.startDate ?? row.date ?? toIsoDate(new Date()),
            endDate: row.endDate ?? row.startDate ?? row.date ?? toIsoDate(new Date()),
            location: row.location ?? "",
            activity: row.activity === "Booked" ? "Booked" : "Pending",
            status: row.status ?? "Coming Up",
            notes: row.notes ?? "",
          })),
          pto_stats: {
            total_allocation:
              typeof source.pto_stats?.total_allocation === "number"
                ? source.pto_stats.total_allocation
                : 26,
          },
        };
        continue;
      }
      normalized[year] = {};
      for (const [month, maybeMonthEntry] of Object.entries((months as Record<string, unknown>) ?? {})) {
        const source = (maybeMonthEntry ?? {}) as Record<string, unknown>;
        const hasNormalizedShape =
          typeof source.daily_logs === "object" &&
          source.daily_logs !== null &&
          typeof source.weekly_reviews === "object" &&
          source.weekly_reviews !== null &&
          typeof source.monthly_review === "object" &&
          source.monthly_review !== null;

        if (hasNormalizedShape) {
          const monthlyReview = source.monthly_review as Record<string, unknown>;
          normalized[year][month] = {
            daily_logs: source.daily_logs as Record<string, WeekEntry>,
            weekly_reviews: source.weekly_reviews as Record<string, WeeklyReviewEntry>,
            monthly_review: {
              content:
                typeof monthlyReview.content === "string"
                  ? monthlyReview.content
                  : "",
              achievements:
                typeof monthlyReview.achievements === "string"
                  ? monthlyReview.achievements
                  : "",
              date_completed:
                typeof monthlyReview.date_completed === "string"
                  ? monthlyReview.date_completed
                  : undefined,
            },
          };
          continue;
        }

        // Backward compatibility: old versions stored week keys directly under month.
        const migrated = makeEmptyMonthEntry();
        for (const [wk, wkEntry] of Object.entries(source)) {
          if (!wk.startsWith("week_")) continue;
          migrated.daily_logs[wk] = wkEntry as WeekEntry;
        }
        normalized[year][month] = migrated;
      }
    }

    return normalized;
  } catch {
    return {};
  }
}

export function saveManifest(manifest: TaskManifest) {
  debouncePlannerSave(MANIFEST_FILE, manifest);
}

export function loadTemplates(): PlanTemplate[] {
  try {
    const raw = readPlannerRaw(TEMPLATE_FILE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const t = item as Partial<PlanTemplate>;
        if (!t || typeof t.content !== "string" || typeof t.startDate !== "string") return null;
        const cadence: TemplateCadence =
          t.cadence === "weekly" || t.cadence === "monthly" || t.cadence === "interval"
            ? t.cadence
            : "daily";
        return {
          id: typeof t.id === "string" ? t.id : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: typeof t.name === "string" ? t.name : "Template",
          cadence,
          intervalDays:
            typeof t.intervalDays === "number" && Number.isFinite(t.intervalDays) && t.intervalDays > 0
              ? Math.floor(t.intervalDays)
              : 1,
          startDate: t.startDate,
          content: t.content,
          enabled: t.enabled !== false,
          recurrenceDay: isDayName(t.recurrenceDay)
            ? t.recurrenceDay
            : (dayNameFromDate(parseIsoDateLocal(t.startDate) ?? new Date()) ?? "Monday"),
        };
      })
      .filter((t): t is PlanTemplate => Boolean(t));
  } catch {
    return [];
  }
}

export function saveTemplates(templates: PlanTemplate[]) {
  savePlannerJsonNow(TEMPLATE_FILE, templates);
}

export function loadLayoutTemplates(): PlannerLayoutTemplates {
  try {
    const raw = readPlannerRaw(LAYOUT_TEMPLATE_FILE);
    if (!raw) return DEFAULT_LAYOUT_TEMPLATES;
    const parsed = JSON.parse(raw) as Partial<PlannerLayoutTemplates>;
    const monthlyPrompts = Array.isArray(parsed.monthlyPrompts)
      ? parsed.monthlyPrompts
          .map((p) => (typeof p === "string" ? p.trim() : ""))
          .filter((p) => p.length > 0)
      : [];
    return {
      dailyPrimaryLabel: (parsed.dailyPrimaryLabel ?? DEFAULT_LAYOUT_TEMPLATES.dailyPrimaryLabel).trim() || DEFAULT_LAYOUT_TEMPLATES.dailyPrimaryLabel,
      dailySecondaryEnabled: parsed.dailySecondaryEnabled ?? DEFAULT_LAYOUT_TEMPLATES.dailySecondaryEnabled,
      dailySecondaryLabel: (parsed.dailySecondaryLabel ?? DEFAULT_LAYOUT_TEMPLATES.dailySecondaryLabel).trim() || DEFAULT_LAYOUT_TEMPLATES.dailySecondaryLabel,
      weeklyLeftHeader: (parsed.weeklyLeftHeader ?? DEFAULT_LAYOUT_TEMPLATES.weeklyLeftHeader).trim() || DEFAULT_LAYOUT_TEMPLATES.weeklyLeftHeader,
      weeklyRightHeader: (parsed.weeklyRightHeader ?? DEFAULT_LAYOUT_TEMPLATES.weeklyRightHeader).trim() || DEFAULT_LAYOUT_TEMPLATES.weeklyRightHeader,
      weeklyDefaultContent: parsed.weeklyDefaultContent ?? DEFAULT_LAYOUT_TEMPLATES.weeklyDefaultContent,
      monthlyLeftHeader: (parsed.monthlyLeftHeader ?? DEFAULT_LAYOUT_TEMPLATES.monthlyLeftHeader).trim() || DEFAULT_LAYOUT_TEMPLATES.monthlyLeftHeader,
      monthlyRightHeader: (parsed.monthlyRightHeader ?? DEFAULT_LAYOUT_TEMPLATES.monthlyRightHeader).trim() || DEFAULT_LAYOUT_TEMPLATES.monthlyRightHeader,
      monthlyPrompts: monthlyPrompts.length ? monthlyPrompts : [...DEFAULT_LAYOUT_TEMPLATES.monthlyPrompts],
    };
  } catch {
    return DEFAULT_LAYOUT_TEMPLATES;
  }
}

export function saveLayoutTemplates(layout: PlannerLayoutTemplates) {
  savePlannerJsonNow(LAYOUT_TEMPLATE_FILE, layout);
}
