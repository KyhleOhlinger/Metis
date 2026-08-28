import type { PublicHolidayEntry, TrackerData } from "./plannerStorage";
import { makeRowId } from "./plannerStorage";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauriWebview } from "@/services/metisFetch";
import { assertSafeProviderUrl } from "@/utils/providerUrlSafety";

export interface NagerHolidayRow {
  date: string;
  localName: string;
  name: string;
  global?: boolean;
  counties?: string[] | null;
}

export interface HolidayImportParams {
  year: number;
  country: string;
  region: string;
}

export interface HolidayImportResult {
  tracker: TrackerData;
  importedCount: number;
  mergedCount: number;
  statusMessage: string;
}

export function mergePublicHolidaysIntoTracker(
  current: TrackerData,
  rows: NagerHolidayRow[],
  params: HolidayImportParams,
): HolidayImportResult {
  const scopedRows = rows.filter((r) => {
    if (params.region === "ALL") return true;
    if (r.global) return true;
    return Array.isArray(r.counties) && r.counties.includes(params.region);
  });

  const nextPublicHolidays = [...current.public_holidays];
  const dateToRowIndex = new Map<string, number>();
  for (let i = 0; i < nextPublicHolidays.length; i += 1) {
    if (!dateToRowIndex.has(nextPublicHolidays[i].date)) {
      dateToRowIndex.set(nextPublicHolidays[i].date, i);
    }
  }

  let importedCount = 0;
  let mergedCount = 0;
  const importSource =
    params.region === "ALL"
      ? `${params.country}-${params.year}`
      : `${params.country}-${params.region}-${params.year}`;

  for (const row of scopedRows) {
    const importedName = row.localName || row.name || "Holiday";
    const existingIndex = dateToRowIndex.get(row.date);
    if (existingIndex === undefined) {
      const entry: PublicHolidayEntry = {
        id: makeRowId(),
        name: importedName,
        date: row.date,
        status: "Coming Up",
        notes: `Imported (${importSource})`,
      };
      nextPublicHolidays.push(entry);
      dateToRowIndex.set(row.date, nextPublicHolidays.length - 1);
      importedCount += 1;
      continue;
    }

    const existing = nextPublicHolidays[existingIndex];
    const notesChunk = `Imported ${importedName} (${importSource})`;
    const existingNotes = existing.notes ?? "";
    const alreadyNoted = existingNotes.includes(notesChunk);
    nextPublicHolidays[existingIndex] = {
      ...existing,
      notes: alreadyNoted
        ? existingNotes
        : [existingNotes, notesChunk].filter(Boolean).join(" | "),
    };
    mergedCount += 1;
  }

  return {
    tracker: { ...current, public_holidays: nextPublicHolidays },
    importedCount,
    mergedCount,
    statusMessage: `Imported ${importedCount} new holiday${importedCount === 1 ? "" : "s"}; merged ${mergedCount} existing date${mergedCount === 1 ? "" : "s"}.`,
  };
}

export async function fetchPublicHolidays(
  year: number,
  country: string,
): Promise<NagerHolidayRow[]> {
  const y = Math.trunc(Number(year));
  if (!Number.isFinite(y) || y < 1970 || y > 2100) {
    throw new Error("Holiday import year is out of range.");
  }
  const countryCode = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("Holiday import country must be a two-letter ISO code.");
  }
  const url = `https://date.nager.at/api/v3/PublicHolidays/${y}/${countryCode}`;
  assertSafeProviderUrl(url);
  const fetchFn = isTauriWebview()
    ? (tauriFetch as unknown as typeof fetch)
    : globalThis.fetch.bind(globalThis);
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as NagerHolidayRow[];
}
