import { useEffect, useMemo, useState } from "react";
import type {
  ConferenceEntry,
  OfficeTripEntry,
  PublicHolidayEntry,
  PtoEntry,
  TrackerData,
  TrackerStatus,
} from "@/planner/plannerStorage";
import {
  HOLIDAY_COUNTRIES,
  isLongWeekendHoliday,
  makeRowId,
  parseIsoDateLocal,
  toIsoDate,
} from "@/planner/plannerStorage";
import { appConfirm } from "@/store/useToastStore";
import { SegmentButton } from "../commandCenter/shared/ui";

const cellInputCls =
  "w-full rounded border border-border bg-surface-raised px-1 py-0.5 text-[10px] text-text-primary";
const deleteBtnCls =
  "rounded border border-border px-2 py-1 text-[10px] text-red-300 hover:text-red-200";
const addRowBtnCls =
  "rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary";
const selectCls =
  "rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary";

type TrackerFilter = "all" | "upcoming" | "complete";
type TrackerRowType = "holiday" | "pto" | "conference" | "trip";

function matchesFilter(status: TrackerStatus, filter: TrackerFilter): boolean {
  if (filter === "all") return true;
  if (filter === "complete") return status === "Complete";
  return status !== "Complete";
}

function sortByDate<T>(rows: T[], getDate: (row: T) => string): T[] {
  return [...rows].sort((a, b) => getDate(a).localeCompare(getDate(b)));
}

async function confirmDelete(): Promise<boolean> {
  return appConfirm("Delete this row? This cannot be undone.", {
    title: "Delete event",
    confirmLabel: "Delete",
    danger: true,
  });
}

export interface PlannerTrackerTabProps {
  tracker: TrackerData;
  ptoRemaining: number;
  trackerFocus: { type: TrackerRowType; id: string } | null;
  today: Date;
  importCountry: string;
  setImportCountry: (value: string) => void;
  importRegion: string;
  setImportRegion: (value: string) => void;
  importYear: string;
  setImportYear: (value: string) => void;
  importStatus: string;
  importing?: boolean;
  importRegions: Array<{ code: string; label: string }>;
  onImportHolidays: () => void;
  updateTracker: (updater: (current: TrackerData) => TrackerData) => void;
  updateHoliday: (id: string, patch: Partial<PublicHolidayEntry>) => void;
  updatePto: (id: string, patch: Partial<PtoEntry>) => void;
  updateConference: (id: string, patch: Partial<ConferenceEntry>) => void;
  updateTrip: (id: string, patch: Partial<OfficeTripEntry>) => void;
}

export default function PlannerTrackerTab({
  tracker,
  ptoRemaining,
  trackerFocus,
  today,
  importCountry,
  setImportCountry,
  importRegion,
  setImportRegion,
  importYear,
  setImportYear,
  importStatus,
  importing = false,
  importRegions,
  onImportHolidays,
  updateTracker,
  updateHoliday,
  updatePto,
  updateConference,
  updateTrip,
}: PlannerTrackerTabProps) {
  const [filter, setFilter] = useState<TrackerFilter>("upcoming");
  const total = Math.max(0, tracker.pto_stats.total_allocation);
  const remainingPct = total > 0 ? Math.min(100, (ptoRemaining / total) * 100) : 0;

  const holidays = useMemo(
    () =>
      sortByDate(
        tracker.public_holidays.filter(
          (row) =>
            matchesFilter(row.status, filter) ||
            (trackerFocus?.type === "holiday" && trackerFocus.id === row.id),
        ),
        (row) => row.date,
      ),
    [tracker.public_holidays, filter, trackerFocus],
  );
  const ptoRows = useMemo(
    () =>
      sortByDate(
        tracker.pto.filter(
          (row) =>
            matchesFilter(row.status, filter) ||
            (trackerFocus?.type === "pto" && trackerFocus.id === row.id),
        ),
        (row) => row.startDate,
      ),
    [tracker.pto, filter, trackerFocus],
  );
  const conferences = useMemo(
    () =>
      sortByDate(
        tracker.conferences.filter(
          (row) =>
            matchesFilter(row.status, filter) ||
            (trackerFocus?.type === "conference" && trackerFocus.id === row.id),
        ),
        (row) => row.startDate,
      ),
    [tracker.conferences, filter, trackerFocus],
  );
  const trips = useMemo(
    () =>
      sortByDate(
        tracker.office_trips.filter(
          (row) =>
            matchesFilter(row.status, filter) ||
            (trackerFocus?.type === "trip" && trackerFocus.id === row.id),
        ),
        (row) => row.startDate,
      ),
    [tracker.office_trips, filter, trackerFocus],
  );

  useEffect(() => {
    if (!trackerFocus) return;
    const el = document.querySelector<HTMLElement>(
      `[data-tracker-row="${trackerFocus.type}-${trackerFocus.id}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
    el?.querySelector<HTMLInputElement>("input, select")?.focus();
  }, [trackerFocus]);

  const rowCls = (type: TrackerRowType, id: string) =>
    trackerFocus?.type === type && trackerFocus.id === id ? "bg-accent/10" : "";

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-accent/40 bg-accent/10 p-3">
        <p className="text-[11px] font-semibold text-text-primary">PTO Counter</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
          <label className="text-text-secondary">
            Total Allocation
            <input
              type="number"
              min={0}
              value={tracker.pto_stats.total_allocation}
              onChange={(e) =>
                updateTracker((current) => ({
                  ...current,
                  pto_stats: {
                    total_allocation: Math.max(0, Number(e.target.value) || 0),
                  },
                }))
              }
              className="ml-2 w-20 rounded border border-border bg-surface-raised px-2 py-1 text-[11px] text-text-primary"
            />
          </label>
          <span className="font-semibold text-text-primary">
            PTO Remaining: {ptoRemaining}
            {total > 0 ? ` / ${total}` : ""}
          </span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-overlay"
          role="meter"
          aria-label="PTO remaining"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={ptoRemaining}
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${remainingPct}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {(["upcoming", "complete", "all"] as const).map((id) => (
          <SegmentButton key={id} active={filter === id} onClick={() => setFilter(id)}>
            {id === "upcoming" ? "Coming up" : id === "complete" ? "Complete" : "All"}
          </SegmentButton>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-text-primary">Public Holidays</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={importCountry}
              onChange={(e) => setImportCountry(e.target.value)}
              className={selectCls}
            >
              {HOLIDAY_COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.label}
                </option>
              ))}
            </select>
            <select
              value={importRegion}
              onChange={(e) => setImportRegion(e.target.value)}
              className={selectCls}
            >
              <option value="ALL">All Provinces / States</option>
              {importRegions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1970}
              max={2100}
              value={importYear}
              onChange={(e) => setImportYear(e.target.value)}
              className="w-20 rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary"
            />
            <button
              type="button"
              onClick={onImportHolidays}
              disabled={importing}
              className="rounded border border-accent/40 bg-accent/20 px-2 py-1 text-[10px] font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? "Importing…" : "Import by Country"}
            </button>
            <button
              onClick={() =>
                updateTracker((current) => ({
                  ...current,
                  public_holidays: [
                    ...current.public_holidays,
                    {
                      id: makeRowId(),
                      name: "",
                      date: toIsoDate(today),
                      status: "Coming Up",
                      notes: "",
                    },
                  ],
                }))
              }
              type="button"
              className={addRowBtnCls}
            >
              Add Row
            </button>
          </div>
        </div>
        {importStatus && <p className="text-[10px] text-text-muted">{importStatus}</p>}
        <div className="overflow-auto rounded-md border border-border">
          <table className="min-w-[900px] w-full text-[10px]">
            <thead className="planner-grid-header-row">
              <tr>
                <th className="px-2 py-1 text-left">Holiday Name</th>
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-left">Day</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">Notes</th>
                <th className="px-2 py-1 text-left" />
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-center text-text-muted">
                    No holidays in this filter.
                  </td>
                </tr>
              )}
              {holidays.map((row) => (
                <tr
                  key={row.id}
                  data-tracker-row={`holiday-${row.id}`}
                  data-tracker-focus={
                    trackerFocus?.type === "holiday" && trackerFocus.id === row.id ? "" : undefined
                  }
                  className={rowCls("holiday", row.id)}
                >
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <input value={row.name} onChange={(e) => updateHoliday(row.id, { name: e.target.value })} className={cellInputCls} />
                      {isLongWeekendHoliday(row.date) && (
                        <span className="shrink-0 rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">
                          Long Weekend
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1"><input type="date" value={row.date} onChange={(e) => updateHoliday(row.id, { date: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1 text-text-secondary">
                    {(parseIsoDateLocal(row.date) ?? new Date()).toLocaleDateString("en-US", { weekday: "short" })}
                  </td>
                  <td className="px-2 py-1">
                    <select value={row.status} onChange={(e) => updateHoliday(row.id, { status: e.target.value as TrackerStatus })} className={cellInputCls}>
                      <option value="Coming Up">Coming Up</option>
                      <option value="Complete">Complete</option>
                      <option value="Pending">Pending</option>
                    </select>
                  </td>
                  <td className="px-2 py-1"><input value={row.notes} onChange={(e) => updateHoliday(row.id, { notes: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1">
                    <button
                      onClick={async () => {
                        if (!(await confirmDelete())) return;
                        updateTracker((current) => ({
                          ...current,
                          public_holidays: current.public_holidays.filter((r) => r.id !== row.id),
                        }));
                      }}
                      type="button"
                      className={deleteBtnCls}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-text-primary">Personal PTO</p>
          <button
            type="button"
            onClick={() =>
              updateTracker((current) => ({
                ...current,
                pto: [
                  ...current.pto,
                  {
                    id: makeRowId(),
                    description: "",
                    startDate: toIsoDate(today),
                    endDate: toIsoDate(today),
                    daysTotal: 1,
                    daysTaken: 1,
                    status: "Coming Up",
                    notes: "",
                  },
                ],
              }))
            }
            className={addRowBtnCls}
          >
            Add Row
          </button>
        </div>
        <div className="overflow-auto rounded-md border border-border">
          <table className="min-w-[900px] w-full text-[10px]">
            <thead className="planner-grid-header-row">
              <tr>
                <th className="px-2 py-1 text-left">Description</th>
                <th className="px-2 py-1 text-left">Start Date</th>
                <th className="px-2 py-1 text-left">End Date</th>
                <th className="px-2 py-1 text-left">Day(s) Total</th>
                <th className="px-2 py-1 text-left">Days Taken</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">Notes</th>
                <th className="px-2 py-1 text-left" />
              </tr>
            </thead>
            <tbody>
              {ptoRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-text-muted">
                    No PTO rows in this filter.
                  </td>
                </tr>
              )}
              {ptoRows.map((row) => (
                <tr
                  key={row.id}
                  data-tracker-row={`pto-${row.id}`}
                  data-tracker-focus={trackerFocus?.type === "pto" && trackerFocus.id === row.id ? "" : undefined}
                  className={rowCls("pto", row.id)}
                >
                  <td className="px-2 py-1"><input value={row.description} onChange={(e) => updatePto(row.id, { description: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><input type="date" value={row.startDate} onChange={(e) => updatePto(row.id, { startDate: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><input type="date" value={row.endDate} onChange={(e) => updatePto(row.id, { endDate: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><input type="number" min={1} value={row.daysTotal} onChange={(e) => updatePto(row.id, { daysTotal: Math.max(1, Number(e.target.value) || 1) })} className={`${cellInputCls} w-20`} /></td>
                  <td className="px-2 py-1"><input type="number" min={0} value={row.daysTaken} onChange={(e) => updatePto(row.id, { daysTaken: Math.max(0, Number(e.target.value) || 0) })} className={`${cellInputCls} w-20`} /></td>
                  <td className="px-2 py-1">
                    <select value={row.status} onChange={(e) => updatePto(row.id, { status: e.target.value as TrackerStatus })} className={cellInputCls}>
                      <option value="Coming Up">Coming Up</option>
                      <option value="Complete">Complete</option>
                      <option value="Pending">Pending</option>
                    </select>
                  </td>
                  <td className="px-2 py-1"><input value={row.notes} onChange={(e) => updatePto(row.id, { notes: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1">
                    <button
                      onClick={async () => {
                        if (!(await confirmDelete())) return;
                        updateTracker((current) => ({ ...current, pto: current.pto.filter((r) => r.id !== row.id) }));
                      }}
                      type="button"
                      className={deleteBtnCls}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-text-primary">Conferences</p>
          <button
            type="button"
            onClick={() =>
              updateTracker((current) => ({
                ...current,
                conferences: [
                  ...current.conferences,
                  {
                    id: makeRowId(),
                    eventName: "",
                    startDate: toIsoDate(today),
                    endDate: toIsoDate(today),
                    location: "",
                    activity: "Pending",
                    status: "Coming Up",
                    notes: "",
                  },
                ],
              }))
            }
            className={addRowBtnCls}
          >
            Add Row
          </button>
        </div>
        <div className="overflow-auto rounded-md border border-border">
          <table className="min-w-[900px] w-full text-[10px]">
            <thead className="planner-grid-header-row">
              <tr>
                <th className="px-2 py-1 text-left">Event Name</th>
                <th className="px-2 py-1 text-left">Start Date</th>
                <th className="px-2 py-1 text-left">End Date</th>
                <th className="px-2 py-1 text-left">Location</th>
                <th className="px-2 py-1 text-left">Activity</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">Notes</th>
                <th className="px-2 py-1 text-left" />
              </tr>
            </thead>
            <tbody>
              {conferences.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-text-muted">
                    No conferences in this filter.
                  </td>
                </tr>
              )}
              {conferences.map((row) => (
                <tr
                  key={row.id}
                  data-tracker-row={`conference-${row.id}`}
                  data-tracker-focus={
                    trackerFocus?.type === "conference" && trackerFocus.id === row.id ? "" : undefined
                  }
                  className={rowCls("conference", row.id)}
                >
                  <td className="px-2 py-1"><input value={row.eventName} onChange={(e) => updateConference(row.id, { eventName: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><input type="date" value={row.startDate} onChange={(e) => updateConference(row.id, { startDate: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><input type="date" value={row.endDate} onChange={(e) => updateConference(row.id, { endDate: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><input value={row.location} onChange={(e) => updateConference(row.id, { location: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><select value={row.activity} onChange={(e) => updateConference(row.id, { activity: e.target.value as "Booked" | "Pending" })} className={cellInputCls}><option value="Pending">Pending</option><option value="Booked">Booked</option></select></td>
                  <td className="px-2 py-1"><select value={row.status} onChange={(e) => updateConference(row.id, { status: e.target.value as TrackerStatus })} className={cellInputCls}><option value="Coming Up">Coming Up</option><option value="Complete">Complete</option><option value="Pending">Pending</option></select></td>
                  <td className="px-2 py-1"><input value={row.notes} onChange={(e) => updateConference(row.id, { notes: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1">
                    <button
                      onClick={async () => {
                        if (!(await confirmDelete())) return;
                        updateTracker((current) => ({
                          ...current,
                          conferences: current.conferences.filter((r) => r.id !== row.id),
                        }));
                      }}
                      type="button"
                      className={deleteBtnCls}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-text-primary">Office Trips</p>
          <button
            type="button"
            onClick={() =>
              updateTracker((current) => ({
                ...current,
                office_trips: [
                  ...current.office_trips,
                  {
                    id: makeRowId(),
                    tripName: "",
                    startDate: toIsoDate(today),
                    endDate: toIsoDate(today),
                    location: "",
                    activity: "Pending",
                    status: "Coming Up",
                    notes: "",
                  },
                ],
              }))
            }
            className={addRowBtnCls}
          >
            Add Row
          </button>
        </div>
        <div className="overflow-auto rounded-md border border-border">
          <table className="min-w-[900px] w-full text-[10px]">
            <thead className="planner-grid-header-row">
              <tr>
                <th className="px-2 py-1 text-left">Trip Name</th>
                <th className="px-2 py-1 text-left">Start Date</th>
                <th className="px-2 py-1 text-left">End Date</th>
                <th className="px-2 py-1 text-left">Location</th>
                <th className="px-2 py-1 text-left">Activity</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">Notes</th>
                <th className="px-2 py-1 text-left" />
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-text-muted">
                    No office trips in this filter.
                  </td>
                </tr>
              )}
              {trips.map((row) => (
                <tr
                  key={row.id}
                  data-tracker-row={`trip-${row.id}`}
                  data-tracker-focus={trackerFocus?.type === "trip" && trackerFocus.id === row.id ? "" : undefined}
                  className={rowCls("trip", row.id)}
                >
                  <td className="px-2 py-1"><input value={row.tripName} onChange={(e) => updateTrip(row.id, { tripName: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><input type="date" value={row.startDate} onChange={(e) => updateTrip(row.id, { startDate: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><input type="date" value={row.endDate} onChange={(e) => updateTrip(row.id, { endDate: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><input value={row.location} onChange={(e) => updateTrip(row.id, { location: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1"><select value={row.activity} onChange={(e) => updateTrip(row.id, { activity: e.target.value as "Booked" | "Pending" })} className={cellInputCls}><option value="Pending">Pending</option><option value="Booked">Booked</option></select></td>
                  <td className="px-2 py-1"><select value={row.status} onChange={(e) => updateTrip(row.id, { status: e.target.value as TrackerStatus })} className={cellInputCls}><option value="Coming Up">Coming Up</option><option value="Complete">Complete</option><option value="Pending">Pending</option></select></td>
                  <td className="px-2 py-1"><input value={row.notes} onChange={(e) => updateTrip(row.id, { notes: e.target.value })} className={cellInputCls} /></td>
                  <td className="px-2 py-1">
                    <button
                      onClick={async () => {
                        if (!(await confirmDelete())) return;
                        updateTracker((current) => ({
                          ...current,
                          office_trips: current.office_trips.filter((r) => r.id !== row.id),
                        }));
                      }}
                      type="button"
                      className={deleteBtnCls}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
