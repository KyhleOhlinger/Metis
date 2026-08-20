import {
  AGENT_TYPE_LABELS,
  type AgentRunLogEntry,
  type AgentRunStatus,
  type AgentType,
} from "../types/agentRunLog";

export type AgentRunSearchScope = "title" | "user" | "ai" | "all";

export interface AgentRunDateRange {
  /** Local calendar date `YYYY-MM-DD`, or empty for no bound. */
  from: string;
  to: string;
}

export interface AgentRunFilterOptions {
  status: AgentRunStatus | "all";
  type: AgentType | "all";
  search: string;
  searchScope: AgentRunSearchScope;
  dateRange: AgentRunDateRange;
}

export interface AgentRunTotals {
  count: number;
  messageCount: number;
  tokens: number;
  durationMs: number;
  cost: number;
  earliestAt?: number;
  latestAt?: number;
}

export const SEARCH_SCOPE_LABELS: Record<AgentRunSearchScope, string> = {
  title: "Title only",
  user: "My messages",
  ai: "AI responses",
  all: "All content",
};

/** Primary body text shown in the list for the active view scope. */
export function runEntryBodyPreview(entry: AgentRunLogEntry, scope: AgentRunSearchScope): string {
  switch (scope) {
    case "title":
      return "";
    case "user":
      return entry.userMessage.trim();
    case "ai":
      return (entry.responsePreview || entry.errorMessage || "").trim();
    case "all":
      return entry.userMessage.trim();
  }
}

export function runDetailAllowsExpand(scope: AgentRunSearchScope): boolean {
  return scope !== "title";
}

export function runRowShowsMetadata(scope: AgentRunSearchScope): boolean {
  return scope === "all";
}

export function vaultRelativeFilePath(entry: AgentRunLogEntry): string | null {
  if (!entry.activeFilePath) return null;
  const vault = entry.vaultPath?.replace(/\/+$/, "");
  if (vault && entry.activeFilePath.startsWith(vault)) {
    const rel = entry.activeFilePath.slice(vault.length).replace(/^\/+/, "");
    if (rel) return rel;
  }
  return entry.activeFilePath.split("/").pop() ?? entry.activeFilePath;
}

export function runEntryTitle(entry: AgentRunLogEntry): string {
  const file = vaultRelativeFilePath(entry);
  return [entry.personaName, AGENT_TYPE_LABELS[entry.agentType], entry.scopeLabel, file]
    .filter(Boolean)
    .join(" · ");
}

function localDayStart(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function localDayEnd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export function entryInDateRange(entry: AgentRunLogEntry, range: AgentRunDateRange): boolean {
  const { from, to } = range;
  if (!from && !to) return true;
  const t = entry.startedAt;
  if (from && t < localDayStart(from)) return false;
  if (to && t > localDayEnd(to)) return false;
  return true;
}

export function entryMatchesSearch(
  entry: AgentRunLogEntry,
  query: string,
  scope: AgentRunSearchScope,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const fieldsForScope = (): string[] => {
    switch (scope) {
      case "title":
        return [runEntryTitle(entry)];
      case "user":
        return [entry.userMessage];
      case "ai":
        return [entry.responsePreview, entry.errorMessage ?? ""];
      case "all":
        return [
          runEntryTitle(entry),
          entry.userMessage,
          entry.responsePreview,
          entry.errorMessage ?? "",
          entry.model,
          entry.providerLabel,
          entry.scopeLabel,
          ...(entry.toolCalls?.map((tc) => `${tc.name} ${tc.path ?? ""}`) ?? []),
        ];
    }
  };

  return fieldsForScope().some((text) => text.toLowerCase().includes(q));
}

export function filterAgentRunLog(
  entries: AgentRunLogEntry[],
  opts: AgentRunFilterOptions,
): AgentRunLogEntry[] {
  return entries.filter((e) => {
    if (opts.status !== "all" && e.status !== opts.status) return false;
    if (opts.type !== "all" && e.agentType !== opts.type) return false;
    if (!entryInDateRange(e, opts.dateRange)) return false;
    if (!entryMatchesSearch(e, opts.search, opts.searchScope)) return false;
    return true;
  });
}

export function computeAgentRunTotals(entries: AgentRunLogEntry[]): AgentRunTotals {
  let messageCount = 0;
  let tokens = 0;
  let durationMs = 0;
  let cost = 0;
  let earliestAt: number | undefined;
  let latestAt: number | undefined;

  for (const e of entries) {
    durationMs += e.durationMs;
    if (e.userMessage.trim()) messageCount += 1;
    if (e.responsePreview.trim()) messageCount += 1;
    if (e.usage) tokens += e.usage.totalTokens;
    if (e.estimatedCostUsd) cost += e.estimatedCostUsd;
    if (earliestAt === undefined || e.startedAt < earliestAt) earliestAt = e.startedAt;
    if (latestAt === undefined || e.startedAt > latestAt) latestAt = e.startedAt;
  }

  return {
    count: entries.length,
    messageCount,
    tokens,
    durationMs,
    cost,
    earliestAt,
    latestAt,
  };
}

function csvCell(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportAgentRunsCsv(entries: AgentRunLogEntry[]): string {
  const header = [
    "id",
    "startedAt",
    "endedAt",
    "durationMs",
    "status",
    "personaName",
    "agentType",
    "model",
    "providerLabel",
    "scopeLabel",
    "file",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "estimatedCostUsd",
    "userMessage",
    "responsePreview",
    "errorMessage",
  ];

  const rows = entries.map((e) => [
    e.id,
    new Date(e.startedAt).toISOString(),
    new Date(e.endedAt).toISOString(),
    e.durationMs,
    e.status,
    e.personaName,
    AGENT_TYPE_LABELS[e.agentType],
    e.model,
    e.providerLabel,
    e.scopeLabel,
    vaultRelativeFilePath(e) ?? "",
    e.usage?.promptTokens ?? "",
    e.usage?.completionTokens ?? "",
    e.usage?.totalTokens ?? "",
    e.estimatedCostUsd ?? "",
    e.userMessage,
    e.responsePreview,
    e.errorMessage ?? "",
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function exportAgentRunsJson(entries: AgentRunLogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function formatDateRangeLabel(
  range: AgentRunDateRange,
  totals: AgentRunTotals,
): string {
  if (range.from && range.to) {
    return `${formatShortDate(range.from)} – ${formatShortDate(range.to)}`;
  }
  if (range.from) return `Since ${formatShortDate(range.from)}`;
  if (range.to) return `Through ${formatShortDate(range.to)}`;
  if (totals.earliestAt) {
    return `Since ${new Date(totals.earliestAt).toLocaleDateString()}`;
  }
  return "All time";
}

function formatShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString();
}

export function hasActiveRunFilters(opts: AgentRunFilterOptions): boolean {
  return (
    opts.status !== "all" ||
    opts.type !== "all" ||
    opts.search.trim().length > 0 ||
    Boolean(opts.dateRange.from || opts.dateRange.to)
  );
}
