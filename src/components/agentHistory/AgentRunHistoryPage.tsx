import { useMemo, useState } from "react";
import { usePersonaStore } from "../../store/usePersonaStore";
import { clearAgentRunLogOnDisk } from "../../services/agentRunLogService";
import { strategyLabel } from "../../services/contextBuilder";
import {
  AGENT_TYPE_LABELS,
  type AgentRunLogEntry,
  type AgentRunStatus,
  type AgentType,
} from "../../types/agentRunLog";
import { formatCostUsd, formatDurationMs } from "../../utils/modelPricing";

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

function formatTokens(entry: AgentRunLogEntry): string {
  if (!entry.usage) return "—";
  const { promptTokens, completionTokens, totalTokens } = entry.usage;
  return `${totalTokens.toLocaleString()} (↑${promptTokens.toLocaleString()} ↓${completionTokens.toLocaleString()})`;
}

function RunDetail({ entry }: { entry: AgentRunLogEntry }) {
  return (
    <div className="space-y-2 border-t border-border/60 px-4 py-3 text-[11px] text-text-muted">
      <div>
        <span className="font-semibold text-text-secondary">Prompt</span>
        <p className="mt-0.5 whitespace-pre-wrap break-words">{entry.userMessage || "—"}</p>
      </div>
      {entry.responsePreview && (
        <div>
          <span className="font-semibold text-text-secondary">Response preview</span>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{entry.responsePreview}</p>
        </div>
      )}
      {entry.errorMessage && (
        <div>
          <span className="font-semibold text-red-400">Error</span>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-red-300/90">{entry.errorMessage}</p>
        </div>
      )}
      {entry.contextStrategy && (
        <p>
          <span className="font-semibold text-text-secondary">Context: </span>
          {strategyLabel(entry.contextStrategy)}
        </p>
      )}
      {entry.toolCalls && entry.toolCalls.length > 0 && (
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
      <p>
        <span className="font-semibold text-text-secondary">Provider: </span>
        {entry.providerLabel} · {entry.model}
      </p>
      {entry.activeFilePath && (
        <p>
          <span className="font-semibold text-text-secondary">File: </span>
          {entry.activeFilePath.split("/").pop()}
        </p>
      )}
    </div>
  );
}

export default function AgentRunHistoryPage() {
  const agentRunLog = usePersonaStore((s) => s.agentRunLog);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AgentRunStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<AgentType | "all">("all");
  const [clearing, setClearing] = useState(false);

  const filtered = useMemo(() => {
    return agentRunLog.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (typeFilter !== "all" && e.agentType !== typeFilter) return false;
      return true;
    });
  }, [agentRunLog, statusFilter, typeFilter]);

  const totals = useMemo(() => {
    let cost = 0;
    let tokens = 0;
    let duration = 0;
    for (const e of filtered) {
      duration += e.durationMs;
      if (e.estimatedCostUsd) cost += e.estimatedCostUsd;
      if (e.usage) tokens += e.usage.totalTokens;
    }
    return { cost, tokens, duration, count: filtered.length };
  }, [filtered]);

  const handleClear = async () => {
    if (!window.confirm("Clear all agent run history? This cannot be undone.")) return;
    setClearing(true);
    try {
      await clearAgentRunLogOnDisk();
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base text-text-primary">
      <div className="shrink-0 border-b border-border bg-surface-raised/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold text-text-primary">Agent Run Log</h1>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {totals.count} run{totals.count !== 1 ? "s" : ""} ·{" "}
              {formatDurationMs(totals.duration)} total ·{" "}
              {totals.tokens > 0 ? `${totals.tokens.toLocaleString()} tokens · ` : ""}
              est. {formatCostUsd(totals.cost > 0 ? totals.cost : undefined)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={clearing || agentRunLog.length === 0}
            className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-muted transition-colors hover:border-red-500/40 hover:text-red-400 disabled:opacity-40"
          >
            Clear log
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AgentRunStatus | "all")}
            className="rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary"
          >
            <option value="all">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="aborted">Aborted</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as AgentType | "all")}
            className="rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary"
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-sm text-text-muted">No agent runs recorded yet.</p>
            <p className="mt-1 max-w-sm text-[11px] text-text-muted/70">
              Runs from the Command Center AI tab appear here with runtime, token usage, and estimated cost.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filtered.map((entry) => {
              const expanded = expandedId === entry.id;
              return (
                <div key={entry.id} className="bg-surface-base hover:bg-surface-raised/40">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left"
                  >
                    <span className="mt-0.5 w-4 shrink-0 text-[10px] text-text-muted">
                      {expanded ? "▾" : "▸"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-medium text-text-primary">
                          {entry.personaName}
                        </span>
                        <span className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted bg-surface-overlay">
                          {AGENT_TYPE_LABELS[entry.agentType]}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${statusBadge(entry.status)}`}
                        >
                          {entry.status}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-text-secondary">
                        {entry.userMessage || "—"}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
                        <span>{new Date(entry.startedAt).toLocaleString()}</span>
                        <span>{formatDurationMs(entry.durationMs)}</span>
                        <span>{entry.scopeLabel}</span>
                        <span>{entry.model}</span>
                        <span>{formatTokens(entry)}</span>
                        <span>{formatCostUsd(entry.estimatedCostUsd)}</span>
                      </div>
                    </div>
                  </button>
                  {expanded && <RunDetail entry={entry} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
