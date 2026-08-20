import {
  DAY_NAMES,
  type PlannerLayoutTemplates,
  type TaskManifest,
} from "./plannerTypes";
import { addDays, monthName, toIsoDate, weekHeader } from "./plannerDates";
import { getEntry, monthEntryFor } from "./plannerManifestOps";

function mdSection(title: string, body: string): string {
  const t = body.trim();
  return `## ${title}\n\n${t || "—"}\n`;
}

export function exportPlannerWeekMarkdown(
  manifest: TaskManifest,
  monday: Date,
  layout: PlannerLayoutTemplates,
): string {
  const lines: string[] = [`# Week ${weekHeader(monday)}`, ""];
  for (const day of DAY_NAMES) {
    const cell = getEntry(manifest, monday, day);
    const date = addDays(monday, DAY_NAMES.indexOf(day));
    lines.push(`## ${day} (${toIsoDate(date)})`);
    lines.push("");
    if (cell.status !== "work") {
      lines.push(`*${cell.label ?? cell.status}*`);
      lines.push("");
      continue;
    }
    lines.push(mdSection(layout.dailyPrimaryLabel || "Planned", cell.planned ?? ""));
    if (layout.dailySecondaryEnabled) {
      lines.push(mdSection(layout.dailySecondaryLabel || "Did", cell.did ?? ""));
    }
  }
  return lines.join("\n").trim() + "\n";
}

export function exportPlannerMonthMarkdown(
  manifest: TaskManifest,
  monthDate: Date,
  layout: PlannerLayoutTemplates,
): string {
  const entry = monthEntryFor(manifest, monthDate);
  const title = `${monthName(monthDate)} ${monthDate.getFullYear()}`;
  const review = entry.monthly_review.content?.trim() ?? "";
  const achievements = entry.monthly_review.achievements?.trim() ?? "";
  const done = entry.monthly_review.date_completed
    ? `\n_Completed ${entry.monthly_review.date_completed}_\n`
    : "";
  return [
    `# ${title}`,
    done,
    mdSection(layout.monthlyRightHeader || "Monthly review", review),
    mdSection("Monthly Achievements", achievements),
  ].join("\n");
}
