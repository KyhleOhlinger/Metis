import { invoke } from "@tauri-apps/api/core";
import type { ContextStrategy } from "../services/contextBuilder";
import type { LlmCompletionMeta } from "../services/llmService";
import type {
  AgentRunLogEntry,
  AgentRunStatus,
  AgentRunToolCall,
  AgentRunTranscript,
  AgentRunTranscriptToolCall,
  AgentType,
} from "../types/agentRunLog";
import type { AiProviderProfile, ExecutionScope, Persona } from "../types/persona";
import { estimateRunCostUsd } from "../utils/modelPricing";
import { usePersonaStore } from "../store/usePersonaStore";
import { toastError } from "../store/useToastStore";
import { formatError } from "../utils/formatError";

const RESPONSE_PREVIEW_MAX = 400;
const INDEX_USER_MAX = 500;
const INDEX_ERROR_MAX = 300;

/** Per-field caps so a sidecar stays under the Rust 8 MB transcript limit. */
const TRANSCRIPT_USER_MAX = 500_000;
const TRANSCRIPT_RESPONSE_MAX = 500_000;
const TRANSCRIPT_CONTEXT_MAX = 2_000_000;
const TRANSCRIPT_SYSTEM_MAX = 50_000;
const TRANSCRIPT_ERROR_MAX = 50_000;

export function formatScopeLabel(scope: ExecutionScope): string {
  switch (scope.type) {
    case "current-file":
      return "Current file";
    case "specific-file":
      return scope.filePath.split("/").pop() ?? scope.filePath;
    case "specific-folder":
      return scope.folderPath.split("/").pop() ?? scope.folderPath;
    case "full-vault":
      return "Full vault";
  }
}

function trimPreview(text: string, max = RESPONSE_PREVIEW_MAX): string {
  const t = text.trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function capField(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[… truncated for transcript size]`;
}

export type RecordAgentRunInput = {
  startedAt: number;
  status: AgentRunStatus;
  persona: Persona;
  profile: AiProviderProfile;
  agentType: AgentType;
  scope: ExecutionScope;
  activeFilePath: string | null;
  vaultPath: string | null;
  userMessage: string;
  response?: string;
  errorMessage?: string;
  context?: string | null;
  systemPrompt?: string | null;
  attachedImages?: string[];
  contextStrategy?: ContextStrategy | null;
  toolCalls?: AgentRunToolCall[];
  transcriptToolCalls?: AgentRunTranscriptToolCall[];
  meta?: LlmCompletionMeta;
};

export function buildAgentRunLogEntry(input: RecordAgentRunInput): AgentRunLogEntry {
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - input.startedAt);
  const usage = input.meta?.usage;
  const responseText = input.response ?? "";

  return {
    id: `run-${input.startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: input.startedAt,
    endedAt,
    durationMs: input.meta?.durationMs ?? durationMs,
    status: input.status,

    personaId: input.persona.id,
    personaName: input.persona.name,
    agentType: input.agentType,
    model: input.persona.model,
    providerProfileId: input.profile.id,
    providerLabel: input.profile.name,

    scope: input.scope,
    scopeLabel: formatScopeLabel(input.scope),
    activeFilePath: input.activeFilePath,
    vaultPath: input.vaultPath,

    userMessage: trimPreview(input.userMessage, INDEX_USER_MAX),
    responsePreview: trimPreview(responseText),
    errorMessage: input.errorMessage ? trimPreview(input.errorMessage, INDEX_ERROR_MAX) : undefined,

    contextStrategy: input.contextStrategy ?? undefined,
    toolCalls: input.toolCalls?.length ? input.toolCalls : undefined,

    usage,
    estimatedCostUsd: estimateRunCostUsd(input.persona.model, usage),
    hasTranscript: true,
  };
}

function buildTranscript(id: string, input: RecordAgentRunInput): AgentRunTranscript {
  const context = input.context?.trim() ?? "";
  const systemPrompt = input.systemPrompt?.trim() ?? "";
  return {
    id,
    userMessage: capField(input.userMessage, TRANSCRIPT_USER_MAX),
    response: capField(input.response ?? "", TRANSCRIPT_RESPONSE_MAX),
    errorMessage: input.errorMessage
      ? capField(input.errorMessage, TRANSCRIPT_ERROR_MAX)
      : undefined,
    context: context ? capField(context, TRANSCRIPT_CONTEXT_MAX) : undefined,
    systemPrompt: systemPrompt ? capField(systemPrompt, TRANSCRIPT_SYSTEM_MAX) : undefined,
    attachedImages: input.attachedImages?.length ? input.attachedImages : undefined,
    toolCalls: input.transcriptToolCalls?.length ? input.transcriptToolCalls : undefined,
  };
}

export function formatTranscriptRequest(t: AgentRunTranscript): string {
  const parts: string[] = [];
  if (t.systemPrompt?.trim()) {
    parts.push(`## System prompt\n\n${t.systemPrompt.trim()}`);
  }
  if (t.context?.trim()) {
    parts.push(`## Context\n\n${t.context.trim()}`);
  }
  if (t.attachedImages?.length) {
    parts.push(`## Attached images\n\n${t.attachedImages.map((n) => `- ${n}`).join("\n")}`);
  }
  parts.push(`## User message\n\n${t.userMessage.trim() || "—"}`);
  return parts.join("\n\n");
}

export function formatTranscriptResponse(t: AgentRunTranscript): string {
  const parts: string[] = [];
  if (t.response.trim()) {
    parts.push(`## Response\n\n${t.response.trim()}`);
  }
  if (t.errorMessage?.trim()) {
    parts.push(`## Error\n\n${t.errorMessage.trim()}`);
  }
  if (t.toolCalls?.length) {
    const calls = t.toolCalls
      .map((tc) => {
        let args = "";
        try {
          args = JSON.stringify(tc.args, null, 2);
        } catch {
          args = "[unserializable args]";
        }
        return `### ${tc.name}\n\n\`\`\`json\n${args}\n\`\`\``;
      })
      .join("\n\n");
    parts.push(`## Tool calls\n\n${calls}`);
  }
  return parts.join("\n\n").trim() || "—";
}

export async function recordAgentRun(input: RecordAgentRunInput): Promise<AgentRunLogEntry | null> {
  const { settings } = usePersonaStore.getState();
  if (settings.storeAiHistory === false) return null;

  const entry = buildAgentRunLogEntry(input);
  const transcript = buildTranscript(entry.id, input);
  try {
    await invoke("append_agent_run_log", {
      entryJson: JSON.stringify(entry),
      transcriptJson: JSON.stringify(transcript),
    });
    usePersonaStore.getState().prependAgentRunLog(entry);
    return entry;
  } catch (e) {
    console.error("[Metis] Failed to persist agent run log:", e);
    toastError(`Could not save run log to disk: ${formatError(e)}`);
    usePersonaStore.getState().prependAgentRunLog({ ...entry, hasTranscript: false });
    return entry;
  }
}

export async function loadAgentRunLogFromDisk(): Promise<AgentRunLogEntry[]> {
  try {
    const raw = await invoke<string>("load_agent_run_log");
    const parsed = JSON.parse(raw) as AgentRunLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("[Metis] Could not load agent run log:", e);
    return [];
  }
}

export async function loadAgentRunTranscript(
  runId: string,
): Promise<AgentRunTranscript | null> {
  const raw = await invoke<string>("load_agent_run_transcript", { runId });
  const parsed = JSON.parse(raw) as AgentRunTranscript;
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

export async function clearAgentRunLogOnDisk(): Promise<void> {
  await invoke("clear_agent_run_log");
  usePersonaStore.getState().setAgentRunLog([]);
}

export function mapParsedToolCalls(
  toolCalls: { name: string; args: Record<string, unknown> }[],
  activeFilePath: string | null,
): AgentRunToolCall[] {
  return toolCalls.map((tc) => {
    let path: string | undefined;
    if (
      tc.name === "write_to_current_file" ||
      tc.name === "append_to_current_file" ||
      tc.name === "prepend_to_current_file" ||
      tc.name === "insert_at_cursor"
    ) {
      path = activeFilePath ?? undefined;
    } else if (tc.name === "create_new_note") {
      path = String(tc.args.relative_path ?? "");
    }
    return { name: tc.name, path };
  });
}

export function toTranscriptToolCalls(
  toolCalls: { name: string; args: Record<string, unknown> }[],
): AgentRunTranscriptToolCall[] {
  return toolCalls.map((tc) => ({ name: tc.name, args: tc.args }));
}
