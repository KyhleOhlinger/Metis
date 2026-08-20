import { useState } from "react";
import type { RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { GoalSection } from "@/planner/plannerStorage";
import PlannerMarkdownCell from "./PlannerMarkdownCell";
import { appConfirm } from "@/store/useToastStore";

export interface PlannerGoalsTabProps {
  goalSections: GoalSection[];
  onAddSection: () => void;
  onUpdateSection: (
    id: string,
    patch: Partial<Pick<GoalSection, "title" | "content" | "targetDate" | "archived">>,
  ) => void;
  onRemoveSection: (id: string) => void;
  onMoveSection: (id: string, dir: -1 | 1) => void;
  onReorderSection: (fromId: string, toId: string) => void;
  activeFieldKey: string | null;
  onActivateField: (key: string | null) => void;
  toolbarViewRef: RefObject<EditorView | null>;
}

function GoalCard({
  section,
  index,
  total,
  dragId,
  setDragId,
  onUpdateSection,
  onRemoveSection,
  onMoveSection,
  onReorderSection,
  activeFieldKey,
  onActivateField,
  toolbarViewRef,
}: {
  section: GoalSection;
  index: number;
  total: number;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  onUpdateSection: PlannerGoalsTabProps["onUpdateSection"];
  onRemoveSection: PlannerGoalsTabProps["onRemoveSection"];
  onMoveSection: PlannerGoalsTabProps["onMoveSection"];
  onReorderSection: PlannerGoalsTabProps["onReorderSection"];
  activeFieldKey: string | null;
  onActivateField: (key: string | null) => void;
  toolbarViewRef: RefObject<EditorView | null>;
}) {
  return (
    <div
      draggable
      onDragStart={() => setDragId(section.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => {
        if (dragId) onReorderSection(dragId, section.id);
        setDragId(null);
      }}
      onDragEnd={() => setDragId(null)}
      className="rounded-md border border-border bg-surface-overlay/30 p-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="cursor-grab text-[10px] text-text-muted" title="Drag to reorder">
          ⋮⋮
        </span>
        <input
          value={section.title}
          onChange={(e) => onUpdateSection(section.id, { title: e.target.value })}
          className="min-w-[12rem] flex-1 rounded border border-border bg-surface-raised px-2 py-1 text-[11px] font-semibold text-text-primary"
          aria-label="Goal section title"
        />
        <label className="flex items-center gap-1 text-[10px] text-text-muted">
          Target
          <input
            type="date"
            value={section.targetDate ?? ""}
            onChange={(e) => onUpdateSection(section.id, { targetDate: e.target.value || undefined })}
            className="rounded border border-border bg-surface-raised px-1 py-0.5 text-[10px] text-text-primary"
          />
        </label>
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMoveSection(section.id, -1)}
          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-secondary disabled:opacity-40"
        >
          Up
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          onClick={() => onMoveSection(section.id, 1)}
          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-secondary disabled:opacity-40"
        >
          Down
        </button>
        <button
          type="button"
          onClick={() => onUpdateSection(section.id, { archived: !section.archived })}
          className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
        >
          {section.archived ? "Unarchive" : "Archive"}
        </button>
        <button
          type="button"
          onClick={async () => {
            const ok = await appConfirm("Remove this goal section? This cannot be undone.", {
              title: "Remove goal",
              confirmLabel: "Remove",
              danger: true,
            });
            if (ok) onRemoveSection(section.id);
          }}
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
  );
}

export default function PlannerGoalsTab({
  goalSections,
  onAddSection,
  onUpdateSection,
  onRemoveSection,
  onMoveSection,
  onReorderSection,
  activeFieldKey,
  onActivateField,
  toolbarViewRef,
}: PlannerGoalsTabProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const active = goalSections.filter((s) => !s.archived);
  const archived = goalSections.filter((s) => s.archived);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAddSection}
          className="rounded border border-accent/40 bg-accent/20 px-2 py-1 text-[10px] font-semibold text-accent"
        >
          Add goal section
        </button>
      </div>
      {active.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-overlay/30 px-3 py-6 text-center text-[10px] text-text-muted">
          No sections yet. Use Add goal section to create one.
        </p>
      ) : (
        active.map((section) => (
          <GoalCard
            key={section.id}
            section={section}
            index={goalSections.findIndex((s) => s.id === section.id)}
            total={goalSections.length}
            dragId={dragId}
            setDragId={setDragId}
            onUpdateSection={onUpdateSection}
            onRemoveSection={onRemoveSection}
            onMoveSection={onMoveSection}
            onReorderSection={onReorderSection}
            activeFieldKey={activeFieldKey}
            onActivateField={onActivateField}
            toolbarViewRef={toolbarViewRef}
          />
        ))
      )}
      {archived.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Archived
          </p>
          {archived.map((section) => (
            <GoalCard
              key={section.id}
              section={section}
              index={goalSections.findIndex((s) => s.id === section.id)}
              total={goalSections.length}
              dragId={dragId}
              setDragId={setDragId}
              onUpdateSection={onUpdateSection}
              onRemoveSection={onRemoveSection}
              onMoveSection={onMoveSection}
              onReorderSection={onReorderSection}
              activeFieldKey={activeFieldKey}
              onActivateField={onActivateField}
              toolbarViewRef={toolbarViewRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}
