import type { ContextStrategy } from "../services/contextBuilder";
import type { ExecutionScope } from "./persona";

export type AgentRunStatus = "success" | "error" | "aborted";

export type AgentType =
  | "generic"
  | "librarian"
  | "task-scan"
  | "task-sync"
  | "handwriting-ocr"
  | "quick-action"
  | "scout";

export interface AgentRunUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentRunToolCall {
  name: string;
  path?: string;
}

/** Full request/response body stored beside the index in `agent-run-transcripts/`. */
export interface AgentRunTranscriptToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface AgentRunTranscript {
  id: string;
  userMessage: string;
  response: string;
  errorMessage?: string;
  /** Retrieved vault context sent with the request (no image bytes). */
  context?: string;
  /** Persona system prompt snapshot at run time. */
  systemPrompt?: string;
  /** Image filenames attached as vision input (not the pixels). */
  attachedImages?: string[];
  toolCalls?: AgentRunTranscriptToolCall[];
}

export interface AgentRunLogEntry {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  status: AgentRunStatus;

  personaId: string;
  personaName: string;
  agentType: AgentType;
  model: string;
  providerProfileId: string;
  providerLabel: string;

  scope: ExecutionScope;
  scopeLabel: string;
  activeFilePath: string | null;
  vaultPath: string | null;

  userMessage: string;
  responsePreview: string;
  errorMessage?: string;

  contextStrategy?: ContextStrategy;
  toolCalls?: AgentRunToolCall[];

  usage?: AgentRunUsage;
  estimatedCostUsd?: number;
  /** True when a sidecar transcript exists under app data. */
  hasTranscript?: boolean;
}

export interface AgentRunLogEntry {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  status: AgentRunStatus;

  personaId: string;
  personaName: string;
  agentType: AgentType;
  model: string;
  providerProfileId: string;
  providerLabel: string;

  scope: ExecutionScope;
  scopeLabel: string;
  activeFilePath: string | null;
  vaultPath: string | null;

  userMessage: string;
  responsePreview: string;
  errorMessage?: string;

  contextStrategy?: ContextStrategy;
  toolCalls?: AgentRunToolCall[];

  usage?: AgentRunUsage;
  estimatedCostUsd?: number;
}

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  generic: "Agent",
  librarian: "Librarian",
  "task-scan": "Task scan",
  "task-sync": "Task sync",
  "handwriting-ocr": "Handwriting OCR",
  "quick-action": "Quick action",
  scout: "Scout",
};
