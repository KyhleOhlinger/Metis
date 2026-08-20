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
      <div className="flex justify-end">
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
