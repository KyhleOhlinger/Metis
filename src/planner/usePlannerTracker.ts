import { useEffect, useMemo, useState } from "react";
import { fetchPublicHolidays, mergePublicHolidaysIntoTracker } from "@/planner/holidayImport";
import { toastError } from "@/store/useToastStore";
import {
  type ConferenceEntry,
  type OfficeTripEntry,
  type PublicHolidayEntry,
  type PtoEntry,
  type TaskManifest,
  type TrackerData,
  HOLIDAY_REGIONS,
  ptoDayCountsFromRange,
  getTracker,
  saveManifest,
} from "@/planner/plannerStorage";

export type TrackerFocus = {
  type: "holiday" | "pto" | "conference" | "trip";
  id: string;
} | null;

export function usePlannerTracker(
  manifest: TaskManifest,
  setManifest: React.Dispatch<React.SetStateAction<TaskManifest>>,
) {
  const [trackerFocus, setTrackerFocus] = useState<TrackerFocus>(null);
  const [importCountry, setImportCountry] = useState("CA");
  const [importRegion, setImportRegion] = useState("ALL");
  const [importYear, setImportYear] = useState(String(new Date().getFullYear()));
  const [importStatus, setImportStatus] = useState("");
  const [importing, setImporting] = useState(false);

  const tracker = useMemo(() => getTracker(manifest), [manifest]);
  const ptoRemaining = useMemo(() => {
    const holidays = tracker.public_holidays.map((holiday) => holiday.date);
    return (
      tracker.pto_stats.total_allocation -
      tracker.pto.reduce(
        (sum, row) => sum + ptoDayCountsFromRange(row.startDate, row.endDate, holidays).daysTaken,
        0,
      )
    );
  }, [tracker]);
  const importRegions = HOLIDAY_REGIONS[importCountry] ?? [];

  useEffect(() => {
    if (importRegion === "ALL") return;
    const allowed = new Set((HOLIDAY_REGIONS[importCountry] ?? []).map((region) => region.code));
    if (!allowed.has(importRegion)) setImportRegion("ALL");
  }, [importCountry, importRegion]);

  const updateTracker = (updater: (current: TrackerData) => TrackerData) => {
    setManifest((prev) => {
      const next = updater(getTracker(prev));
      const updated: TaskManifest = { ...prev, tracker: next };
      saveManifest(updated);
      return updated;
    });
  };

  const importPublicHolidays = async () => {
    const year = Number(importYear);
    if (!Number.isFinite(year) || year < 1970 || year > 2100) {
      setImportStatus("Enter a valid year.");
      return;
    }
    setImporting(true);
    setImportStatus("Importing public holidays…");
    try {
      const rows = await fetchPublicHolidays(year, importCountry);
      let statusMessage = "";
      updateTracker((current) => {
        const result = mergePublicHolidaysIntoTracker(current, rows, {
          year,
          country: importCountry,
          region: importRegion,
        });
        statusMessage = result.statusMessage;
        return result.tracker;
      });
      setImportStatus(statusMessage);
    } catch (e) {
      const msg = `Import failed: ${String(e)}`;
      setImportStatus(msg);
      toastError(msg);
    } finally {
      setImporting(false);
    }
  };

  const updateHoliday = (id: string, patch: Partial<PublicHolidayEntry>) => {
    updateTracker((current) => ({
      ...current,
      public_holidays: current.public_holidays.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };

  const updatePto = (id: string, patch: Partial<PtoEntry>) => {
    updateTracker((current) => ({
      ...current,
      pto: current.pto.map((row) => {
        if (row.id !== id) return row;
        const next: PtoEntry = { ...row, ...patch };
        if (patch.startDate === undefined && patch.endDate === undefined) return next;
        if (next.startDate && next.endDate && next.startDate > next.endDate) {
          if (patch.startDate !== undefined) next.endDate = next.startDate;
          else next.startDate = next.endDate;
        }
        const { daysTotal, daysTaken } = ptoDayCountsFromRange(
          next.startDate,
          next.endDate,
          current.public_holidays.map((holiday) => holiday.date),
        );
        next.daysTotal = daysTotal;
        next.daysTaken = daysTaken;
        return next;
      }),
    }));
  };

  const updateConference = (id: string, patch: Partial<ConferenceEntry>) => {
    updateTracker((current) => ({
      ...current,
      conferences: current.conferences.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };

  const updateTrip = (id: string, patch: Partial<OfficeTripEntry>) => {
    updateTracker((current) => ({
      ...current,
      office_trips: current.office_trips.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };

  return {
    tracker,
    ptoRemaining,
    trackerFocus,
    setTrackerFocus,
    importCountry,
    setImportCountry,
    importRegion,
    setImportRegion,
    importYear,
    setImportYear,
    importStatus,
    importing,
    importRegions,
    importPublicHolidays,
    updateTracker,
    updateHoliday,
    updatePto,
    updateConference,
    updateTrip,
  };
}
