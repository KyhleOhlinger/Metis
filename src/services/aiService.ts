/**
 * aiService.ts — Centralised gateway for all AI calls.
 *
 * Uses the OpenAI-compatible SDK for most providers. Profiles with adapter
 * `gemini-native` (official Google host) use the native v1beta REST API.
 *
 * SECURITY: Only task-scoped content is sent to the cloud. API keys live in
 * app-data settings. Requests target URLs from user-configured profiles only.
 */

import OpenAI from "openai";
import type { AiProviderProfile, Persona } from "../types/persona";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { hostFromBaseUrl, inferAdapter } from "../utils/providerProfiles";
import {
  describeGeminiNativeError,
  streamGeminiNativeChat,
  listGeminiNativeModels,
  profileUsesGeminiNative,
} from "./geminiNative";

/** True when running inside a Tauri 2 webview (not a standalone browser tab). */
function isTauriWebview(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ ===
      "object"
  );
}

// ── URL normalisation (hostname heuristics for common APIs) ─────────────────

function normalizeBaseUrl(baseUrl: string): string {
  let s = baseUrl.trim().replace(/\/+$/, "");
  if (!s) return s;

  if (s.includes("generativelanguage.googleapis.com") && !s.includes("/openai")) {
    if (/\/v1beta$/.test(s)) s = `${s}/openai`;
    else s = `${s}/openai`;
  }
  if (s.includes("api.groq.com")) {
    if (s.endsWith("/openai/v1")) return s;
    if (s.endsWith("/openai")) return `${s}/v1`;
    if (/api\.groq\.com$/.test(s)) return `${s}/openai/v1`;
  }
  if (s.includes("api.perplexity.ai")) {
    return "https://api.perplexity.ai";
  }
  if (s.includes("api.anthropic.com") && !s.endsWith("/v1")) {
    return `${s}/v1`;
  }

  return s;
}

/**
 * Resolve the base URL for a profile (dev browser proxy only for official preset hosts).
 */
export function resolveProfileBaseUrl(profile: AiProviderProfile): string {
  const normalized = normalizeBaseUrl(profile.baseUrl);
  if (import.meta.env.DEV && !isTauriWebview()) {
    const host = hostFromBaseUrl(normalized);
    if (host === "api.openai.com") return `${window.location.origin}/api-proxy/openai/v1`;
    if (host === "api.groq.com") return `${window.location.origin}/api-proxy/groq/openai/v1`;
    if (host === "generativelanguage.googleapis.com") {
      return `${window.location.origin}/api-proxy/gemini/v1beta/openai`;
    }
    if (host === "api.perplexity.ai") return `${window.location.origin}/api-proxy/perplexity`;
  }
  return normalized;
}

/** Preflight: ensure the resolved URL host matches the profile (blocks stray SDK redirects). */
export function assertProfileHost(profile: AiProviderProfile, requestUrl: string): void {
  const expected = hostFromBaseUrl(profile.baseUrl);
  if (!expected) throw new Error("Invalid provider Base URL — could not parse hostname.");
  try {
    const actual = new URL(requestUrl).hostname.toLowerCase();
    if (actual !== expected) {
      throw new Error(
        `Request host "${actual}" does not match provider URL host "${expected}".`,
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("does not match")) throw e;
    throw new Error("Invalid request URL for provider.");
  }
}

function profileFetch(profile: AiProviderProfile): typeof globalThis.fetch {
  const baseFetch = isTauriWebview()
    ? (tauriFetch as unknown as typeof globalThis.fetch)
    : globalThis.fetch.bind(globalThis);

  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    assertProfileHost(profile, url);
    return baseFetch(input, init);
  };
}

function buildClient(profile: AiProviderProfile): OpenAI {
  return new OpenAI({
    apiKey: profile.apiKey,
    baseURL: resolveProfileBaseUrl(profile),
    dangerouslyAllowBrowser: true,
    fetch: profileFetch(profile),
  });
}

export function createAIClient(profile: AiProviderProfile): OpenAI {
  return buildClient(profile);
}

// ── Agent file-writing tools ──────────────────────────────────────────────────

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

function parsedToolCallsFromMessage(
  toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] | undefined,
): ParsedToolCall[] {
  if (!toolCalls?.length) return [];
  const out: ParsedToolCall[] = [];
  for (const tc of toolCalls) {
    if (tc.type !== "function") continue;
    const fn = tc.function;
    if (!fn?.name) continue;
    try {
      out.push({
        id: tc.id,
        name: fn.name,
        args: JSON.parse(fn.arguments || "{}") as Record<string, unknown>,
      });
    } catch {
      /* skip malformed tool JSON */
    }
  }
  return out;
}

export const AGENT_FILE_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "write_to_current_file",
      description:
        "Completely replace the currently open note with new content. " +
        "Use when the user asks to rewrite or fully replace the note. " +
        "Your content must include everything that should remain in the file.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The complete new markdown content for the file.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_to_current_file",
      description:
        "Add new content at the END of the currently open note. " +
        "Provide ONLY the new section — do NOT repeat the existing content.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Markdown to append." },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prepend_to_current_file",
      description:
        "Add new content at the START of the open note (after frontmatter). " +
        "Provide ONLY the new section.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Markdown to prepend." },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_at_cursor",
      description: "Insert content at the user's cursor in the active note.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Markdown to insert." },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_new_note",
      description: "Create a new markdown note in the vault.",
      parameters: {
        type: "object",
        properties: {
          relative_path: {
            type: "string",
            description: "Vault-relative path ending in .md",
          },
          content: { type: "string", description: "Full note content." },
        },
        required: ["relative_path", "content"],
      },
    },
  },
];

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (fullText: string, toolCalls: ParsedToolCall[]) => void;
  onError: (error: Error) => void;
}

export function streamResponse(
  persona: Persona,
  context: string,
  userMessage: string,
  profile: AiProviderProfile,
  callbacks: StreamCallbacks,
  tools?: OpenAI.Chat.ChatCompletionTool[],
): AbortController {
  const controller = new AbortController();

  const contextBlock = context.trim()
    ? `<context>\n${context.trim()}\n</context>\n\n`
    : "";
  const userPayload = `${contextBlock}${userMessage}`;

  if (profileUsesGeminiNative(profile)) {
    (async () => {
      try {
        const { fullText, toolCalls } = await streamGeminiNativeChat(
          profile,
          persona.model,
          persona.systemPrompt,
          userPayload,
          tools,
          controller.signal,
          (t) => callbacks.onChunk(t),
        );
        if (!controller.signal.aborted) {
          callbacks.onDone(fullText, toolCalls);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          callbacks.onError(new Error(describeGeminiNativeError(err)));
        }
      }
    })();
    return controller;
  }

  const client = buildClient(profile);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: persona.systemPrompt },
    { role: "user", content: userPayload },
  ];

  (async () => {
    const toolAccum: Record<number, { id: string; name: string; args: string }> = {};
    const commonParams = {
      model: persona.model,
      messages,
      ...(tools?.length ? { tools, tool_choice: "auto" as const } : {}),
    };

    function toolCallsFromStreamAccum(): ParsedToolCall[] {
      return Object.entries(toolAccum)
        .sort(([a], [b]) => Number(a) - Number(b))
        .flatMap(([, acc]) => {
          try {
            return [{ id: acc.id, name: acc.name, args: JSON.parse(acc.args || "{}") }];
          } catch {
            return [];
          }
        });
    }

    async function runNonStreamingCompletion(): Promise<void> {
      const completion = await client.chat.completions.create(
        { ...commonParams, stream: false },
        { signal: controller.signal },
      );
      const message = completion.choices[0]?.message;
      let textOut = "";
      const c = message?.content;
      if (typeof c === "string") textOut = c;
      else if (Array.isArray(c)) {
        for (const part of c as OpenAI.Chat.ChatCompletionContentPart[]) {
          if (part.type === "text" && "text" in part) textOut += part.text;
        }
      }
      if (textOut) callbacks.onChunk(textOut);
      if (!controller.signal.aborted) {
        callbacks.onDone(textOut, parsedToolCallsFromMessage(message?.tool_calls));
      }
    }

    async function runStreamingCompletion(): Promise<void> {
      const stream = await client.chat.completions.create(
        { ...commonParams, stream: true },
        { signal: controller.signal },
      );
      let full = "";
      for await (const chunk of stream) {
        if (controller.signal.aborted) break;
        const delta = chunk.choices[0]?.delta;
        const text = delta?.content ?? "";
        if (text) {
          full += text;
          callbacks.onChunk(text);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!(tc.index in toolAccum)) {
              toolAccum[tc.index] = { id: "", name: "", args: "" };
            }
            const acc = toolAccum[tc.index];
            if (tc.id) acc.id += tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }
        }
      }
      if (!controller.signal.aborted) {
        callbacks.onDone(full, toolCallsFromStreamAccum());
      }
    }

    try {
      await runStreamingCompletion();
    } catch (err) {
      if (controller.signal.aborted) return;
      const retryNonStream =
        inferAdapter(profile.baseUrl, profile.adapter) === "gemini-native" &&
        !!tools?.length &&
        err instanceof OpenAI.APIError &&
        err.status === 400;
      if (retryNonStream) {
        try {
          await runNonStreamingCompletion();
        } catch (err2) {
          callbacks.onError(new Error(describeError(err2)));
        }
        return;
      }
      callbacks.onError(new Error(describeError(err)));
    }
  })();

  return controller;
}

/** Redact common API key patterns from user-visible error text. */
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

function describeError(err: unknown): string {
  if (err instanceof OpenAI.APIError && err.status == null) {
    const cause = (err as { cause?: Error }).cause;
    if (cause) {
      return classifyNetworkError(cause instanceof Error ? cause.message : String(cause));
    }
    return "Connection error — check your internet connection and the Base URL.";
  }

  if (err instanceof OpenAI.APIError) {
    const { status } = err;
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

  if (profileUsesGeminiNative(profile)) {
    try {
      const models = await listGeminiNativeModels(profile);
      const n = models.length;
      return {
        ok: true,
        detail: n > 0 ? `Connected · ${n} model${n !== 1 ? "s" : ""} available` : "Connected",
      };
    } catch (err) {
      return { ok: false, error: describeGeminiNativeError(err) };
    }
  }

  try {
    const client = buildClient(profile);
    const list = await client.models.list();
    const count = list.data?.length ?? 0;
    return {
      ok: true,
      detail:
        count > 0
          ? `Connected · ${count} model${count !== 1 ? "s" : ""} available`
          : "Connected",
    };
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 404) {
      return { ok: true, detail: "Connected (no models listing endpoint)" };
    }
    return { ok: false, error: describeError(err) };
  }
}

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
    { id: "gemini-1.5-flash", tier: "small" },
    { id: "gemini-1.5-pro", tier: "medium" },
    { id: "gemini-2.5-pro-preview-05-06", tier: "large" },
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

export async function fetchProviderModels(
  profile: AiProviderProfile,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  if (!profile.apiKey?.trim()) {
    return { ok: false, error: "No API key configured for this provider." };
  }

  if (profileUsesGeminiNative(profile)) {
    try {
      const models = filterChatModels(await listGeminiNativeModels(profile));
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: describeGeminiNativeError(err) };
    }
  }

  try {
    const client = buildClient(profile);
    const list = await client.models.list();
    const models = filterChatModels((list.data ?? []).map((m) => m.id)).sort();
    return { ok: true, models };
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 404) {
      const curated = curatedModelsForProfile(profile.id).map((m) => m.id).sort();
      return { ok: true, models: curated };
    }
    return { ok: false, error: describeError(err) };
  }
}

/** @deprecated Use curatedModelsForProfile */
export const PROVIDER_PREFERRED_MODELS = PRESET_CURATED;

/** @deprecated Use resolveProfileBaseUrl */
export const PROVIDER_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  perplexity: "https://api.perplexity.ai",
} as const;
