import { useEffect } from "react";
import {
  type ReviewTableRow,
  type ReviewsTableState,
  makeRowId,
  saveReviews,
} from "@/planner/plannerStorage";

export function usePlannerReviews(
  reviewsState: ReviewsTableState,
  setReviewsState: React.Dispatch<React.SetStateAction<ReviewsTableState>>,
  hydrationComplete: boolean,
) {
  useEffect(() => {
    if (!hydrationComplete) return;
    saveReviews(reviewsState);
  }, [reviewsState, hydrationComplete]);

  const updateReviewHeader = (index: number, value: string) => {
    setReviewsState((prev) => {
      if (index < 0 || index > 4) return prev;
      const headers = [...prev.headers] as [string, string, string, string, string];
      headers[index] = value;
      return { ...prev, headers };
    });
  };

  const updateReviewRow = (id: string, patch: Partial<Omit<ReviewTableRow, "id">>) => {
    setReviewsState((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  };

  const addReviewRow = () => {
    setReviewsState((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        {
          id: makeRowId(),
          cycleLabel: "Review period",
          managerStrengths: "",
          managerOpportunity: "",
          personalStrengths: "",
          personalOpportunity: "",
        },
      ],
    }));
  };

  const removeReviewRow = (id: string) => {
    setReviewsState((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== id) }));
  };

  return { updateReviewHeader, updateReviewRow, addReviewRow, removeReviewRow };
}
