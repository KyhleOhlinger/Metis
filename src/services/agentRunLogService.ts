import { invoke } from "@tauri-apps/api/core";
import type { ContextStrategy } from "../services/contextBuilder";
import type { LlmCompletionMeta } from "../services/llmService";
import type {
  AgentRunLogEntry,
  AgentRunStatus,
  AgentRunToolCall,
  AgentType,
} from "../types/agentRunLog";
import type { AiProviderProfile, ExecutionScope, Persona } from "../types/persona";
import { estimateRunCostUsd } from "../utils/modelPricing";
import { usePersonaStore } from "../store/usePersonaStore";
import { toastError } from "../store/useToastStore";
import { formatError } from "../utils/formatError";

const RESPONSE_PREVIEW_MAX = 400;

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
  contextStrategy?: ContextStrategy | null;
  toolCalls?: AgentRunToolCall[];
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

    userMessage: trimPreview(input.userMessage, 500),
    responsePreview: trimPreview(responseText),
    errorMessage: input.errorMessage ? trimPreview(input.errorMessage, 300) : undefined,

    contextStrategy: input.contextStrategy ?? undefined,
    toolCalls: input.toolCalls?.length ? input.toolCalls : undefined,

    usage,
    estimatedCostUsd: estimateRunCostUsd(input.persona.model, usage),
  };
}

export async function recordAgentRun(input: RecordAgentRunInput): Promise<AgentRunLogEntry | null> {
  const { settings } = usePersonaStore.getState();
  if (settings.storeAiHistory === false) return null;

  const entry = buildAgentRunLogEntry(input);
  try {
    await invoke("append_agent_run_log", { entryJson: JSON.stringify(entry) });
    usePersonaStore.getState().prependAgentRunLog(entry);
    return entry;
  } catch (e) {
    console.error("[Metis] Failed to persist agent run log:", e);
    toastError(`Could not save run log to disk: ${formatError(e)}`);
    usePersonaStore.getState().prependAgentRunLog(entry);
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
