/**
 * llmService.ts — Centralised LLM gateway (Vercel AI SDK).
 *
 * All provider I/O goes through official @ai-sdk/* packages or
 * openai-compatible URLs — no native provider REST in Metis.
 *
 * Agent chat is text-only unless `streamResponse` is given vault images
 * (referenced embeds in scoped notes). Handwriting OCR uses
 * `generateVisionCompletion` separately.
 *
 * SECURITY: Only task-scoped content is sent to the cloud. API keys live in
 * app-data settings. Requests target URLs from user-configured profiles only.
 */

import {
  APICallError,
  generateText,
  NoOutputGeneratedError,
  streamText,
  tool,
  type ToolSet,
} from "ai";
import { z } from "zod";
import type { AiProviderProfile, Persona } from "../types/persona";
import { hostFromBaseUrl, providerKindForProfile } from "../utils/providerProfiles";
import { resolveLanguageModel } from "./providerRegistry";
import { isTauriWebview, metisFetchForProfile, resolveProviderBaseUrl } from "./metisFetch";

// ── Agent file-writing tools ──────────────────────────────────────────────────

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export const agentFileTools = {
  write_to_current_file: tool({
    description:
      "Completely replace the currently open note with new content. " +
      "Use when the user asks to rewrite or fully replace the note. " +
      "Your content must include everything that should remain in the file.",
    inputSchema: z.object({
      content: z.string().describe("The complete new markdown content for the file."),
    }),
  }),
  append_to_current_file: tool({
    description:
      "Add new content at the END of the currently open note. " +
      "Provide ONLY the new section — do NOT repeat the existing content.",
    inputSchema: z.object({
      content: z.string().describe("Markdown to append."),
    }),
  }),
  prepend_to_current_file: tool({
    description:
      "Add new content at the START of the open note (after frontmatter). " +
      "Provide ONLY the new section.",
    inputSchema: z.object({
      content: z.string().describe("Markdown to prepend."),
    }),
  }),
  insert_at_cursor: tool({
    description: "Insert content at the user's cursor in the active note.",
    inputSchema: z.object({
      content: z.string().describe("Markdown to insert."),
    }),
  }),
  create_new_note: tool({
    description: "Create a new markdown note in the vault.",
    inputSchema: z.object({
      relative_path: z.string().describe("Vault-relative path ending in .md"),
      content: z.string().describe("Full note content."),
    }),
  }),
} satisfies ToolSet;

function mapStaticToolCalls(
  calls: { toolCallId: string; toolName: string; input: unknown }[],
): ParsedToolCall[] {
  return calls.map((tc) => ({
    id: tc.toolCallId,
    name: tc.toolName,
    args: (typeof tc.input === "object" && tc.input !== null
      ? tc.input
      : {}) as Record<string, unknown>,
  }));
}

export interface LlmRunUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmCompletionMeta {
  durationMs: number;
  usage?: LlmRunUsage;
}

function mapSdkUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | undefined): LlmRunUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
  if (totalTokens <= 0) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

export interface AgentVisionImagePart {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (fullText: string, toolCalls: ParsedToolCall[], meta: LlmCompletionMeta) => void;
  onError: (error: Error) => void;
}

function createStreamErrorCapture() {
  let streamError: unknown;
  return {
    onError: ({ error }: { error: unknown }) => {
      streamError = error;
    },
    getStreamError: () => streamError,
  };
}

function buildUserPayload(
  context: string,
  userMessage: string,
  images: AgentVisionImagePart[],
): string {
  const contextBlock = context.trim()
    ? `<context>\n${context.trim()}\n</context>\n\n`
    : "";
  const imageBlock =
    images.length > 0
      ? `<attached-images>\n${images
          .map((img, i) => `${i + 1}. ${img.fileName} (${img.mimeType})`)
          .join("\n")}\n</attached-images>\n\nThe images listed above are attached as visual input in the same order. Use them when the notes reference those files.\n\n`
      : "";
  return `${contextBlock}${imageBlock}${userMessage}`;
}

export function streamResponse(
  persona: Persona,
  context: string,
  userMessage: string,
  profile: AiProviderProfile,
  callbacks: StreamCallbacks,
  tools: ToolSet | undefined = agentFileTools,
  images: AgentVisionImagePart[] = [],
): AbortController {
  const controller = new AbortController();

  const userPayload = buildUserPayload(context, userMessage, images);

  void (async () => {
    const startedAt = Date.now();
    const { onError: onStreamError, getStreamError } = createStreamErrorCapture();
    try {
      const imageParts = images.map((img) => ({
        type: "image" as const,
        image: `data:${img.mimeType};base64,${img.dataBase64}`,
        mediaType: img.mimeType,
      }));
      const result = streamText({
        model: resolveLanguageModel(profile, persona.model),
        system: persona.systemPrompt,
        ...(imageParts.length > 0
          ? {
              messages: [
                {
                  role: "user" as const,
                  content: [
                    { type: "text" as const, text: userPayload },
                    ...imageParts,
                  ],
                },
              ],
            }
          : { prompt: userPayload }),
        tools: tools && Object.keys(tools).length > 0 ? tools : undefined,
        toolChoice: tools ? "auto" : undefined,
        abortSignal: controller.signal,
        onError: onStreamError,
      });

      for await (const chunk of result.textStream) {
        if (controller.signal.aborted) break;
        if (chunk) callbacks.onChunk(chunk);
      }

      if (!controller.signal.aborted) {
        const fullText = await result.text;
        const staticCalls = await result.staticToolCalls;
        const usage = mapSdkUsage(await result.usage);
        callbacks.onDone(fullText, mapStaticToolCalls(staticCalls), {
          durationMs: Date.now() - startedAt,
          usage,
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        callbacks.onError(
          new Error(describeLlmError(err, getStreamError())),
        );
      }
    }
  })();

  return controller;
}

/** Non-streaming completion (scout tier, simple calls). */
export async function generateCompletion(
  profile: AiProviderProfile,
  modelId: string,
  system: string,
  prompt: string,
  maxOutputTokens = 256,
  abortSignal?: AbortSignal,
): Promise<{ text: string; meta: LlmCompletionMeta }> {
  const startedAt = Date.now();
  const result = await generateText({
    model: resolveLanguageModel(profile, modelId),
    system,
    prompt,
    maxOutputTokens,
    abortSignal,
  });
  return {
    text: result.text,
    meta: {
      durationMs: Date.now() - startedAt,
      usage: mapSdkUsage(result.usage),
    },
  };
}

/** Vision transcription for handwriting OCR. */
export async function generateVisionCompletion(
  persona: Persona,
  profile: AiProviderProfile,
  userText: string,
  imageBase64: string,
  mimeType: string,
): Promise<{ text: string; meta: LlmCompletionMeta }> {
  const startedAt = Date.now();
  const result = await generateText({
    model: resolveLanguageModel(profile, persona.model),
    system: persona.systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image", image: `data:${mimeType};base64,${imageBase64}` },
        ],
      },
    ],
    maxOutputTokens: 8192,
  });
  return {
    text: result.text.trim(),
    meta: {
      durationMs: Date.now() - startedAt,
      usage: mapSdkUsage(result.usage),
    },
  };
}

// ── Errors ────────────────────────────────────────────────────────────────────

export function scrubSecretsFromMessage(raw: string): string {
  return scrubKey(raw);
}

function scrubKey(raw: string): string {
  return raw
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/gsk_[A-Za-z0-9]{16,}/g, "gsk_***")
    .replace(/AIzaSy[A-Za-z0-9_-]{20,}/g, "AIzaSy***")
    .replace(/pplx-[A-Za-z0-9]{16,}/g, "pplx-***")
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-***");
}

export function describeLlmError(err: unknown, streamError?: unknown): string {
  if (NoOutputGeneratedError.isInstance(err) && streamError) {
    const underlying = describeLlmError(streamError);
    if (underlying !== scrubKey(String(streamError))) {
      return underlying;
    }
  }
  if (NoOutputGeneratedError.isInstance(err) && err.cause instanceof Error) {
    const fromCause = describeLlmError(err.cause);
    if (fromCause !== scrubKey(err.cause.message)) {
      return fromCause;
    }
  }

  if (APICallError.isInstance(err)) {
    const status = err.statusCode;
    if (status === 401) {
      return "Invalid API key — double-check the key is correct and hasn't been revoked.";
    }
    if (status === 400) {
      const hint = scrubKey(err.message).trim();
      return hint.length > 0
        ? `Bad request (400): ${hint}`
        : "Bad request (400) — check the model name and Base URL path (usually /v1 for OpenAI-compatible APIs).";
    }
    if (status === 403) return "Access denied (403) — your key may lack permission for this endpoint.";
    if (status === 404) {
      return "Endpoint not found (404) — the Base URL may be wrong (e.g. missing /v1).";
    }
    if (status === 429) {
      const rawDetail = scrubKey(err.message).trim();
      return rawDetail
        ? `Rate limit or quota (429): ${rawDetail}`
        : "Rate limit (429) — the provider is throttling requests.";
    }
    if (status === 500) return "Provider internal server error (500).";
    if (status === 503) return "Service unavailable (503).";
    if (status) return `HTTP ${status}: ${scrubKey(err.message)}`;
    return classifyNetworkError(err.message);
  }

  return classifyNetworkError(err instanceof Error ? err.message : String(err));
}

function classifyNetworkError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network request failed")
  ) {
    return isTauriWebview()
      ? "Network error — check the Base URL hostname and that the provider is reachable."
      : "Network error — use `tauri dev` for custom provider URLs, or check the Base URL.";
  }
  if (lower.includes("connection refused") || lower.includes("econnrefused")) {
    return "Connection refused — is the server running? Check the Base URL.";
  }
  if (lower.includes("cors") || lower.includes("access-control-allow-origin")) {
    return "CORS error — run via `tauri dev` / the desktop app, not browser-only Vite, for custom URLs.";
  }
  if (lower.includes("does not match provider")) return raw;
  return scrubKey(raw);
}

// ── Model listing ─────────────────────────────────────────────────────────────

export interface CuratedModel {
  id: string;
  tier: "small" | "medium" | "large" | "reasoning";
}

const GENERIC_CURATED: CuratedModel[] = [
  { id: "gpt-4o-mini", tier: "small" },
  { id: "gpt-4o", tier: "medium" },
  { id: "claude-sonnet-4-20250514", tier: "large" },
  { id: "llama-3.3-70b-versatile", tier: "large" },
];

const PRESET_CURATED: Record<string, CuratedModel[]> = {
  "preset-openai": [
    { id: "gpt-4o-mini", tier: "small" },
    { id: "gpt-4o", tier: "medium" },
    { id: "gpt-4.5", tier: "large" },
    { id: "o3-mini", tier: "reasoning" },
  ],
  "preset-gemini": [
    { id: "gemini-flash-latest", tier: "small" },
    { id: "gemini-2.0-flash", tier: "small" },
    { id: "gemini-2.5-pro", tier: "medium" },
    { id: "gemini-3-pro-preview", tier: "large" },
  ],
  "preset-groq": [
    { id: "llama-3.1-8b-instant", tier: "small" },
    { id: "llama-3.3-70b-versatile", tier: "medium" },
    { id: "mixtral-8x7b-32768", tier: "medium" },
  ],
  "preset-perplexity": [
    { id: "sonar", tier: "small" },
    { id: "sonar-pro", tier: "large" },
    { id: "sonar-reasoning-pro", tier: "reasoning" },
  ],
  "preset-anthropic": [
    { id: "claude-sonnet-4-20250514", tier: "medium" },
    { id: "claude-3-5-haiku-latest", tier: "small" },
    { id: "claude-opus-4-20250514", tier: "large" },
  ],
};

export function curatedModelsForProfile(profileId: string): CuratedModel[] {
  return PRESET_CURATED[profileId] ?? GENERIC_CURATED;
}

export function curatedSmallModelId(profile: AiProviderProfile): string {
  const list = curatedModelsForProfile(profile.id);
  const small = list.find((m) => m.tier === "small");
  return small?.id ?? profile.defaultModel?.trim() ?? list[0]?.id ?? "gpt-4o-mini";
}

const NON_CHAT_RE =
  /^(whisper-|dall-e-|tts-|text-embedding|text-moderation|omni-moderation|babbage-|davinci-|text-search-|text-similarity-|code-search-|curie-|ada-)/i;

function filterChatModels(ids: string[]): string[] {
  return ids.filter((id) => !NON_CHAT_RE.test(id));
}

async function listGoogleModels(profile: AiProviderProfile): Promise<string[]> {
  const base = resolveProviderBaseUrl(profile).replace(/\/+$/, "");
  const fetch = metisFetchForProfile(profile);
  const res = await fetch(`${base}/models`, {
    headers: { "x-goog-api-key": profile.apiKey },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    models?: { name?: string }[];
  };
  const ids = (body.models ?? [])
    .map((m) => m.name?.replace(/^models\//, "") ?? "")
    .filter(Boolean);
  return filterChatModels(ids).sort();
}

async function listOpenAiCompatModels(profile: AiProviderProfile): Promise<string[]> {
  const base = resolveProviderBaseUrl(profile).replace(/\/+$/, "");
  const fetch = metisFetchForProfile(profile);
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${profile.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: { id?: string }[] };
  return filterChatModels((body.data ?? []).map((m) => m.id ?? "").filter(Boolean)).sort();
}

async function listAnthropicModels(profile: AiProviderProfile): Promise<string[]> {
  const base = resolveProviderBaseUrl(profile).replace(/\/+$/, "");
  const fetch = metisFetchForProfile(profile);
  const res = await fetch(`${base}/models`, {
    headers: {
      "x-api-key": profile.apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: { id?: string }[] };
  return filterChatModels((body.data ?? []).map((m) => m.id ?? "").filter(Boolean)).sort();
}

async function listProviderModels(profile: AiProviderProfile): Promise<string[]> {
  const kind = providerKindForProfile(profile);
  if (kind === "google") return listGoogleModels(profile);
  if (kind === "anthropic") return listAnthropicModels(profile);
  return listOpenAiCompatModels(profile);
}

export async function fetchProviderModels(
  profile: AiProviderProfile,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  if (!profile.apiKey?.trim()) {
    return { ok: false, error: "No API key configured for this provider." };
  }

  try {
    const models = await listProviderModels(profile);
    return { ok: true, models };
  } catch (err) {
    if (APICallError.isInstance(err) && err.statusCode === 404) {
      const curated = curatedModelsForProfile(profile.id).map((m) => m.id).sort();
      return { ok: true, models: curated };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404")) {
      const curated = curatedModelsForProfile(profile.id).map((m) => m.id).sort();
      return { ok: true, models: curated };
    }
    return { ok: false, error: describeLlmError(err) };
  }
}

export async function testProviderConnection(
  profile: AiProviderProfile,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  if (!profile.apiKey?.trim()) {
    return { ok: false, error: "No API key configured." };
  }
  if (!profile.baseUrl?.trim()) {
    return { ok: false, error: "Base URL is required." };
  }
  if (!hostFromBaseUrl(profile.baseUrl)) {
    return { ok: false, error: "Base URL is not a valid URL." };
  }

  const result = await fetchProviderModels(profile);
  if (result.ok) {
    const n = result.models.length;
    return {
      ok: true,
      detail: n > 0 ? `Connected · ${n} model${n !== 1 ? "s" : ""} available` : "Connected",
    };
  }
  return { ok: false, error: result.error };
}

export { resolveProviderBaseUrl } from "./metisFetch";
