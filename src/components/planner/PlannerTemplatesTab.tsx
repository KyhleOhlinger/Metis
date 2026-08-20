import type { RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type {
  DayName,
  PlanTemplate,
  PlannerLayoutTemplates,
  TemplateCadence,
} from "@/planner/plannerStorage";
import { DAY_NAMES, recurrenceLabel } from "@/planner/plannerStorage";
import type { PendingTemplateAction } from "@/planner/usePlanTemplates";
import PlannerMarkdownCell from "./PlannerMarkdownCell";
import type { ReactNode } from "react";
import { useState } from "react";
import { SegmentButton } from "../commandCenter/shared/ui";

function TemplateField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-[9px] font-medium text-text-muted">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

const fieldCls =
  "w-full rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary";
const fieldOverlayCls =
  "w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-primary";

export interface PlannerTemplatesTabProps {
  templates: PlanTemplate[];
  templateName: string;
  setTemplateName: (value: string) => void;
  templateCadence: TemplateCadence;
  setTemplateCadence: (value: TemplateCadence) => void;
  templateIntervalDaysInput: string;
  setTemplateIntervalDaysInput: (value: string) => void;
  templateStartDate: string;
  setTemplateStartDate: (value: string) => void;
  templateContent: string;
  setTemplateContent: (value: string) => void;
  templateRecurrenceDay: DayName;
  setTemplateRecurrenceDay: (value: DayName) => void;
  editingTemplateId: string | null;
  editTemplateName: string;
  setEditTemplateName: (value: string) => void;
  editTemplateCadence: TemplateCadence;
  setEditTemplateCadence: (value: TemplateCadence) => void;
  editTemplateIntervalDaysInput: string;
  setEditTemplateIntervalDaysInput: (value: string) => void;
  editTemplateStartDate: string;
  setEditTemplateStartDate: (value: string) => void;
  editTemplateContent: string;
  setEditTemplateContent: (value: string) => void;
  editTemplateRecurrenceDay: DayName;
  setEditTemplateRecurrenceDay: (value: DayName) => void;
  pendingTemplateAction: PendingTemplateAction | null;
  setPendingTemplateAction: React.Dispatch<React.SetStateAction<PendingTemplateAction | null>>;
  onAddTemplate: () => void;
  onToggleTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onStartEditTemplate: (template: PlanTemplate) => void;
  onCancelEditTemplate: () => void;
  onCancelTemplateAction: () => void;
  onConfirmTemplateAction: () => void;
  onSaveTemplateEdits: () => void;
  layoutTemplates: PlannerLayoutTemplates;
  onUpdateLayoutTemplates: (patch: Partial<PlannerLayoutTemplates>) => void;
  monthlyPromptDraft: string;
  setMonthlyPromptDraft: (value: string) => void;
  onApplyMonthlyPromptTemplate: () => void;
  activeFieldKey: string | null;
  onActivateField: (key: string | null) => void;
  toolbarViewRef: RefObject<EditorView | null>;
}

export default function PlannerTemplatesTab({
  templates,
  templateName,
  setTemplateName,
  templateCadence,
  setTemplateCadence,
  templateIntervalDaysInput,
  setTemplateIntervalDaysInput,
  templateStartDate,
  setTemplateStartDate,
  templateContent,
  setTemplateContent,
  templateRecurrenceDay,
  setTemplateRecurrenceDay,
  editingTemplateId,
  editTemplateName,
  setEditTemplateName,
  editTemplateCadence,
  setEditTemplateCadence,
  editTemplateIntervalDaysInput,
  setEditTemplateIntervalDaysInput,
  editTemplateStartDate,
  setEditTemplateStartDate,
  editTemplateContent,
  setEditTemplateContent,
  editTemplateRecurrenceDay,
  setEditTemplateRecurrenceDay,
  pendingTemplateAction,
  setPendingTemplateAction,
  onAddTemplate,
  onToggleTemplate,
  onDeleteTemplate,
  onStartEditTemplate,
  onCancelEditTemplate,
  onCancelTemplateAction,
  onConfirmTemplateAction,
  onSaveTemplateEdits,
  layoutTemplates,
  onUpdateLayoutTemplates,
  monthlyPromptDraft,
  setMonthlyPromptDraft,
  onApplyMonthlyPromptTemplate,
  activeFieldKey,
  onActivateField,
  toolbarViewRef,
}: PlannerTemplatesTabProps) {
  const [pane, setPane] = useState<"plan" | "layout">("plan");
  return (
    <div className="rounded-md border border-border bg-surface-overlay/30 p-2">
      <div className="mb-2 flex items-center gap-1">
        <SegmentButton active={pane === "plan"} onClick={() => setPane("plan")}>
          Plan templates
        </SegmentButton>
        <SegmentButton active={pane === "layout"} onClick={() => setPane("layout")}>
          Layout
        </SegmentButton>
      </div>
      {pane === "plan" && (
        <>
      <p className="text-[11px] font-semibold text-text-primary">Template Cadence</p>
      <p className="mt-0.5 text-[10px] text-text-muted">
        Auto-populates empty "What do I want to do" entries by cadence.
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_140px_140px_140px_140px]">
        <TemplateField label="Name">
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Optional"
            className={fieldCls}
          />
        </TemplateField>
        <TemplateField label="Cadence">
          <select
            value={templateCadence}
            onChange={(e) => setTemplateCadence(e.target.value as TemplateCadence)}
            className={fieldCls}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="interval">Interval (days)</option>
          </select>
        </TemplateField>
        <TemplateField label="Start date">
          <input
            type="date"
            value={templateStartDate}
            onChange={(e) => setTemplateStartDate(e.target.value)}
            className={fieldCls}
          />
        </TemplateField>
        <TemplateField label="Interval (days)">
          <input
            type="number"
            min={1}
            value={templateIntervalDaysInput}
            disabled={templateCadence !== "interval"}
            onChange={(e) => setTemplateIntervalDaysInput(e.target.value)}
            className={`${fieldCls} disabled:opacity-50`}
          />
        </TemplateField>
        <TemplateField label="Recurs on">
          <select
            value={templateRecurrenceDay}
            disabled={templateCadence === "daily"}
            onChange={(e) => setTemplateRecurrenceDay(e.target.value as DayName)}
            className={`${fieldCls} disabled:opacity-50`}
          >
            {DAY_NAMES.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </TemplateField>
      </div>
      <div className="mt-2 flex items-start gap-2">
        <div className="min-h-[64px] flex-1">
          <PlannerMarkdownCell
            fieldKey="template-new"
            activeFieldKey={activeFieldKey}
            onActivateField={onActivateField}
            value={templateContent}
            onChange={setTemplateContent}
            minHeightPx={64}
            toolbarViewRef={toolbarViewRef}
          />
        </div>
        <button
          type="button"
          onClick={onAddTemplate}
          className="rounded border border-accent/40 bg-accent/20 px-3 py-1.5 text-[10px] font-semibold text-accent"
        >
          Add Template
        </button>
      </div>
      {templates.length > 0 && (
        <div className="mt-2 space-y-1">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface-raised px-2 py-1 text-[10px]"
            >
              <span className="min-w-0 truncate text-text-secondary">
                {t.name} · {recurrenceLabel(t)}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onStartEditTemplate(t)}
                  className="rounded border border-border px-1.5 py-0.5 text-text-secondary hover:text-text-primary"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onToggleTemplate(t.id)}
                  className="rounded border border-border px-1.5 py-0.5 text-text-secondary hover:text-text-primary"
                >
                  {t.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteTemplate(t.id)}
                  className="rounded border border-red-400/40 px-1.5 py-0.5 text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {pendingTemplateAction && (
        <div className="mt-2 rounded border border-border bg-surface-raised p-2">
          <p className="text-[10px] font-semibold text-text-primary">
            {pendingTemplateAction.action === "disable" ? "Disable Template" : "Delete Template"}
          </p>
          <p className="mt-1 text-[10px] text-text-secondary">
            Choose the final day this template remains active. All auto-generated occurrences after that date will be removed.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="date"
              value={pendingTemplateAction.cutoffDate}
              onChange={(e) =>
                setPendingTemplateAction((prev) =>
                  prev ? { ...prev, cutoffDate: e.target.value } : prev,
                )
              }
              className="rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-primary"
            />
            <button
              type="button"
              onClick={onConfirmTemplateAction}
              className="rounded border border-accent/40 bg-accent/20 px-2 py-1 text-[10px] font-semibold text-accent"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onCancelTemplateAction}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {editingTemplateId && (
        <div className="mt-2 rounded border border-border bg-surface-raised p-2">
          <p className="text-[10px] font-semibold text-text-primary">Edit Template</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_140px_140px_140px_140px]">
            <TemplateField label="Name">
              <input
                value={editTemplateName}
                onChange={(e) => setEditTemplateName(e.target.value)}
                className={fieldOverlayCls}
              />
            </TemplateField>
            <TemplateField label="Cadence">
              <select
                value={editTemplateCadence}
                onChange={(e) => setEditTemplateCadence(e.target.value as TemplateCadence)}
                className={fieldOverlayCls}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="interval">Interval (days)</option>
              </select>
            </TemplateField>
            <TemplateField label="Start date">
              <input
                type="date"
                value={editTemplateStartDate}
                onChange={(e) => setEditTemplateStartDate(e.target.value)}
                className={fieldOverlayCls}
              />
            </TemplateField>
            <TemplateField label="Interval (days)">
              <input
                type="number"
                min={1}
                value={editTemplateIntervalDaysInput}
                disabled={editTemplateCadence !== "interval"}
                onChange={(e) => setEditTemplateIntervalDaysInput(e.target.value)}
                className={`${fieldOverlayCls} disabled:opacity-50`}
              />
            </TemplateField>
            <TemplateField label="Recurs on">
              <select
                value={editTemplateRecurrenceDay}
                disabled={editTemplateCadence === "daily"}
                onChange={(e) => setEditTemplateRecurrenceDay(e.target.value as DayName)}
                className={`${fieldOverlayCls} disabled:opacity-50`}
              >
                {DAY_NAMES.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </TemplateField>
          </div>
          <div className="mt-2 min-h-[64px] w-full">
            <PlannerMarkdownCell
              fieldKey={`template-edit-${editingTemplateId}`}
              activeFieldKey={activeFieldKey}
              onActivateField={onActivateField}
              value={editTemplateContent}
              onChange={setEditTemplateContent}
              minHeightPx={64}
              toolbarViewRef={toolbarViewRef}
            />
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={onSaveTemplateEdits}
              className="rounded border border-accent/40 bg-accent/20 px-2 py-1 text-[10px] font-semibold text-accent"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onCancelEditTemplate}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
        </>
      )}
      {pane === "layout" && (
      <div className="rounded-md border border-border bg-surface-raised p-2">
        <p className="text-[11px] font-semibold text-text-primary">
          Review & Block Templates (applies from today onward)
        </p>
        <p className="mt-0.5 text-[10px] text-text-muted">
          Past entries keep their original structure; future/current dates use these labels and defaults.
        </p>

        <div className="mt-2 rounded border border-border bg-surface-overlay/60 p-2">
          <p className="text-[10px] font-semibold text-text-primary">Daily Log Blocks</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="text-[10px] text-text-secondary">
              Primary block label
              <input
                value={layoutTemplates.dailyPrimaryLabel}
                onChange={(e) => onUpdateLayoutTemplates({ dailyPrimaryLabel: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary"
              />
            </label>
            <label className="text-[10px] text-text-secondary">
              Secondary block label
              <input
                value={layoutTemplates.dailySecondaryLabel}
                disabled={!layoutTemplates.dailySecondaryEnabled}
                onChange={(e) => onUpdateLayoutTemplates({ dailySecondaryLabel: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary disabled:opacity-50"
              />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-1.5 text-[10px] text-text-secondary">
            <input
              type="checkbox"
              checked={layoutTemplates.dailySecondaryEnabled}
              onChange={(e) => onUpdateLayoutTemplates({ dailySecondaryEnabled: e.target.checked })}
            />
            Show secondary daily block
          </label>
        </div>

        <div className="mt-2 rounded border border-border bg-surface-overlay/60 p-2">
          <p className="text-[10px] font-semibold text-text-primary">Weekly Review Blocks</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="text-[10px] text-text-secondary">
              Left header label
              <input
                value={layoutTemplates.weeklyLeftHeader}
                onChange={(e) => onUpdateLayoutTemplates({ weeklyLeftHeader: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary"
              />
            </label>
            <label className="text-[10px] text-text-secondary">
              Right header label
              <input
                value={layoutTemplates.weeklyRightHeader}
                onChange={(e) => onUpdateLayoutTemplates({ weeklyRightHeader: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary"
              />
            </label>
          </div>
          <label className="mt-2 block text-[10px] text-text-secondary">
            Default weekly review content
            <div className="mt-1 min-h-[80px]">
              <PlannerMarkdownCell
                fieldKey="weekly-default-layout"
                activeFieldKey={activeFieldKey}
                onActivateField={onActivateField}
                value={layoutTemplates.weeklyDefaultContent}
                onChange={(v) => onUpdateLayoutTemplates({ weeklyDefaultContent: v })}
                minHeightPx={80}
                toolbarViewRef={toolbarViewRef}
              />
            </div>
          </label>
        </div>

        <div className="mt-2 rounded border border-border bg-surface-overlay/60 p-2">
          <p className="text-[10px] font-semibold text-text-primary">Monthly Review Blocks</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="text-[10px] text-text-secondary">
              Left header suffix
              <input
                value={layoutTemplates.monthlyLeftHeader}
                onChange={(e) => onUpdateLayoutTemplates({ monthlyLeftHeader: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary"
              />
            </label>
            <label className="text-[10px] text-text-secondary">
              Right header label
              <input
                value={layoutTemplates.monthlyRightHeader}
                onChange={(e) => onUpdateLayoutTemplates({ monthlyRightHeader: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-raised px-2 py-1 text-[10px] text-text-primary"
              />
            </label>
          </div>
          <label className="mt-2 block text-[10px] text-text-secondary">
            Monthly prompts (one per line)
            <div className="mt-1 min-h-[96px]">
              <PlannerMarkdownCell
                fieldKey="monthly-prompts-draft"
                activeFieldKey={activeFieldKey}
                onActivateField={onActivateField}
                value={monthlyPromptDraft}
                onChange={setMonthlyPromptDraft}
                minHeightPx={96}
                toolbarViewRef={toolbarViewRef}
              />
            </div>
          </label>
          <button
            type="button"
            onClick={onApplyMonthlyPromptTemplate}
            className="mt-2 rounded border border-accent/40 bg-accent/20 px-2 py-1 text-[10px] font-semibold text-accent"
          >
            Apply Monthly Prompts
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
