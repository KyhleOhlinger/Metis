import type { AgentRunUsage } from "../types/agentRunLog";

/** USD per 1M tokens — approximate list prices for cost estimates. */
type ModelRates = { inputPer1M: number; outputPer1M: number };

const MODEL_RATES: Record<string, ModelRates> = {
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.5": { inputPer1M: 75, outputPer1M: 150 },
  "o3-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-haiku-latest": { inputPer1M: 0.8, outputPer1M: 4 },
  "claude-opus-4-20250514": { inputPer1M: 15, outputPer1M: 75 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-3-pro-preview": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-flash-latest": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.08 },
  "mixtral-8x7b-32768": { inputPer1M: 0.24, outputPer1M: 0.24 },
  sonar: { inputPer1M: 1, outputPer1M: 1 },
  "sonar-pro": { inputPer1M: 3, outputPer1M: 15 },
  "sonar-reasoning-pro": { inputPer1M: 2, outputPer1M: 8 },
};

const DEFAULT_RATES: ModelRates = { inputPer1M: 1, outputPer1M: 3 };

function ratesForModel(modelId: string): ModelRates {
  const key = modelId.trim().toLowerCase();
  if (MODEL_RATES[key]) return MODEL_RATES[key]!;
  const prefix = Object.keys(MODEL_RATES).find((k) => key.startsWith(k));
  if (prefix) return MODEL_RATES[prefix]!;
  return DEFAULT_RATES;
}

/** Estimate USD cost from token usage and model id. Returns undefined when no usage. */
export function estimateRunCostUsd(modelId: string, usage?: AgentRunUsage): number | undefined {
  if (!usage || usage.totalTokens <= 0) return undefined;
  const rates = ratesForModel(modelId);
  const input = (usage.promptTokens * rates.inputPer1M) / 1_000_000;
  const output = (usage.completionTokens * rates.outputPer1M) / 1_000_000;
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}

export function formatCostUsd(cost?: number): string {
  if (cost === undefined || !Number.isFinite(cost)) return "—";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

/** Token line for run log rows — never a bare dash without context. */
export function formatRunTokenSummary(usage?: AgentRunUsage): string {
  if (!usage || usage.totalTokens <= 0) return "No usage recorded";
  const { promptTokens, completionTokens, totalTokens } = usage;
  return `${totalTokens.toLocaleString()} tok (↑${promptTokens.toLocaleString()} ↓${completionTokens.toLocaleString()})`;
}

/** Cost line for run log rows — pairs with token summary. */
export function formatRunCostSummary(cost?: number, usage?: AgentRunUsage): string {
  if (cost !== undefined && Number.isFinite(cost)) return formatCostUsd(cost);
  if (!usage || usage.totalTokens <= 0) return "No cost (no usage)";
  return "Cost unavailable";
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}
