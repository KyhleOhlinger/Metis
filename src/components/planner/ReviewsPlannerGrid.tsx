import { type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import PlannerMarkdownCell from "./PlannerMarkdownCell";

/** One review row — mirrors `ReviewTableRow` in DailyTaskGrid (kept separate to avoid circular imports). */
export type ReviewsPlannerRow = {
  id: string;
  cycleLabel: string;
  managerStrengths: string;
  managerOpportunity: string;
  personalStrengths: string;
  personalOpportunity: string;
};

const GRID_GAP_CLASS = "gap-1.5";
/** Matches Daily Log default: narrow row-label track + four flex columns (see DailyTaskGrid `dailyGridTemplateColumns`). */
const GRID_TEMPLATE = "110px repeat(4, minmax(210px, 1fr)) minmax(3.25rem, 4rem)";

const PURPLE_HEADER =
  "flex min-h-[2.5rem] items-center justify-center rounded-md bg-[#7F00FF] px-2 py-1.5 text-center text-[11px] font-semibold text-white";

const WORK_CELL_SHELL =
  "flex min-h-0 items-stretch rounded-md border border-border bg-surface-overlay/30 p-2";

type Props = {
  headers: [string, string, string, string, string];
  rows: ReviewsPlannerRow[];
  onHeaderChange: (index: number, value: string) => void;
  onRowPatch: (id: string, patch: Partial<Omit<ReviewsPlannerRow, "id">>) => void;
  onRemoveRow: (id: string) => void;
  toolbarViewRef: MutableRefObject<EditorView | null>;
  activeFieldKey: string | null;
  onActivateField: (key: string | null) => void;
};

/**
 * Reviews matrix using the same visual system as Daily Log: CSS Grid, `gap-1.5`, purple `rounded-md`
 * headers, row-label column (`110px`), and `bg-surface-overlay/30` work-style cells.
 *
 * Grid columns (6): cycle (plain + purple row header) · 4 markdown · actions — must match 5 editable
 * titles + remove (no extra anonymous `fr` column; that caused misaligned rows when body had only 6 cells).
 */
export default function ReviewsPlannerGrid({
  headers,
  rows,
  onHeaderChange,
  onRowPatch,
  onRemoveRow,
  toolbarViewRef,
  activeFieldKey,
  onActivateField,
}: Props) {
  const gridStyle = { gridTemplateColumns: GRID_TEMPLATE };

  return (
    <div className="overflow-auto">
      <div className={["grid min-w-[980px]", GRID_GAP_CLASS].join(" ")} style={gridStyle}>
        {headers.map((h, i) => (
          <div key={`review-h-${i}`} className={PURPLE_HEADER}>
            <label className="sr-only" htmlFor={`review-col-header-${i}`}>
              Column {i + 1} header
            </label>
            <input
              id={`review-col-header-${i}`}
              value={h}
              onChange={(e) => onHeaderChange(i, e.target.value)}
              className="w-full border-0 bg-transparent text-center text-[11px] font-semibold text-white placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-white/40"
              placeholder="Column title"
            />
          </div>
        ))}
        <div className={`${PURPLE_HEADER}`} aria-hidden />

        {rows.length === 0 ? (
          <div className="col-span-6 flex min-h-[2.5rem] items-center justify-center rounded-md border border-border bg-surface-overlay/30 px-3 py-6 text-center text-[10px] text-text-muted">
            No rows yet. Use Add row to capture a review cycle.
          </div>
        ) : (
          rows.map((row) => (
            <ReviewsPlannerDataRow
              key={row.id}
              row={row}
              headers={headers}
              onRowPatch={onRowPatch}
              onRemoveRow={onRemoveRow}
              toolbarViewRef={toolbarViewRef}
              activeFieldKey={activeFieldKey}
              onActivateField={onActivateField}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ReviewsPlannerDataRow({
  row,
  headers,
  onRowPatch,
  onRemoveRow,
  toolbarViewRef,
  activeFieldKey,
  onActivateField,
}: {
  row: ReviewsPlannerRow;
  headers: [string, string, string, string, string];
  onRowPatch: (id: string, patch: Partial<Omit<ReviewsPlannerRow, "id">>) => void;
  onRemoveRow: (id: string) => void;
  toolbarViewRef: MutableRefObject<EditorView | null>;
  activeFieldKey: string | null;
  onActivateField: (key: string | null) => void;
}) {
  return (
    <>
      <div className={`${PURPLE_HEADER} min-h-[96px]`}>
        <label className="sr-only" htmlFor={`review-cycle-${row.id}`}>
          {headers[0] || "Review cycle"}
        </label>
        <textarea
          id={`review-cycle-${row.id}`}
          value={row.cycleLabel}
          onChange={(e) => onRowPatch(row.id, { cycleLabel: e.target.value })}
          rows={3}
          placeholder="Review cycle"
          className="max-h-[5.5rem] min-h-[2.5rem] w-full resize-none overflow-auto border-0 bg-transparent text-center text-[11px] font-semibold leading-snug text-white placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-white/40"
        />
      </div>

      <div className={`${WORK_CELL_SHELL} min-h-[96px]`}>
        <PlannerMarkdownCell
          fieldKey={`${row.id}-mgr-s`}
          activeFieldKey={activeFieldKey}
          onActivateField={onActivateField}
          value={row.managerStrengths}
          onChange={(next) => onRowPatch(row.id, { managerStrengths: next })}
          minHeightPx={96}
          fontSizePx={10}
          toolbarViewRef={toolbarViewRef}
        />
      </div>
      <div className={`${WORK_CELL_SHELL} min-h-[96px]`}>
        <PlannerMarkdownCell
          fieldKey={`${row.id}-mgr-o`}
          activeFieldKey={activeFieldKey}
          onActivateField={onActivateField}
          value={row.managerOpportunity}
          onChange={(next) => onRowPatch(row.id, { managerOpportunity: next })}
          minHeightPx={96}
          fontSizePx={10}
          toolbarViewRef={toolbarViewRef}
        />
      </div>
      <div className={`${WORK_CELL_SHELL} min-h-[96px]`}>
        <PlannerMarkdownCell
          fieldKey={`${row.id}-self-s`}
          activeFieldKey={activeFieldKey}
          onActivateField={onActivateField}
          value={row.personalStrengths}
          onChange={(next) => onRowPatch(row.id, { personalStrengths: next })}
          minHeightPx={96}
          fontSizePx={10}
          toolbarViewRef={toolbarViewRef}
        />
      </div>
      <div className={`${WORK_CELL_SHELL} min-h-[96px]`}>
        <PlannerMarkdownCell
          fieldKey={`${row.id}-self-o`}
          activeFieldKey={activeFieldKey}
          onActivateField={onActivateField}
          value={row.personalOpportunity}
          onChange={(next) => onRowPatch(row.id, { personalOpportunity: next })}
          minHeightPx={96}
          fontSizePx={10}
          toolbarViewRef={toolbarViewRef}
        />
      </div>

      <div className="flex min-h-[96px] items-center justify-center">
        <button
          type="button"
          onClick={() => onRemoveRow(row.id)}
          className="rounded border border-border px-2 py-1 text-[9px] text-red-300 hover:text-red-200"
        >
          Remove
        </button>
      </div>
    </>
  );
}
