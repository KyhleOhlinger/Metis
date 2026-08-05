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

export interface PlannerTrackerTabProps {
  tracker: TrackerData;
  ptoRemaining: number;
  trackerFocus: { type: "holiday" | "pto" | "conference" | "trip"; id: string } | null;
  today: Date;
  importCountry: string;
  setImportCountry: (value: string) => void;
  importRegion: string;
  setImportRegion: (value: string) => void;
  importYear: string;
  setImportYear: (value: string) => void;
  importStatus: string;
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
  importRegions,
  onImportHolidays,
  updateTracker,
  updateHoliday,
  updatePto,
  updateConference,
  updateTrip,
}: PlannerTrackerTabProps) {
  return (
          <div className="space-y-3">
            <div className="rounded-md border border-accent/40 bg-accent/10 p-3">
              <p className="text-[11px] font-semibold text-text-primary">PTO Counter</p>
              <div className="mt-2 flex items-center gap-3 text-[11px]">
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
                <span className="font-semibold text-text-primary">PTO Remaining: {ptoRemaining}</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-text-primary">Public Holidays</p>
                <div className="flex items-center gap-1.5">
                  <select
                    value={importCountry}
                    onChange={(e) => setImportCountry(e.target.value)}
                    className="rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary"
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
                    className="rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary"
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
                    onClick={onImportHolidays}
                    className="rounded border border-accent/40 bg-accent/20 px-2 py-1 text-[10px] font-semibold text-accent"
                  >
                    Import by Country
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
                    className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
                  >
                    Add Row
                  </button>
                </div>
              </div>
              {importStatus && <p className="text-[10px] text-text-muted">{importStatus}</p>}
              <div className="overflow-auto rounded-md border border-border">
                <table className="min-w-[900px] w-full text-[10px]">
                  <thead className="bg-[#7F00FF] text-white">
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
                    {tracker.public_holidays.map((row) => (
                      <tr
                        key={row.id}
                        className={trackerFocus?.type === "holiday" && trackerFocus.id === row.id ? "bg-accent/10" : ""}
                      >
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <input value={row.name} onChange={(e) => updateHoliday(row.id, { name: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" />
                            {isLongWeekendHoliday(row.date) && (
                              <span className="shrink-0 rounded border border-violet-400/40 bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-violet-200">
                                Long Weekend
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1"><input type="date" value={row.date} onChange={(e) => updateHoliday(row.id, { date: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1 text-text-secondary">
                          {(parseIsoDateLocal(row.date) ?? new Date()).toLocaleDateString("en-US", { weekday: "short" })}
                        </td>
                        <td className="px-2 py-1">
                          <select value={row.status} onChange={(e) => updateHoliday(row.id, { status: e.target.value as TrackerStatus })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5">
                            <option value="Coming Up">Coming Up</option>
                            <option value="Complete">Complete</option>
                            <option value="Pending">Pending</option>
                          </select>
                        </td>
                        <td className="px-2 py-1"><input value={row.notes} onChange={(e) => updateHoliday(row.id, { notes: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><button onClick={() => updateTracker((current) => ({ ...current, public_holidays: current.public_holidays.filter((r) => r.id !== row.id) }))} className="text-red-300">Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-text-primary">Personal PTO</p>
                <button
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
                  className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
                >
                  Add Row
                </button>
              </div>
              <div className="overflow-auto rounded-md border border-border">
                <table className="min-w-[900px] w-full text-[10px]">
                  <thead className="bg-[#7F00FF] text-white">
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
                    {tracker.pto.map((row) => (
                      <tr key={row.id} className={trackerFocus?.type === "pto" && trackerFocus.id === row.id ? "bg-accent/10" : ""}>
                        <td className="px-2 py-1"><input value={row.description} onChange={(e) => updatePto(row.id, { description: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input type="date" value={row.startDate} onChange={(e) => updatePto(row.id, { startDate: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input type="date" value={row.endDate} onChange={(e) => updatePto(row.id, { endDate: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input type="number" min={1} value={row.daysTotal} onChange={(e) => updatePto(row.id, { daysTotal: Math.max(1, Number(e.target.value) || 1) })} className="w-20 rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input type="number" min={0} value={row.daysTaken} onChange={(e) => updatePto(row.id, { daysTaken: Math.max(0, Number(e.target.value) || 0) })} className="w-20 rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1">
                          <select value={row.status} onChange={(e) => updatePto(row.id, { status: e.target.value as TrackerStatus })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5">
                            <option value="Coming Up">Coming Up</option>
                            <option value="Complete">Complete</option>
                            <option value="Pending">Pending</option>
                          </select>
                        </td>
                        <td className="px-2 py-1"><input value={row.notes} onChange={(e) => updatePto(row.id, { notes: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><button onClick={() => updateTracker((current) => ({ ...current, pto: current.pto.filter((r) => r.id !== row.id) }))} className="text-red-300">Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-text-primary">Conferences</p>
                <button
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
                  className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
                >
                  Add Row
                </button>
              </div>
              <div className="overflow-auto rounded-md border border-border">
                <table className="min-w-[900px] w-full text-[10px]">
                  <thead className="bg-[#7F00FF] text-white">
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
                    {tracker.conferences.map((row) => (
                      <tr key={row.id} className={trackerFocus?.type === "conference" && trackerFocus.id === row.id ? "bg-accent/10" : ""}>
                        <td className="px-2 py-1"><input value={row.eventName} onChange={(e) => updateConference(row.id, { eventName: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input type="date" value={row.startDate} onChange={(e) => updateConference(row.id, { startDate: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input type="date" value={row.endDate} onChange={(e) => updateConference(row.id, { endDate: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input value={row.location} onChange={(e) => updateConference(row.id, { location: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><select value={row.activity} onChange={(e) => updateConference(row.id, { activity: e.target.value as "Booked" | "Pending" })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5"><option value="Pending">Pending</option><option value="Booked">Booked</option></select></td>
                        <td className="px-2 py-1"><select value={row.status} onChange={(e) => updateConference(row.id, { status: e.target.value as TrackerStatus })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5"><option value="Coming Up">Coming Up</option><option value="Complete">Complete</option><option value="Pending">Pending</option></select></td>
                        <td className="px-2 py-1"><input value={row.notes} onChange={(e) => updateConference(row.id, { notes: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><button onClick={() => updateTracker((current) => ({ ...current, conferences: current.conferences.filter((r) => r.id !== row.id) }))} className="text-red-300">Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-text-primary">Office Trips</p>
                <button
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
                  className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
                >
                  Add Row
                </button>
              </div>
              <div className="overflow-auto rounded-md border border-border">
                <table className="min-w-[900px] w-full text-[10px]">
                  <thead className="bg-[#7F00FF] text-white">
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
                    {tracker.office_trips.map((row) => (
                      <tr key={row.id} className={trackerFocus?.type === "trip" && trackerFocus.id === row.id ? "bg-accent/10" : ""}>
                        <td className="px-2 py-1"><input value={row.tripName} onChange={(e) => updateTrip(row.id, { tripName: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input type="date" value={row.startDate} onChange={(e) => updateTrip(row.id, { startDate: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input type="date" value={row.endDate} onChange={(e) => updateTrip(row.id, { endDate: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input value={row.location} onChange={(e) => updateTrip(row.id, { location: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><select value={row.activity} onChange={(e) => updateTrip(row.id, { activity: e.target.value as "Booked" | "Pending" })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5"><option value="Pending">Pending</option><option value="Booked">Booked</option></select></td>
                        <td className="px-2 py-1"><select value={row.status} onChange={(e) => updateTrip(row.id, { status: e.target.value as TrackerStatus })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5"><option value="Coming Up">Coming Up</option><option value="Complete">Complete</option><option value="Pending">Pending</option></select></td>
                        <td className="px-2 py-1"><input value={row.notes} onChange={(e) => updateTrip(row.id, { notes: e.target.value })} className="w-full rounded border border-border bg-surface-raised px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><button onClick={() => updateTracker((current) => ({ ...current, office_trips: current.office_trips.filter((r) => r.id !== row.id) }))} className="text-red-300">Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
  );
}
