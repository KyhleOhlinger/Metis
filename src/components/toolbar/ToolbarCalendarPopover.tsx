import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useStore } from "@/store/useStore";
import {
  addDays,
  monthName,
  monthShort,
  startOfDay,
  startOfWeekMonday,
  toIsoDate,
} from "@/planner/plannerStorage";

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

function buildMonthRows(viewMonth: Date): Date[][] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  let cursor = startOfWeekMonday(new Date(year, month, 1));
  const rows: Date[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: Date[] = [];
    for (let c = 0; c < 7; c++) {
      row.push(new Date(cursor));
      cursor = addDays(cursor, 1);
    }
    rows.push(row);
  }
  return rows;
}

interface Props {
  iconSize: number;
  btnCls: string;
}

export default function ToolbarCalendarPopover({ iconSize, btnCls }: Props) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfDay(new Date()));
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigatePlannerTo = useStore((s) => s.navigatePlannerTo);

  const today = useMemo(() => startOfDay(new Date()), []);
  const rows = useMemo(() => buildMonthRows(viewMonth), [viewMonth]);
  const viewYear = viewMonth.getFullYear();
  const viewMonthIndex = viewMonth.getMonth();

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 280) });
    }
    setOpen((v) => !v);
  };

  const close = () => setOpen(false);

  const goMonth = (delta: number) => {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };

  const openDaily = (date: Date) => {
    navigatePlannerTo({ kind: "daily", dateIso: toIsoDate(date) });
    close();
  };

  const openWeekly = (monday: Date) => {
    navigatePlannerTo({ kind: "weekly", dateIso: toIsoDate(monday) });
    close();
  };

  const openMonthly = () => {
    navigatePlannerTo({ kind: "monthly", year: viewYear, monthIndex: viewMonthIndex });
    close();
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        title="Calendar — open Planner daily / weekly / monthly views"
        onMouseDown={toggle}
        className={btnCls}
      >
        <Calendar size={iconSize} />
        <ChevronDown
          size={Math.max(7, iconSize - 5)}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[998]" onMouseDown={close} />
            <div
              className="fixed z-[999] w-[280px] rounded-lg border border-border bg-surface-raised p-2.5 shadow-xl"
              style={{ top: pos.top, left: pos.left }}
            >
              <div className="mb-2 flex items-center justify-between gap-1">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    goMonth(-1);
                  }}
                  className="rounded p-1 text-text-muted hover:bg-surface-overlay hover:text-text-primary"
                  aria-label="Previous month"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openMonthly();
                  }}
                  className="rounded px-2 py-1 text-xs font-semibold text-text-primary hover:bg-accent/15 hover:text-accent"
                  title="Open Monthly Review for this month"
                >
                  {monthName(viewMonth)} {viewYear}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    goMonth(1);
                  }}
                  className="rounded p-1 text-text-muted hover:bg-surface-overlay hover:text-text-primary"
                  aria-label="Next month"
                >
                  <ChevronRight size={14} />
                </button>
              </div>

              <div className="grid grid-cols-[2rem_repeat(7,minmax(0,1fr))] gap-0.5 text-center text-[10px]">
                <div className="py-1 font-semibold uppercase tracking-wide text-text-muted">Wk</div>
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="py-1 font-semibold text-text-muted">
                    {label}
                  </div>
                ))}

                {rows.map((row) => {
                  const monday = row[0];
                  const weekInMonth =
                    monday.getMonth() === viewMonthIndex ||
                    row.some((d) => d.getMonth() === viewMonthIndex);
                  if (!weekInMonth) return null;

                  return (
                    <div key={toIsoDate(monday)} className="contents">
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          openWeekly(monday);
                        }}
                        className="rounded py-1 text-[10px] font-medium text-accent/90 hover:bg-accent/15"
                        title={`Weekly Review — week of ${monday.getDate()} ${monthShort(monday)}`}
                      >
                        {monday.getDate()}
                      </button>
                      {row.map((day) => {
                        const inMonth = day.getMonth() === viewMonthIndex;
                        const isToday = day.getTime() === today.getTime();
                        return (
                          <button
                            key={toIsoDate(day)}
                            type="button"
                            disabled={!inMonth}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              if (!inMonth) return;
                              openDaily(day);
                            }}
                            className={[
                              "rounded py-1 text-[11px] transition-colors",
                              inMonth
                                ? "text-text-primary hover:bg-surface-overlay"
                                : "cursor-default text-transparent",
                              isToday && inMonth ? "ring-1 ring-accent/50 bg-accent/10 font-semibold" : "",
                            ].join(" ")}
                            title={inMonth ? `Daily Log — ${day.toLocaleDateString()}` : undefined}
                          >
                            {inMonth ? day.getDate() : ""}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <p className="mt-2 border-t border-border pt-2 text-[10px] leading-snug text-text-muted">
                Day → Daily Log · Week → Weekly Review · Month title → Monthly Review
              </p>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
