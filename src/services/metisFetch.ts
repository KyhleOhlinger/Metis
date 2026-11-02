/**
 * Tauri-aware fetch with host pinning for AI provider profiles.
 *
 * SECURITY: Requests must target the resolved base URL for the profile
 * (blocks stray SDK redirects / exfiltration to unexpected hosts).
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AiProviderProfile, ProviderKind } from "../types/persona";
import { hostFromBaseUrl, providerKindForProfile } from "../utils/providerProfiles";
import {
  assertSafeAiProviderUrl,
  assertSafeCustomGatewayUrl,
} from "../utils/providerUrlSafety";

export function isTauriWebview(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ ===
      "object"
  );
}

function normalizeCompatBaseUrl(baseUrl: string): string {
  let s = baseUrl.trim().replace(/\/+$/, "");
  if (!s) return s;

  if (s.includes("api.groq.com")) {
    if (s.endsWith("/openai/v1")) return s;
    if (s.endsWith("/openai")) return `${s}/v1`;
    if (/api\.groq\.com$/.test(s)) return `${s}/openai/v1`;
  }
  if (s.includes("api.perplexity.ai")) {
    return "https://api.perplexity.ai";
  }
  // Misconfigured openai-compatible profile pointing at Anthropic — still normalize.
  if (s.includes("api.anthropic.com")) {
    return normalizeAnthropicBaseUrl(s);
  }
  if (s.includes("api.openai.com")) {
    return normalizeOpenAiBaseUrl(s);
  }

  return ensureOpenAiCompatRoot(s);
}

/** A host-only custom gateway URL is the OpenAI-compatible root, which lives at /v1. */
function ensureOpenAiCompatRoot(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return baseUrl;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path !== "") return baseUrl;
  parsed.pathname = "/v1";
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeOpenAiBaseUrl(baseUrl: string): string {
  let s = baseUrl.trim().replace(/\/+$/, "");
  if (!s) return s;
  if (s.includes("api.openai.com") && !/\/v1$/.test(s)) {
    return `${s}/v1`;
  }
  return s;
}

function normalizeAnthropicBaseUrl(baseUrl: string): string {
  let s = baseUrl.trim().replace(/\/+$/, "");
  if (!s) return s;
  if (s.includes("api.anthropic.com") && !/\/v1$/.test(s)) {
    return `${s}/v1`;
  }
  return s;
}

function normalizeGoogleBaseUrl(baseUrl: string): string {
  let s = baseUrl.trim().replace(/\/+$/, "");
  if (!s) return "https://generativelanguage.googleapis.com/v1beta";
  if (s.includes("generativelanguage.googleapis.com")) {
    if (s.endsWith("/openai")) s = s.slice(0, -"/openai".length);
    if (!/\/v1beta$/.test(s)) {
      if (s.endsWith("/v1")) s = s.slice(0, -"/v1".length);
      s = `${s}/v1beta`;
    }
  }
  return s;
}

function normalizeBaseUrlForKind(kind: ProviderKind, baseUrl: string): string {
  switch (kind) {
    case "google":
      return normalizeGoogleBaseUrl(baseUrl);
    case "openai":
      return normalizeOpenAiBaseUrl(baseUrl);
    case "anthropic":
      return normalizeAnthropicBaseUrl(baseUrl);
    case "openai-compatible":
      return normalizeCompatBaseUrl(baseUrl);
  }
}

function assertProfileBaseUrl(profile: AiProviderProfile, raw: string): void {
  if (providerKindForProfile(profile) === "openai-compatible") {
    assertSafeCustomGatewayUrl(raw);
    return;
  }
  assertSafeAiProviderUrl(raw);
}

/** Effective API root used for HTTP (includes dev-browser proxy paths). */
export function resolveProviderBaseUrl(profile: AiProviderProfile): string {
  assertProfileBaseUrl(profile, profile.baseUrl);
  const kind = providerKindForProfile(profile);
  const normalized = normalizeBaseUrlForKind(kind, profile.baseUrl);

  if (import.meta.env.DEV && !isTauriWebview()) {
    const host = hostFromBaseUrl(normalized);
    if (host === "api.openai.com") {
      return `${window.location.origin}/api-proxy/openai/v1`;
    }
    if (host === "api.anthropic.com") {
      return `${window.location.origin}/api-proxy/anthropic/v1`;
    }
    if (host === "api.groq.com") {
      return `${window.location.origin}/api-proxy/groq/openai/v1`;
    }
    if (host === "generativelanguage.googleapis.com") {
      return `${window.location.origin}/api-proxy/gemini-native/v1beta`;
    }
    if (host === "api.perplexity.ai") {
      return `${window.location.origin}/api-proxy/perplexity`;
    }
  }

  return normalized;
}

export function assertProfileHost(profile: AiProviderProfile, requestUrl: string): void {
  assertProfileBaseUrl(profile, requestUrl);
  const expected = hostFromBaseUrl(resolveProviderBaseUrl(profile));
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

/** Bearer value with a repeated "Bearer " prefix removed. */
function authorizationToken(headers: Headers): string {
  const raw = headers.get("Authorization") ?? "";
  return raw.trim().replace(/^(?:Bearer\s+)+/i, "").trim();
}

function isJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
}

function normalizeAuthorization(headers: Headers): void {
  if (!headers.has("Authorization")) return;
  const token = authorizationToken(headers);
  if (!token) {
    headers.delete("Authorization");
    return;
  }
  headers.set("Authorization", `Bearer ${token}`);
}

/**
 * Google IAP reads Authorization and rejects anything that is not a JWT
 * ("Invalid IAP credentials: Unable to parse JWT"). An unauthenticated IAP
 * host still does that when a LiteLLM virtual key is in Authorization.
 * LiteLLM accepts the same key in x-litellm-api-key, which IAP ignores.
 */
function moveKeyOutOfAuthorization(headers: Headers): boolean {
  const token = authorizationToken(headers);
  if (!token || isJwt(token)) return false;
  headers.delete("Authorization");
  headers.set("x-litellm-api-key", `Bearer ${token}`);
  headers.set("x-api-key", token);
  return true;
}

export function metisFetchForProfile(profile: AiProviderProfile): typeof globalThis.fetch {
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
    // Empty Origin is removed by tauri-plugin-http when unsafe-headers is on.
    const headers = new Headers(init?.headers ?? undefined);
    headers.set("Origin", "");
    normalizeAuthorization(headers);
    const res = await baseFetch(input, { ...init, headers });
    if (res.status !== 401) return res;
    const detail = await res.text();
    if (!/Invalid IAP credentials|Unable to parse JWT/i.test(detail)) {
      return new Response(detail, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    const retryHeaders = new Headers(headers);
    if (!moveKeyOutOfAuthorization(retryHeaders)) {
      return new Response(detail, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    assertProfileHost(profile, url);
    return baseFetch(input, { ...init, headers: retryHeaders });
  };
}
