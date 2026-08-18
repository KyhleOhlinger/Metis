import { useEffect, useMemo, useState } from "react";
import { usePersonaStore } from "../../store/usePersonaStore";
import { clearAgentRunLogOnDisk } from "../../services/agentRunLogService";
import { contextEgressLabel } from "../../services/contextBuilder";
import { saveTextViaDialog } from "../../utils/saveDialogExport";
import {
  AGENT_TYPE_LABELS,
  type AgentRunLogEntry,
  type AgentRunStatus,
  type AgentType,
} from "../../types/agentRunLog";
import {
  computeAgentRunTotals,
  exportAgentRunsCsv,
  exportAgentRunsJson,
  filterAgentRunLog,
  formatDateRangeLabel,
  hasActiveRunFilters,
  runEntryTitle,
  runEntryBodyPreview,
  runDetailAllowsExpand,
  runRowShowsMetadata,
  SEARCH_SCOPE_LABELS,
  vaultRelativeFilePath,
  type AgentRunDateRange,
  type AgentRunSearchScope,
} from "../../utils/agentRunLogFilters";
import {
  formatCostUsd,
  formatDurationMs,
  formatRunCostSummary,
  formatRunTokenSummary,
} from "../../utils/modelPricing";
import { appConfirm, toastError, toastSuccess } from "../../store/useToastStore";

function statusBadge(status: AgentRunStatus): string {
  switch (status) {
    case "success":
      return "bg-emerald-500/15 text-emerald-400";
    case "error":
      return "bg-red-500/15 text-red-400";
    case "aborted":
      return "bg-amber-500/15 text-amber-400";
  }
}

function RunDetail({
  entry,
  viewScope,
}: {
  entry: AgentRunLogEntry;
  viewScope: AgentRunSearchScope;
}) {
  const filePath = vaultRelativeFilePath(entry);

  if (viewScope === "title") return null;

  const showPrompt = viewScope === "user" || viewScope === "all";
  const showResponse = viewScope === "ai" || viewScope === "all";
  const showMeta = viewScope === "all";

  return (
    <div className="space-y-2 border-t border-border/60 px-4 py-3 text-[11px] text-text-muted">
      {showPrompt && (
        <div>
          <span className="font-semibold text-text-secondary">Prompt</span>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{entry.userMessage || "—"}</p>
        </div>
      )}
      {showResponse && entry.responsePreview && (
        <div>
          <span className="font-semibold text-text-secondary">Response preview</span>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{entry.responsePreview}</p>
        </div>
      )}
      {showResponse && entry.errorMessage && (
        <div>
          <span className="font-semibold text-red-400">Error</span>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-red-300/90">{entry.errorMessage}</p>
        </div>
      )}
      {showMeta && entry.contextStrategy && (
        <p>
          <span className="font-semibold text-text-secondary">Context egress: </span>
          {contextEgressLabel(entry.contextStrategy)}
        </p>
      )}
      {showMeta && (
        <p>
          <span className="font-semibold text-text-secondary">Tokens: </span>
          {formatRunTokenSummary(entry.usage)}
        </p>
      )}
      {showMeta && (
        <p>
          <span className="font-semibold text-text-secondary">Est. cost: </span>
          {formatRunCostSummary(entry.estimatedCostUsd, entry.usage)}
        </p>
      )}
      {showMeta && entry.toolCalls && entry.toolCalls.length > 0 && (
        <div>
          <span className="font-semibold text-text-secondary">Tool calls</span>
          <ul className="mt-0.5 list-disc pl-4">
            {entry.toolCalls.map((tc, i) => (
              <li key={`${tc.name}-${i}`}>
                {tc.name}
                {tc.path ? ` · ${tc.path.split("/").pop()}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showMeta && (
        <p>
          <span className="font-semibold text-text-secondary">Provider: </span>
          {entry.providerLabel} · {entry.model}
        </p>
      )}
      {showMeta && filePath && (
        <p>
          <span className="font-semibold text-text-secondary">File: </span>
          {filePath}
        </p>
      )}
    </div>
  );
}

function RunListRow({
  entry,
  viewScope,
  expanded,
  onToggle,
}: {
  entry: AgentRunLogEntry;
  viewScope: AgentRunSearchScope;
  expanded: boolean;
  onToggle: () => void;
}) {
  const body = runEntryBodyPreview(entry, viewScope);
  const showMetadata = runRowShowsMetadata(viewScope);
  const canExpand = runDetailAllowsExpand(viewScope);

  const inner = (
    <>
      {canExpand && (
        <span className="mt-0.5 w-4 shrink-0 text-[10px] text-text-muted">
          {expanded ? "▾" : "▸"}
        </span>
      )}
      {!canExpand && <span className="mt-0.5 w-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-text-primary">{runEntryTitle(entry)}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${statusBadge(entry.status)}`}
          >
            {entry.status}
          </span>
          {!showMetadata && (
            <span className="text-[10px] text-text-muted">
              {new Date(entry.startedAt).toLocaleString()}
            </span>
          )}
        </div>
        {body && (
          <p
            className={[
              "mt-0.5 text-[11px] text-text-secondary",
              viewScope === "all" ? "truncate" : "whitespace-pre-wrap break-words",
            ].join(" ")}
          >
            {body}
          </p>
        )}
        {showMetadata && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
            <span>{new Date(entry.startedAt).toLocaleString()}</span>
            <span>{formatDurationMs(entry.durationMs)}</span>
            <span>{entry.model}</span>
            <span>{formatRunTokenSummary(entry.usage)}</span>
            <span className="text-emerald-400/90">
              {formatRunCostSummary(entry.estimatedCostUsd, entry.usage)}
            </span>
          </div>
        )}
      </div>
    </>
  );

  if (canExpand) {
    return (
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        {inner}
      </button>
    );
  }

  return <div className="flex items-start gap-3 px-4 py-3">{inner}</div>;
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-overlay/60 px-2.5 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-[11px] font-medium text-text-primary">{value}</p>
    </div>
  );
}

export default function AgentRunHistoryPage() {
  const agentRunLog = usePersonaStore((s) => s.agentRunLog);
  const personasLoading = usePersonaStore((s) => s.loading);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AgentRunStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<AgentType | "all">("all");
  const [search, setSearch] = useState("");
  const [searchScope, setSearchScope] = useState<AgentRunSearchScope>("all");
  const [dateRange, setDateRange] = useState<AgentRunDateRange>({ from: "", to: "" });
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setExpandedId(null);
  }, [searchScope]);

  const searchPlaceholder = useMemo(() => {
    switch (searchScope) {
      case "title":
        return "Search titles…";
      case "user":
        return "Search your messages…";
      case "ai":
        return "Search AI responses…";
      case "all":
        return "Search all content…";
    }
  }, [searchScope]);

  const filterOptions = useMemo(
    () => ({ status: statusFilter, type: typeFilter, search, searchScope, dateRange }),
    [statusFilter, typeFilter, search, searchScope, dateRange],
  );

  const filtered = useMemo(
    () => filterAgentRunLog(agentRunLog, filterOptions),
    [agentRunLog, filterOptions],
  );

  const totals = useMemo(() => computeAgentRunTotals(filtered), [filtered]);
  const activeFilters = hasActiveRunFilters(filterOptions);
  const rangeLabel = formatDateRangeLabel(dateRange, totals);

  const handleClear = async () => {
    const ok = await appConfirm("Clear all agent run history? This cannot be undone.", {
      title: "Clear run history",
      confirmLabel: "Clear all",
      danger: true,
    });
    if (!ok) return;
    setClearing(true);
    try {
      await clearAgentRunLogOnDisk();
      toastSuccess("Agent run log cleared.");
    } catch (e) {
      toastError(typeof e === "string" ? e : "Could not clear run log.");
    } finally {
      setClearing(false);
    }
  };

  const exportRuns = async (format: "csv" | "json") => {
    if (filtered.length === 0) {
      toastError("No runs to export for the current filters.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const defaultName = `metis-agent-runs-${stamp}`;
    try {
      const content =
        format === "csv" ? exportAgentRunsCsv(filtered) : exportAgentRunsJson(filtered);
      const savePath = await saveTextViaDialog(defaultName, format, content);
      if (!savePath) return;
      toastSuccess(
        `Exported ${filtered.length} run${filtered.length === 1 ? "" : "s"} to ${savePath.split("/").pop()}`,
      );
    } catch (e) {
      toastError(typeof e === "string" ? e : "Could not export run log.");
    }
  };

  const selectCls =
    "rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary";

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base text-text-primary">
      <div className="shrink-0 border-b border-border bg-surface-raised/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold text-text-primary">Agent Run Log</h1>
            <p className="mt-0.5 text-[11px] text-text-muted">{rangeLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void exportRuns("csv")}
              disabled={filtered.length === 0}
              className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-40"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => void exportRuns("json")}
              disabled={filtered.length === 0}
              className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-40"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => void handleClear()}
              disabled={clearing || agentRunLog.length === 0}
              className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-muted transition-colors hover:border-red-500/40 hover:text-red-400 disabled:opacity-40"
            >
              Clear log
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatPill label="Runs" value={totals.count.toLocaleString()} />
          <StatPill label="Messages" value={totals.messageCount.toLocaleString()} />
          <StatPill
            label="Tokens"
            value={totals.tokens > 0 ? totals.tokens.toLocaleString() : "—"}
          />
          <StatPill label="Est. cost" value={formatCostUsd(totals.cost > 0 ? totals.cost : undefined)} />
        </div>
        <p className="mt-1.5 text-[10px] text-text-muted">
          {formatDurationMs(totals.durationMs)} total runtime
          {activeFilters ? " · filtered totals" : ""}
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="min-w-[12rem] flex-1 rounded border border-border bg-surface-overlay px-2.5 py-1.5 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
            <select
              value={searchScope}
              onChange={(e) => setSearchScope(e.target.value as AgentRunSearchScope)}
              className={selectCls}
              title="View and search scope"
            >
              {(Object.keys(SEARCH_SCOPE_LABELS) as AgentRunSearchScope[]).map((scope) => (
                <option key={scope} value={scope}>
                  {SEARCH_SCOPE_LABELS[scope]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
              From
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange((r) => ({ ...r, from: e.target.value }))}
                className={selectCls}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
              To
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange((r) => ({ ...r, to: e.target.value }))}
                className={selectCls}
              />
            </label>
            {(dateRange.from || dateRange.to) && (
              <button
                type="button"
                onClick={() => setDateRange({ from: "", to: "" })}
                className="text-[10px] text-text-muted hover:text-text-primary"
              >
                Clear dates
              </button>
            )}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AgentRunStatus | "all")}
              className={selectCls}
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="aborted">Aborted</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as AgentType | "all")}
              className={selectCls}
            >
              <option value="all">All agent types</option>
              {(Object.keys(AGENT_TYPE_LABELS) as AgentType[]).map((t) => (
                <option key={t} value={t}>
                  {AGENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {personasLoading ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-sm text-text-muted">Loading run log…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-sm text-text-muted">
              {activeFilters ? "No runs match the current filters." : "No agent runs recorded yet."}
            </p>
            <p className="mt-1 max-w-sm text-[11px] text-text-muted/70">
              {activeFilters
                ? "Try adjusting search, date range, status, or agent type."
                : "Runs from the Command Center AI tab appear here with runtime, token usage, and estimated cost."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filtered.map((entry) => {
              const expanded = expandedId === entry.id;
              return (
                <div key={entry.id} className="bg-surface-base hover:bg-surface-raised/40">
                  <RunListRow
                    entry={entry}
                    viewScope={searchScope}
                    expanded={expanded}
                    onToggle={() => setExpandedId(expanded ? null : entry.id)}
                  />
                  {expanded && runDetailAllowsExpand(searchScope) && (
                    <RunDetail entry={entry} viewScope={searchScope} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
