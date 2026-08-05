import type { RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { ReviewTableRow, ReviewsTableState } from "@/planner/plannerStorage";
import ReviewsPlannerGrid from "./ReviewsPlannerGrid";

export interface PlannerReviewsTabProps {
  reviewsState: ReviewsTableState;
  onAddRow: () => void;
  onHeaderChange: (index: number, value: string) => void;
  onRowPatch: (id: string, patch: Partial<Omit<ReviewTableRow, "id">>) => void;
  onRemoveRow: (id: string) => void;
  activeFieldKey: string | null;
  onActivateField: (key: string | null) => void;
  toolbarViewRef: RefObject<EditorView | null>;
}

export default function PlannerReviewsTab({
  reviewsState,
  onAddRow,
  onHeaderChange,
  onRowPatch,
  onRemoveRow,
  activeFieldKey,
  onActivateField,
  toolbarViewRef,
}: PlannerReviewsTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-text-primary">Reviews</p>
          <p className="mt-0.5 max-w-xl text-[10px] text-text-muted">
            Same grid pattern as Daily Log: <code className="text-[9px]">gap-1.5</code> gutters, purple rounded column and
            row headers, and card-style markdown cells (saved in <code className="text-[9px]">reviews.json</code>).
          </p>
        </div>
        <button
          type="button"
          onClick={onAddRow}
          className="rounded border border-accent/40 bg-accent/20 px-2 py-1 text-[10px] font-semibold text-accent"
        >
          Add row
        </button>
      </div>
      <ReviewsPlannerGrid
        headers={reviewsState.headers}
        rows={reviewsState.rows}
        onHeaderChange={onHeaderChange}
        onRowPatch={onRowPatch}
        onRemoveRow={onRemoveRow}
        toolbarViewRef={toolbarViewRef}
        activeFieldKey={activeFieldKey}
        onActivateField={onActivateField}
      />
    </div>
  );
}
