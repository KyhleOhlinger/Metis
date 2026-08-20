import { Fragment, startTransition, type MutableRefObject, type Ref } from "react";
import type { EditorView } from "@codemirror/view";
import {
  type DayEntry,
  type DayName,
  type PlannerLayoutTemplates,
  type TaskManifest,
  type TaskStatus,
  DAY_NAMES,
  DEFAULT_LAYOUT_TEMPLATES,
  PLANNER_GRID_HEADER,
  SPECIAL_LABELS,
  dayDate,
  getEntry,
  startOfDay,
  weekHeader,
  weekKey,
} from "@/planner/plannerStorage";
import PlannerMarkdownCell from "./PlannerMarkdownCell";

export type TrackerFocusType = "holiday" | "pto" | "conference" | "trip";

export interface PlannerDailyTabProps {
  shellRef: Ref<HTMLDivElement>;
  visibleWeeks: Date[];
  manifest: TaskManifest;
  today: Date;
  layoutTemplates: PlannerLayoutTemplates;
  dailyExpandedCellKey: string | null;
  onDailyExpandedCellKeyChange: React.Dispatch<React.SetStateAction<string | null>>;
  dailyGridWeighted: boolean;
  dailyGridTemplateColumns: string;
  dailyGridTemplateRows: string | undefined;
  onUpdateEntry: (monday: Date, day: DayName, next: DayEntry) => void;
  onNavigateToTracker: (focus: { type: TrackerFocusType; id: string }) => void;
  isOnOrAfterToday: (date: Date) => boolean;
  toolbarViewRef: MutableRefObject<EditorView | null>;
  onWeekHeaderClick: (monday: Date) => void;
}

export default function PlannerDailyTab({
  shellRef,
  visibleWeeks,
  manifest,
  today,
  layoutTemplates,
  dailyExpandedCellKey,
  onDailyExpandedCellKeyChange,
  dailyGridWeighted,
  dailyGridTemplateColumns,
  dailyGridTemplateRows,
  onUpdateEntry,
  onNavigateToTracker,
  isOnOrAfterToday,
  toolbarViewRef,
  onWeekHeaderClick,
}: PlannerDailyTabProps) {
  return (
    <div
      ref={shellRef}
      className={[
        "grid gap-1.5",
        dailyGridWeighted ? "min-h-0 flex-1" : "",
      ].join(" ")}
      style={{
        minWidth: `${110 + visibleWeeks.length * 210}px`,
        gridTemplateColumns: dailyGridTemplateColumns,
        ...(dailyGridTemplateRows ? { gridTemplateRows: dailyGridTemplateRows } : {}),
      }}
    >
      <div style={{ gridColumn: 1, gridRow: 1 }} aria-hidden />
      {visibleWeeks.map((monday, wi) => (
        <button
          key={`hdr-${monday.toISOString()}`}
          type="button"
          style={{ gridColumn: wi + 2, gridRow: 1 }}
          className={`${PLANNER_GRID_HEADER} cursor-pointer hover:text-accent`}
          title="Open Weekly Review for this week"
          onClick={() => onWeekHeaderClick(monday)}
        >
          {weekHeader(monday)}
        </button>
      ))}

      {DAY_NAMES.map((day, di) => (
        <Fragment key={day}>
          <div
            style={{ gridColumn: 1, gridRow: di + 2 }}
            className={PLANNER_GRID_HEADER}
          >
            {day}
          </div>
          {visibleWeeks.map((monday, wi) => {
            const cell = getEntry(manifest, monday, day);
            const isSpecial = cell.status !== "work";
            const trackerControlled = Boolean(cell.trackerSourceType && cell.trackerSourceId);
            const cellDate = dayDate(monday, day);
            const isTodayCell =
              startOfDay(cellDate).getTime() === today.getTime() && !isSpecial;
            const cellFocusKey = `${weekKey(monday)}_${day}`;
            const dailyExpanded = !isSpecial && dailyExpandedCellKey === cellFocusKey;
            const workBlocksWrapClass = dailyExpanded
              ? "flex min-h-0 flex-1 flex-col gap-2"
              : "space-y-2";
            const workLabelWrapClass = dailyExpanded
              ? "flex min-h-0 flex-1 flex-col text-[10px] font-semibold text-text-secondary"
              : "block text-[10px] font-semibold text-text-secondary";
            const dailyCmMinH = 64;
            const dailyEditDefaultH = dailyExpanded ? 200 : dailyCmMinH;
            const useTemplateLabels = isOnOrAfterToday(cellDate);
            const plannedLabel = useTemplateLabels
              ? layoutTemplates.dailyPrimaryLabel
              : DEFAULT_LAYOUT_TEMPLATES.dailyPrimaryLabel;
            const didEnabled = useTemplateLabels
              ? layoutTemplates.dailySecondaryEnabled
              : true;
            const didLabel = useTemplateLabels
              ? layoutTemplates.dailySecondaryLabel
              : DEFAULT_LAYOUT_TEMPLATES.dailySecondaryLabel;
              const specialBlockClass = dailyGridWeighted
              ? "flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto py-2 text-center text-[12px] font-semibold text-accent"
              : "flex h-[158px] items-center justify-center text-center text-[12px] font-semibold text-accent";

            return (
              <div
                key={`${monday.toISOString()}-${day}`}
                data-daily-cell={cellFocusKey}
                data-daily-today={isTodayCell ? "" : undefined}
                style={{ gridColumn: wi + 2, gridRow: di + 2 }}
                className={[
                  "rounded-md border border-border bg-surface-overlay/30 p-2",
                  dailyGridWeighted ? "flex min-h-0 h-full flex-col overflow-hidden" : "",
                  isTodayCell ? "ring-1 ring-accent/35" : "",
                  dailyExpanded ? "ring-2 ring-accent/55" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onBlur={(e) => {
                  if (isSpecial) return;
                  const rt = e.relatedTarget as Node | null;
                  if (rt && e.currentTarget.contains(rt)) return;
                  startTransition(() => {
                    onDailyExpandedCellKeyChange((cur) => (cur === cellFocusKey ? null : cur));
                  });
                }}
              >
                {cell.officeTripBanner && (
                  <div className="mb-2 shrink-0 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] text-text-primary">
                    <div className="font-semibold">{cell.officeTripBanner}</div>
                    {cell.officeTripEventId && (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigateToTracker({
                            type: "trip",
                            id: cell.officeTripEventId!,
                          })
                        }
                        className="mt-1 text-accent underline underline-offset-2"
                      >
                        Edit Event
                      </button>
                    )}
                  </div>
                )}
                <div className="mb-2 shrink-0">
                  <select
                    value={cell.status}
                    disabled={trackerControlled}
                    onChange={(e) => {
                      const nextStatus = e.target.value as TaskStatus;
                      onUpdateEntry(monday, day, {
                        ...cell,
                        status: nextStatus,
                        label: nextStatus === "work" ? undefined : SPECIAL_LABELS[nextStatus],
                      });
                    }}
                    className="w-auto max-w-full rounded border border-border bg-surface-raised px-1 py-0.5 text-[9px] leading-tight text-text-secondary"
                  >
                    <option value="work">Work</option>
                    <option value="holiday">Public Holiday</option>
                    <option value="sick">Sick Day</option>
                    <option value="pto">PTO</option>
                    <option value="personal">Personal</option>
                    <option value="offsite">Off-site / Conference</option>
                  </select>
                </div>

                {isSpecial ? (
                  <div className={specialBlockClass}>
                    <div>
                      <div>{cell.label ?? SPECIAL_LABELS[cell.status as Exclude<TaskStatus, "work">]}</div>
                      {trackerControlled && (
                        <button
                          type="button"
                          onClick={() =>
                            onNavigateToTracker({
                              type: cell.trackerSourceType!,
                              id: cell.trackerSourceId!,
                            })
                          }
                          className="mt-2 text-[10px] text-accent underline underline-offset-2"
                        >
                          Edit Event
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={[workBlocksWrapClass, dailyGridWeighted ? "min-h-0 flex-1" : ""].filter(Boolean).join(" ")}>
                    <label className={workLabelWrapClass}>
                      {plannedLabel}:
                      <div className="mt-1 min-h-0">
                        <PlannerMarkdownCell
                          value={cell.planned ?? ""}
                          onChange={(next) =>
                            onUpdateEntry(monday, day, {
                              ...cell,
                              planned: next,
                              status: "work",
                              label: undefined,
                              plannedAutoGenerated: false,
                              plannedTemplateIds: undefined,
                            })
                          }
                          editing={dailyExpanded}
                          onRequestEdit={() =>
                            startTransition(() => onDailyExpandedCellKeyChange(cellFocusKey))
                          }
                          resizeStorageKey={`${cellFocusKey}-planned`}
                          defaultEditHeightPx={dailyEditDefaultH}
                          minHeightPx={dailyCmMinH}
                          fontSizePx={10}
                          fillHeight={dailyGridWeighted && !dailyExpanded}
                          toolbarViewRef={toolbarViewRef}
                          onEditorFocus={() =>
                            startTransition(() => onDailyExpandedCellKeyChange(cellFocusKey))
                          }
                        />
                      </div>
                    </label>
                    {didEnabled && (
                      <label className={workLabelWrapClass}>
                        {didLabel}:
                        <div className="mt-1 min-h-0">
                          <PlannerMarkdownCell
                            value={cell.did ?? ""}
                            onChange={(next) =>
                              onUpdateEntry(monday, day, {
                                ...cell,
                                did: next,
                                status: "work",
                                label: undefined,
                              })
                            }
                            editing={dailyExpanded}
                            onRequestEdit={() =>
                              startTransition(() => onDailyExpandedCellKeyChange(cellFocusKey))
                            }
                            resizeStorageKey={`${cellFocusKey}-did`}
                            defaultEditHeightPx={dailyEditDefaultH}
                            minHeightPx={dailyCmMinH}
                            fontSizePx={10}
                            fillHeight={dailyGridWeighted && !dailyExpanded}
                            toolbarViewRef={toolbarViewRef}
                            onEditorFocus={() =>
                              startTransition(() => onDailyExpandedCellKeyChange(cellFocusKey))
                            }
                          />
                        </div>
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
