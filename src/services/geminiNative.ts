/**
 * Native Gemini REST API (v1beta generateContent / streamGenerateContent).
 *
 * Uses X-goog-api-key like the official curl examples. The OpenAI-compatible
 * path at …/v1beta/openai has been unreliable in Metis (empty-body HTTP 429
 * on chat + tools). This module talks to the same host as a working
 * `models/...:generateContent` curl.
 *
 * SECURITY: Key is only sent in headers to Google; never logged.
 */

import type OpenAI from "openai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AiProviderProfile } from "../types/persona";
import { inferAdapter, isOfficialGeminiApiHost } from "../utils/providerProfiles";

/** Same shape as ParsedToolCall in aiService — kept local to avoid a circular import. */
export interface GeminiNativeToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

function isTauriWebview(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ ===
      "object"
  );
}

function httpFetch(): typeof fetch {
  return isTauriWebview() ? (tauriFetch as unknown as typeof fetch) : fetch.bind(globalThis);
}

/** Use native Gemini REST when the profile adapter or URL targets Google. */
export function profileUsesGeminiNative(profile: AiProviderProfile): boolean {
  return inferAdapter(profile.baseUrl, profile.adapter) === "gemini-native";
}

/** @deprecated */
export function usesGeminiNativeApi(config: { baseUrl?: string }): boolean {
  const raw = (config.baseUrl ?? "").trim();
  if (!raw) return true;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return isOfficialGeminiApiHost(u.hostname);
  } catch {
    return false;
  }
}

/** Browser-only Vite dev: proxy to avoid CORS (same pattern as aiService). */
export function geminiNativeDefaultOrigin(): string {
  if (import.meta.env.DEV && !isTauriWebview()) {
    return `${window.location.origin}/api-proxy/gemini-native`;
  }
  return "https://generativelanguage.googleapis.com";
}

/**
 * REST base origin: user may set baseUrl to the official host (or …/v1beta/openai).
 * Regional hosts stay on the same Google API family.
 */
export function resolveGeminiRestOrigin(config: AiProviderProfile): string {
  const raw = (config.baseUrl ?? "").trim();
  if (raw) {
    try {
      let s = raw.replace(/\/+$/, "");
      if (s.endsWith("/openai")) s = s.slice(0, -"/openai".length);
      const u = new URL(s.includes("://") ? s : `https://${s}`);
      if (isOfficialGeminiApiHost(u.hostname)) {
        return `${u.protocol}//${u.host}`;
      }
    } catch {
      /* fall through */
    }
  }
  return geminiNativeDefaultOrigin();
}

function normalizeModelId(model: string): string {
  const m = model.trim();
  if (m.startsWith("models/")) return m.slice("models/".length);
  return m;
}

function geminiErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const err = (body as { error?: { message?: string; status?: string; code?: number } }).error;
  if (!err) return "";
  return [err.status, err.message].filter(Boolean).join(": ");
}

export class GeminiNativeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "GeminiNativeError";
  }
}

/** Map OpenAI-style tool defs to Gemini functionDeclarations. */
function toGeminiTools(
  tools: OpenAI.Chat.ChatCompletionTool[] | undefined,
): { functionDeclarations: Record<string, unknown>[] }[] | undefined {
  if (!tools?.length) return undefined;
  const decls: Record<string, unknown>[] = [];
  for (const t of tools) {
    if (t.type !== "function") continue;
    const fn = t.function;
    if (!fn?.name) continue;
    decls.push({
      name: fn.name,
      description: fn.description ?? "",
      parameters: fn.parameters ?? { type: "object", properties: {} },
    });
  }
  if (!decls.length) return undefined;
  return [{ functionDeclarations: decls }];
}

type StreamPart = { text: string; functionCalls: { name: string; args: Record<string, unknown> }[] };

function extractStreamPart(obj: unknown): StreamPart {
  const textParts: string[] = [];
  const functionCalls: StreamPart["functionCalls"] = [];
  if (!obj || typeof obj !== "object") return { text: "", functionCalls: [] };

  const root = obj as Record<string, unknown>;
  if (root.error) {
    const msg = geminiErrorMessage(obj) || "Gemini API error";
    throw new GeminiNativeError(msg, 400, obj);
  }

  const candidates = root.candidates as unknown[] | undefined;
  if (!candidates?.length) return { text: "", functionCalls: [] };

  const first = candidates[0] as Record<string, unknown>;
  if (first.finishReason === "SAFETY" || first.finishReason === "BLOCKLIST") {
    throw new GeminiNativeError("Response blocked by safety settings.", 400, obj);
  }

  const content = first.content as Record<string, unknown> | undefined;
  const parts = (content?.parts as unknown[]) ?? [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const part = p as Record<string, unknown>;
    if (typeof part.text === "string") textParts.push(part.text);
    const fc = part.functionCall as Record<string, unknown> | undefined;
    if (fc && typeof fc.name === "string") {
      let args: Record<string, unknown> = {};
      const raw = fc.args;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        args = raw as Record<string, unknown>;
      } else if (typeof fc.args === "string") {
        try {
          args = JSON.parse(fc.args) as Record<string, unknown>;
        } catch {
          args = {};
        }
      }
      functionCalls.push({ name: fc.name, args });
    }
  }
  return { text: textParts.join(""), functionCalls };
}

function buildRequestBody(
  systemPrompt: string,
  userText: string,
  tools: OpenAI.Chat.ChatCompletionTool[] | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 8192,
    },
  };
  const geminiTools = toGeminiTools(tools);
  if (geminiTools) {
    body.tools = geminiTools;
    body.toolConfig = {
      functionCallingConfig: { mode: "AUTO" },
    };
  }
  return body;
}

const GEMINI_KEY_HEADER = "x-goog-api-key";

/**
 * Streaming chat — parses SSE lines from streamGenerateContent.
 */
export async function streamGeminiNativeChat(
  config: AiProviderProfile,
  model: string,
  systemPrompt: string,
  userText: string,
  tools: OpenAI.Chat.ChatCompletionTool[] | undefined,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<{ fullText: string; toolCalls: GeminiNativeToolCall[] }> {
  const id = normalizeModelId(model);
  const base = resolveGeminiRestOrigin(config);
  const apiKey = config.apiKey;
  const url = `${base}/v1beta/models/${encodeURIComponent(id)}:streamGenerateContent?alt=sse`;
  const f = httpFetch();

  const res = await f(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      [GEMINI_KEY_HEADER]: apiKey,
    },
    body: JSON.stringify(buildRequestBody(systemPrompt, userText, tools)),
  });

  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      errBody = await res.text();
    }
    const msg =
      (typeof errBody === "object" && errBody && geminiErrorMessage(errBody)) ||
      (typeof errBody === "string" ? errBody : "") ||
      `HTTP ${res.status}`;
    throw new GeminiNativeError(msg, res.status, errBody);
  }

  if (!res.body) {
    throw new GeminiNativeError("Empty response body", res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  const mergedCalls = new Map<string, { name: string; args: Record<string, unknown> }>();
  let callIndex = 0;

  const onAbort = () => reader.cancel().catch(() => {});
  if (signal.aborted) {
    await onAbort();
    throw new DOMException("Aborted", "AbortError");
  }
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as unknown;
          const { text, functionCalls } = extractStreamPart(json);
          if (text) {
            fullText += text;
            onDelta(text);
          }
          for (const fc of functionCalls) {
            const key = `${fc.name}:${callIndex++}`;
            mergedCalls.set(key, fc);
          }
        } catch (e) {
          if (e instanceof GeminiNativeError) throw e;
          /* skip malformed JSON line */
        }
      }
    }
    // Trailing line without \n
    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== "[DONE]") {
        try {
          const json = JSON.parse(payload) as unknown;
          const { text, functionCalls } = extractStreamPart(json);
          if (text) {
            fullText += text;
            onDelta(text);
          }
          for (const fc of functionCalls) {
            const key = `${fc.name}:${callIndex++}`;
            mergedCalls.set(key, fc);
          }
        } catch (e) {
          if (e instanceof GeminiNativeError) throw e;
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  const toolCalls: GeminiNativeToolCall[] = [...mergedCalls.values()].map((fc, i) => ({
    id: `gemini-fc-${i}-${fc.name}`,
    name: fc.name,
    args: fc.args,
  }));

  return { fullText, toolCalls };
}

/** Single-shot generateContent (scout, probes). */
export async function generateGeminiNativeContent(
  config: AiProviderProfile,
  model: string,
  systemPrompt: string,
  userText: string,
  signal: AbortSignal,
  maxOutputTokens = 256,
): Promise<string> {
  const id = normalizeModelId(model);
  const base = resolveGeminiRestOrigin(config);
  const apiKey = config.apiKey;
  const url = `${base}/v1beta/models/${encodeURIComponent(id)}:generateContent`;
  const f = httpFetch();

  const res = await f(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      [GEMINI_KEY_HEADER]: apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens },
    }),
  });

  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      errBody = await res.text();
    }
    const msg =
      (typeof errBody === "object" && errBody && geminiErrorMessage(errBody)) ||
      (typeof errBody === "string" ? errBody : "") ||
      `HTTP ${res.status}`;
    throw new GeminiNativeError(msg, res.status, errBody);
  }

  const data = (await res.json()) as unknown;
  const { text } = extractStreamPart(data);
  return text;
}

/** Vision OCR — single generateContent with inline image bytes. */
export async function geminiNativeTranscribeImage(
  config: AiProviderProfile,
  model: string,
  systemPrompt: string,
  userText: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  const id = normalizeModelId(model);
  const base = resolveGeminiRestOrigin(config);
  const url = `${base}/v1beta/models/${encodeURIComponent(id)}:generateContent`;
  const f = httpFetch();

  const res = await f(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [GEMINI_KEY_HEADER]: config.apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: userText },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      errBody = await res.text();
    }
    const msg =
      (typeof errBody === "object" && errBody && geminiErrorMessage(errBody)) ||
      (typeof errBody === "string" ? errBody : "") ||
      `HTTP ${res.status}`;
    throw new GeminiNativeError(msg, res.status, errBody);
  }

  const data = (await res.json()) as unknown;
  const { text } = extractStreamPart(data);
  return text;
}

/** List models (GET v1beta/models) — short IDs without `models/` prefix. */
export async function listGeminiNativeModels(config: AiProviderProfile): Promise<string[]> {
  const base = resolveGeminiRestOrigin(config);
  const apiKey = config.apiKey;
  const url = `${base}/v1beta/models?pageSize=100`;
  const f = httpFetch();
  const res = await f(url, {
    method: "GET",
    headers: { [GEMINI_KEY_HEADER]: apiKey },
  });

  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      errBody = await res.text();
    }
    const msg =
      (typeof errBody === "object" && errBody && geminiErrorMessage(errBody)) ||
      `HTTP ${res.status}`;
    throw new GeminiNativeError(msg, res.status, errBody);
  }

  const data = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  const out: string[] = [];
  for (const m of data.models ?? []) {
    const name = m.name ?? "";
    const short = name.startsWith("models/") ? name.slice("models/".length) : name;
    const methods = m.supportedGenerationMethods ?? [];
    if (methods.includes("generateContent") || methods.includes("streamGenerateContent")) {
      if (short) out.push(short);
    }
  }
  return filterChatLikeGeminiModels(out).sort();
}

const GEMINI_NON_CHAT_RE =
  /^(embedding|text-embedding|embedding-gecko|aqa|imagen|gemini-embedding)/i;

function filterChatLikeGeminiModels(ids: string[]): string[] {
  return ids.filter((id) => !GEMINI_NON_CHAT_RE.test(id));
}

export function describeGeminiNativeError(err: unknown): string {
  if (err instanceof GeminiNativeError) {
    const { status } = err;
    const detail = scrubKeyInMessage(err.message);
    if (status === 401 || status === 403) {
      return "Invalid or restricted API key — check the key and Gemini API enablement in Google AI Studio.";
    }
    if (status === 404) {
      return `Model or endpoint not found (404): ${detail || "check the model id"}`;
    }
    if (status === 429) {
      const head = detail
        ? `Rate limit or quota (429): ${detail}`
        : "Rate limit or quota (429) — the key may be over limit, or retry shortly.";
      const freeTierModel =
        /RESOURCE_EXHAUSTED|free_tier|limit:\s*0/i.test(detail) &&
        /gemini-2\.0-flash|2\.0-flash/i.test(detail);
      const freeTierGeneric =
        /RESOURCE_EXHAUSTED|free_tier|limit:\s*0/i.test(detail) && !freeTierModel;
      if (freeTierModel) {
        return (
          `${head}\n\n` +
          "That model often has no free-tier quota (limit 0) in Google AI Studio. Switch the persona to " +
          "`gemini-flash-latest` or `gemini-1.5-flash`, or enable billing. " +
          "https://ai.google.dev/gemini-api/docs/rate-limits"
        );
      }
      if (freeTierGeneric) {
        return (
          `${head}\n\n` +
          "If you are on the free tier, try another model (e.g. `gemini-flash-latest`) or wait for the retry time above. " +
          "https://ai.google.dev/gemini-api/docs/rate-limits"
        );
      }
      return head;
    }
    if (status === 400) {
      return detail || "Bad request (400) — the model may not support this call or parameters.";
    }
    return detail || `Gemini request failed (HTTP ${status}).`;
  }
  if (err instanceof Error && err.name === "AbortError") {
    return "Request cancelled.";
  }
  return scrubKeyInMessage(err instanceof Error ? err.message : String(err));
}

function scrubKeyInMessage(raw: string): string {
  return raw.replace(/AIzaSy[A-Za-z0-9_-]{20,}/g, "AIzaSy***");
}
