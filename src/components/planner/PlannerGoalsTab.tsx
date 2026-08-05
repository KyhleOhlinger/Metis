import type { RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { GoalSection } from "@/planner/plannerStorage";
import PlannerMarkdownCell from "./PlannerMarkdownCell";

export interface PlannerGoalsTabProps {
  goalSections: GoalSection[];
  onAddSection: () => void;
  onUpdateSection: (id: string, patch: Partial<Pick<GoalSection, "title" | "content">>) => void;
  onRemoveSection: (id: string) => void;
  activeFieldKey: string | null;
  onActivateField: (key: string | null) => void;
  toolbarViewRef: RefObject<EditorView | null>;
}

export default function PlannerGoalsTab({
  goalSections,
  onAddSection,
  onUpdateSection,
  onRemoveSection,
  activeFieldKey,
  onActivateField,
  toolbarViewRef,
}: PlannerGoalsTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-text-primary">Goals</p>
          <p className="mt-0.5 max-w-xl text-[10px] text-text-muted">
            Create sections with editable titles and notes. Saved to planner JSON on disk.
          </p>
        </div>
        <button
          type="button"
          onClick={onAddSection}
          className="rounded border border-accent/40 bg-accent/20 px-2 py-1 text-[10px] font-semibold text-accent"
        >
          Add goal section
        </button>
      </div>
      {goalSections.length === 0 ? (
        <p className="text-[10px] text-text-muted">No sections yet. Use Add goal section to create one.</p>
      ) : (
        goalSections.map((section) => (
          <div key={section.id} className="rounded-md border border-border bg-surface-overlay/30 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={section.title}
                onChange={(e) => onUpdateSection(section.id, { title: e.target.value })}
                className="min-w-[12rem] flex-1 rounded border border-border bg-surface-raised px-2 py-1 text-[11px] font-semibold text-text-primary"
                aria-label="Goal section title"
              />
              <button
                type="button"
                onClick={() => onRemoveSection(section.id)}
                className="shrink-0 rounded border border-border px-2 py-1 text-[10px] text-red-300 hover:text-red-200"
              >
                Remove
              </button>
            </div>
            <div className="mt-2">
              <PlannerMarkdownCell
                fieldKey={`goal-${section.id}`}
                activeFieldKey={activeFieldKey}
                onActivateField={onActivateField}
                value={section.content}
                onChange={(next) => onUpdateSection(section.id, { content: next })}
                minHeightPx={140}
                toolbarViewRef={toolbarViewRef}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
