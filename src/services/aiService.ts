/**
 * aiService.ts — Centralised gateway for all AI calls.
 *
 * Uses the OpenAI-compatible SDK for OpenAI, Groq, and Perplexity.
 * Google Gemini uses the native v1beta REST API (generateContent /
 * streamGenerateContent + X-goog-api-key) when the base URL is the official
 * host — the OpenAI-compat layer at …/v1beta/openai is only used for custom
 * non-Google Gemini proxies.
 *
 * SECURITY: Only the specific note content required for each task is ever
 * transmitted to the cloud.  The full vault is never sent in a single call.
 * API keys are read from the user's app-data settings file — never hard-coded.
 *
 * NOTE: For production-grade key storage migrate to tauri-plugin-stronghold.
 */

import OpenAI from "openai";
import {
  type Persona,
  type AIProvider,
  type ProviderConfig,
  DEFAULT_MODELS,
} from "../types/persona";
// tauri-plugin-http provides a fetch implementation backed by Rust's reqwest,
// which runs outside the WebKit process and is therefore not subject to CORS.
// It is used whenever the UI runs inside a Tauri webview (release or `tauri dev`).
// Plain `vite` in the browser still uses the dev-server proxy + normal fetch.
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  describeGeminiNativeError,
  streamGeminiNativeChat,
  usesGeminiNativeApi,
  listGeminiNativeModels,
} from "./geminiNative";

/** True when running inside a Tauri 2 webview (not a standalone browser tab). */
function isTauriWebview(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ ===
      "object"
  );
}


// ── Provider base URLs ────────────────────────────────────────────────────────

export const PROVIDER_BASE_URLS: Record<AIProvider, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  // Perplexity exposes an OpenAI-compatible chat/completions endpoint;
  // sonar models add real-time web search on top of the standard LLM API.
  perplexity: "https://api.perplexity.ai",
};

// ── Dev proxy base URLs ───────────────────────────────────────────────────────
// In plain `vite` (browser only), the page loads from http://localhost:1420,
// so outbound fetch hits CORS. The Vite dev server proxies /api-proxy/... to
// each provider (see vite.config.ts).
//
// In `tauri dev`, we skip the proxy and use real HTTPS base URLs plus
// tauri-plugin-http — same as the packaged app. Otherwise Google Gemini and
// similar keys often see a browser Referer (localhost) on the proxied hop and
// return 400 "API key not valid" even though production works.
const DEV_PROXY_PATHS: Record<AIProvider, string> = {
  openai:     "/api-proxy/openai/v1",
  gemini:     "/api-proxy/gemini/v1beta/openai",
  groq:       "/api-proxy/groq/openai/v1",
  perplexity: "/api-proxy/perplexity",
};

// ── Provider URL normalisation ────────────────────────────────────────────────
//
// Each normaliser only fires when the URL contains the official provider domain,
// so custom proxies at unrelated hosts are passed through unchanged.

/**
 * Gemini — official OpenAI-compat endpoint requires the `/openai` suffix.
 * The native `/v1beta/` path uses a different auth scheme and blocks CORS.
 */
function normalizeGeminiUrl(url: string): string {
  const s = url.replace(/\/+$/, "");
  if (/\/v1beta$/.test(s)) return s + "/openai";
  if (s.includes("generativelanguage.googleapis.com") && !s.includes("/openai")) {
    return s + "/openai";
  }
  return s;
}

/**
 * Groq — requires `/openai/v1`.
 * Common mistakes: bare `api.groq.com`, or `api.groq.com/openai` without `/v1`.
 */
function normalizeGroqUrl(url: string): string {
  const s = url.replace(/\/+$/, "");
  if (!s.includes("api.groq.com")) return s;
  if (s.endsWith("/openai/v1")) return s;          // already correct
  if (s.endsWith("/openai"))    return s + "/v1";  // missing /v1
  if (/api\.groq\.com$/.test(s)) return s + "/openai/v1"; // bare domain
  return s;
}

/**
 * Perplexity — base URL must be exactly `https://api.perplexity.ai` (no path).
 * Users sometimes append `/v1` or `/openai/v1` by analogy with other providers,
 * which breaks the request path construction in the SDK.
 */
function normalizePerplexityUrl(url: string): string {
  const s = url.replace(/\/+$/, "");
  // Only normalise official Perplexity URLs; leave custom proxies untouched.
  if (!s.includes("api.perplexity.ai")) return s;
  return "https://api.perplexity.ai";
}

/**
 * Resolve the base URL for a provider, taking dev/prod environment and any
 * user-supplied custom base URL into account.
 *
 * Custom URLs are normalised before use to silently correct the most common
 * per-provider path mistakes. See the normaliser functions above for details.
 *
 * Priority: custom base URL (normalised) → dev proxy (browser-only dev) → production URL
 *
 * Exported so contextBuilder's scout call can reuse the same logic.
 */
export function resolveBaseUrl(provider: AIProvider, customBaseUrl?: string): string {
  if (customBaseUrl) {
    const normalizers: Partial<Record<AIProvider, (u: string) => string>> = {
      gemini:     normalizeGeminiUrl,
      groq:       normalizeGroqUrl,
      perplexity: normalizePerplexityUrl,
    };
    const normalized = normalizers[provider]?.(customBaseUrl) ?? customBaseUrl;
    return normalized;
  }
  if (import.meta.env.DEV && !isTauriWebview()) {
    // Combine the current dev-server origin with the proxy path so the URL
    // is correct even when TAURI_DEV_HOST overrides the hostname.
    return window.location.origin + DEV_PROXY_PATHS[provider];
  }
  return PROVIDER_BASE_URLS[provider];
}

// ── Client factory ────────────────────────────────────────────────────────────

function buildClient(provider: AIProvider, config: ProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: resolveBaseUrl(provider, config.baseUrl),
    // Required for browser / Tauri webview environments — the API key is
    // owned by the end user and stored locally, not exposed to a server.
    dangerouslyAllowBrowser: true,
    // Native HTTP in the Tauri webview (dev or release). Browser-only dev uses
    // the Vite proxy + default fetch instead.
    ...(isTauriWebview() && { fetch: tauriFetch as unknown as typeof globalThis.fetch }),
  });
}

/**
 * Same client configuration as chat streaming (including Tauri `fetch` in
 * production). Use for scout and any other auxiliary provider calls so
 * behaviour matches the main agent path.
 */
export function createAIClient(provider: AIProvider, config: ProviderConfig): OpenAI {
  return buildClient(provider, config);
}

// ── Agent file-writing tools ──────────────────────────────────────────────────
//
// SECURITY / PRODUCT POLICY: These tools never auto-execute on disk. The UI
// collects tool calls as pending writes and requires an explicit user "Apply".
// If you add multi-turn tool loops later, keep that human gate for any path
// that mutates the vault — do not stream tool results back into the model and
// apply filesystem side effects without confirmation.
//
// Four tools are exposed to the model with `tool_choice: "auto"` so they are
// only invoked when the user explicitly requests a file operation:
//
//   • write_to_current_file      — full overwrite of the open note
//   • append_to_current_file     — add content at the END (agent supplies chunk only)
//   • prepend_to_current_file    — add content at the START, after any frontmatter
//   • create_new_note            — create a new note at a vault-relative path
//
// For append/prepend the agent provides ONLY the new chunk; the frontend
// handles merging it with the existing file content.  This is safer and cheaper
// (the agent never needs to reproduce the entire file).

export interface ParsedToolCall {
  /** The tool_call id returned by the provider — needed for follow-up messages. */
  id: string;
  /** Function name, e.g. "append_to_current_file" */
  name: string;
  /** Parsed JSON arguments */
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
        "Use when the user asks to append, add to the end, or attach something to the current note. " +
        "Provide ONLY the new section — do NOT repeat the existing content.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The markdown content to add at the end of the file.",
          },
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
        "Add new content at the START of the currently open note (inserted after any YAML frontmatter). " +
        "Use when the user asks to prepend, add to the beginning, or insert at the top of the current note. " +
        "Provide ONLY the new section — do NOT repeat the existing content.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The markdown content to insert at the start of the file (after frontmatter if present).",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_at_cursor",
      description:
        "Insert new content at the user's current cursor position in the active note. " +
        "Use when the user asks to insert, add inline, or place content at the current position, " +
        "e.g. 'insert a table here', 'add a callout at my cursor', or 'fill in this section'. " +
        "Provide ONLY the new content to insert — do NOT repeat surrounding text.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The markdown content to insert at the cursor position.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_new_note",
      description:
        "Create a new markdown note in the vault. " +
        "Use when the user asks to save output to a new file or create a separate document.",
      parameters: {
        type: "object",
        properties: {
          relative_path: {
            type: "string",
            description:
              "Path relative to vault root, e.g. 'summaries/blog-summary.md'. " +
              "Always end with .md. Use only alphanumeric characters, hyphens, underscores, " +
              "and forward slashes. No spaces or special characters.",
          },
          content: {
            type: "string",
            description: "The complete markdown content for the new note.",
          },
        },
        required: ["relative_path", "content"],
      },
    },
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  /** Called when the stream completes.  `toolCalls` is empty for normal text responses. */
  onDone: (fullText: string, toolCalls: ParsedToolCall[]) => void;
  onError: (error: Error) => void;
}

/**
 * Stream a response from the LLM for the given persona and context.
 *
 * When `tools` are provided (e.g. AGENT_FILE_TOOLS), the model may respond
 * with tool calls instead of (or in addition to) streamed text.  Tool call
 * argument fragments are accumulated across delta chunks and delivered as
 * `ParsedToolCall[]` in `callbacks.onDone` once the stream finishes.
 *
 * @param persona        The active persona (supplies model + system prompt)
 * @param context        Pre-built context string (file, folder, or vault content)
 * @param userMessage    The user's question / instruction
 * @param providerConfig API key + optional custom base URL
 * @param callbacks      Streaming lifecycle hooks
 * @param tools          Optional OpenAI tool definitions to enable function calling
 * @returns              AbortController so the caller can cancel mid-stream
 */
export function streamResponse(
  persona: Persona,
  context: string,
  userMessage: string,
  providerConfig: ProviderConfig,
  callbacks: StreamCallbacks,
  tools?: OpenAI.Chat.ChatCompletionTool[],
): AbortController {
  const controller = new AbortController();

  const contextBlock = context.trim()
    ? `<context>\n${context.trim()}\n</context>\n\n`
    : "";
  const userPayload = `${contextBlock}${userMessage}`;

  // ── Google Gemini: native REST (X-goog-api-key) matches working curl;
  // OpenAI-compat …/v1beta/openai often returns empty HTTP 429 for chat+tools.
  if (persona.provider === "gemini" && usesGeminiNativeApi(providerConfig)) {
    (async () => {
      try {
        const { fullText, toolCalls } = await streamGeminiNativeChat(
          providerConfig,
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

  const client = buildClient(persona.provider, providerConfig);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: persona.systemPrompt },
    { role: "user",   content: userPayload },
  ];

  (async () => {
    let full = "";
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
      if (typeof c === "string") {
        textOut = c;
      } else if (Array.isArray(c)) {
        for (const part of c as OpenAI.Chat.ChatCompletionContentPart[]) {
          if (part.type === "text" && "text" in part) {
            textOut += part.text;
          }
        }
      }
      full = textOut;
      if (textOut) callbacks.onChunk(textOut);
      const toolCalls = parsedToolCallsFromMessage(message?.tool_calls);
      if (!controller.signal.aborted) {
        callbacks.onDone(full, toolCalls);
      }
    }

    async function runStreamingCompletion(): Promise<void> {
      full = "";
      for (const k of Object.keys(toolAccum)) {
        delete toolAccum[Number(k)];
      }

      const stream = await client.chat.completions.create(
        { ...commonParams, stream: true },
        { signal: controller.signal },
      );

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
        persona.provider === "gemini" &&
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

// ── Key scrubber ──────────────────────────────────────────────────────────────
// Removes recognisable API key patterns from error strings before they are
// shown to the user.  Extended whenever a new provider is added.
// OpenAI: sk-[...] / sk-proj-[...]   Groq: gsk_[...]
// Gemini: AIzaSy[...]                Perplexity: pplx-[...]
function scrubKey(raw: string): string {
  return raw
    .replace(/sk-[A-Za-z0-9_-]{8,}/g,    "sk-***")
    .replace(/gsk_[A-Za-z0-9]{16,}/g,     "gsk_***")
    .replace(/AIzaSy[A-Za-z0-9_-]{20,}/g, "AIzaSy***")
    .replace(/pplx-[A-Za-z0-9]{16,}/g,    "pplx-***");
}

// ── Error classifier ──────────────────────────────────────────────────────────
// Converts a raw caught error into a human-readable, actionable message.
// Priority: APIConnectionError (cause unwrap) → APIError status codes → network failures → raw message.
function describeError(err: unknown): string {
  // ── OpenAI SDK APIConnectionError (no HTTP status — fetch itself failed) ──
  // The SDK wraps the underlying fetch/network error as `.cause`.  Without
  // unwrapping it the user only sees the generic "Connection error." default.
  if (err instanceof OpenAI.APIError && err.status == null) {
    const cause = (err as { cause?: Error }).cause;
    if (cause) {
      return classifyNetworkError(cause instanceof Error ? cause.message : String(cause));
    }
    return "Connection error — check your internet connection and the Base URL.";
  }

  // ── OpenAI SDK structured API errors ──────────────────────────────────────
  // The SDK throws OpenAI.APIError (and status-specific subclasses) for all
  // non-2xx HTTP responses.  The `.status` and `.message` fields are reliable.
  if (err instanceof OpenAI.APIError) {
    const { status } = err;

    if (status === 401) {
      return "Invalid API key — double-check the key is correct and hasn't been revoked.";
    }
    if (status === 400) {
      const hint = scrubKey(err.message).trim();
      const base =
        hint.length > 0
          ? `Bad request (400): ${hint}`
          : "Bad request (400) — the provider rejected the request (often an invalid model id or unsupported parameters). Check the model name in your persona.";
      const keyNoise = /api key|api_key|invalid.*key/i.test(hint);
      if (keyNoise && import.meta.env.DEV && !isTauriWebview()) {
        return (
          base +
          " Tip: run `tauri dev` (not `vite` alone) so calls match the packaged app, or allow http://localhost:1420/* under Google Cloud API key HTTP referrer restrictions."
        );
      }
      return base;
    }
    if (status === 403) {
      return "Access denied (403) — your key may lack permission for this endpoint, or the account has restrictions.";
    }
    if (status === 404) {
      return "Endpoint not found (404) — the Base URL may be wrong or the provider path is incorrect.";
    }
    if (status === 429) {
      const rawDetail = scrubKey(err.message).trim();
      const lower = rawDetail.toLowerCase();
      const retryAfter = err.headers?.get("retry-after");
      const quota =
        lower.includes("quota") ||
        lower.includes("billing") ||
        lower.includes("exceeded") ||
        lower.includes("resource_exhausted");
      const headline = quota
        ? "Quota or spending limit (429)."
        : "Rate limit (429) — the provider is throttling requests in this window.";
      const parts: string[] = [headline];
      if (rawDetail) parts.push(rawDetail);
      if (retryAfter) parts.push(`Retry-After: ${retryAfter}`);
      return parts.join(" ");
    }
    if (status === 500) {
      return "Provider internal server error (500) — the service is having issues; try again shortly.";
    }
    if (status === 503) {
      return "Service unavailable (503) — the provider may be down or under maintenance.";
    }
    if (status) {
      // Fallback for other HTTP errors: include status + scrubbed message
      return `HTTP ${status}: ${scrubKey(err.message)}`;
    }
  }

  // ── Network / connectivity failures ───────────────────────────────────────
  return classifyNetworkError(err instanceof Error ? err.message : String(err));
}

/**
 * Classify a raw error message string into a user-friendly network diagnostic.
 * Shared by the top-level `describeError` and the `APIConnectionError` unwrap path.
 */
function classifyNetworkError(raw: string): string {
  const lower = raw.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror")    ||
    lower.includes("load failed")     ||
    lower.includes("network request failed")
  ) {
    return "Network error — check your internet connection, or the app may need a restart in dev mode.";
  }
  if (lower.includes("connection refused") || lower.includes("econnrefused")) {
    return "Connection refused — the server is unreachable. Check the Base URL.";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    return "Request timed out — the server took too long to respond.";
  }
  if (lower.includes("cors") || lower.includes("access-control-allow-origin")) {
    return "CORS error — this can happen in dev mode. Try restarting via `npm run dev` or check the Base URL.";
  }
  if (lower.includes("ssl") || lower.includes("certificate") || lower.includes("cert")) {
    return "TLS/certificate error — the server's certificate could not be verified.";
  }
  if (lower.includes("dns") || lower.includes("getaddrinfo") || lower.includes("lookup")) {
    return "DNS resolution failed — the provider hostname could not be resolved. Check your network connection.";
  }

  return scrubKey(raw);
}

/**
 * Lightweight connection test — calls `models.list()` which costs zero tokens.
 * Returns a discriminated union so callers can display either a success badge
 * or a sanitised error message without ever surfacing the raw API key.
 *
 * Not all providers expose a `GET /models` endpoint (notably Perplexity).
 * A 404 on that endpoint is treated as a successful connection so users see
 * "Connected" rather than a misleading "Endpoint not found" error.
 */
export async function testProviderConnection(
  provider: AIProvider,
  config: ProviderConfig,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  if (!config.apiKey?.trim()) {
    return { ok: false, error: "No API key configured." };
  }
  if (provider === "gemini" && usesGeminiNativeApi(config)) {
    try {
      const models = await listGeminiNativeModels(config);
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
    const client = buildClient(provider, config);
    const list = await client.models.list();
    const count = list.data?.length ?? 0;
    const detail = count > 0
      ? `Connected · ${count} model${count !== 1 ? "s" : ""} available`
      : "Connected";
    return { ok: true, detail };
  } catch (err) {
    // A 404 on /models means the provider is reachable but doesn't expose a
    // model-listing endpoint (e.g. Perplexity).  Treat this as a successful
    // connection — the chat/completions endpoint will still work.
    if (err instanceof OpenAI.APIError && err.status === 404) {
      return { ok: true, detail: "Connected (provider does not expose a models endpoint)" };
    }
    return { ok: false, error: describeError(err) };
  }
}

// ── Curated model catalogue ───────────────────────────────────────────────────
//
// A hand-picked list of up to 5 representative models per provider (small,
// medium, large, reasoning tiers).  Shown immediately in the ModelPicker as
// suggestions — no API call required.  When the user has fetched the full
// model list, typing in the picker searches across all fetched IDs; the
// curated list only acts as the default suggestions when nothing is typed.

export interface CuratedModel {
  id:   string;
  tier: "small" | "medium" | "large" | "reasoning";
}

export const PROVIDER_PREFERRED_MODELS: Record<AIProvider, CuratedModel[]> = {
  openai: [
    { id: "gpt-4o-mini",  tier: "small"     },
    { id: "gpt-4o",       tier: "medium"    },
    { id: "gpt-4.5",      tier: "large"     },
    { id: "o1-mini",      tier: "reasoning" },
    { id: "o3",           tier: "reasoning" },
  ],
  gemini: [
    { id: "gemini-flash-latest",      tier: "small"  },
    { id: "gemini-1.5-flash",         tier: "small"  },
    // Omit gemini-2.0-flash from suggestions: free tier often shows limit:0 for that model in AI Studio.
    { id: "gemini-1.5-pro",           tier: "medium" },
    { id: "gemini-2.0-pro-exp",       tier: "large"  },
    { id: "gemini-2.5-pro-exp-03-25", tier: "large"  },
  ],
  groq: [
    { id: "llama-3.1-8b-instant",    tier: "small"  },
    { id: "gemma2-9b-it",            tier: "small"  },
    { id: "mixtral-8x7b-32768",      tier: "medium" },
    { id: "llama3-70b-8192",         tier: "medium" },
    { id: "llama-3.3-70b-versatile", tier: "large"  },
  ],
  perplexity: [
    { id: "sonar",               tier: "small"     },
    { id: "sonar-reasoning",     tier: "medium"    },
    { id: "sonar-reasoning-pro", tier: "large"     },
    { id: "sonar-pro",           tier: "large"     },
    { id: "sonar-deep-research", tier: "reasoning" },
  ],
};

/** First curated "small" chat model for batch-updating all personas to a provider. */
export function curatedSmallModelId(provider: AIProvider): string {
  const list = PROVIDER_PREFERRED_MODELS[provider];
  const small = list.find((m) => m.tier === "small");
  return small?.id ?? DEFAULT_MODELS[provider];
}

// ── Non-chat model filter ─────────────────────────────────────────────────────
// Providers expose embedding, audio, image, and moderation models alongside
// their chat/completion models.  Including all of them in the picker floods
// the list and causes WebKit to freeze when the <select> renders.
// This regex matches the well-known non-chat model name prefixes.
const NON_CHAT_RE =
  /^(whisper-|dall-e-|tts-|text-embedding|text-moderation|omni-moderation|babbage-|davinci-|text-search-|text-similarity-|code-search-|curie-|ada-)/i;

function filterChatModels(ids: string[]): string[] {
  return ids.filter((id) => !NON_CHAT_RE.test(id));
}

/**
 * Fetch the list of chat/completion model IDs available from a provider.
 * Uses `models.list()` (zero tokens) and returns the IDs sorted alphabetically,
 * with non-chat models (embeddings, audio, image, etc.) filtered out.
 * Callers cache the result; see `usePersonaStore.fetchModelsForProvider`.
 */
export async function fetchProviderModels(
  provider: AIProvider,
  config: ProviderConfig,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  if (!config.apiKey?.trim()) {
    return { ok: false, error: "No API key configured for this provider." };
  }
  if (provider === "gemini" && usesGeminiNativeApi(config)) {
    try {
      const models = filterChatModels(await listGeminiNativeModels(config));
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: describeGeminiNativeError(err) };
    }
  }
  try {
    const client = buildClient(provider, config);
    const list = await client.models.list();
    const models = filterChatModels(
      (list.data ?? []).map((m) => m.id),
    ).sort();
    return { ok: true, models };
  } catch (err) {
    // If the provider returns 404 on /models (e.g. Perplexity), surface the
    // curated list instead rather than showing an error in the model picker.
    if (err instanceof OpenAI.APIError && err.status === 404) {
      const curated = (PROVIDER_PREFERRED_MODELS[provider] ?? []).map((m) => m.id).sort();
      return { ok: true, models: curated };
    }
    return { ok: false, error: describeError(err) };
  }
}
