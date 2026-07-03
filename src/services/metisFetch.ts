/**
 * Tauri-aware fetch with host pinning for AI provider profiles.
 *
 * SECURITY: Requests must target the resolved base URL for the profile
 * (blocks stray SDK redirects / exfiltration to unexpected hosts).
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AiProviderProfile } from "../types/persona";
import { hostFromBaseUrl, providerKindForProfile } from "../utils/providerProfiles";

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
  if (s.includes("api.anthropic.com") && !s.endsWith("/v1")) {
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

/** Effective API root used for HTTP (includes dev-browser proxy paths). */
export function resolveProviderBaseUrl(profile: AiProviderProfile): string {
  const kind = providerKindForProfile(profile);
  let normalized =
    kind === "google"
      ? normalizeGoogleBaseUrl(profile.baseUrl)
      : kind === "openai-compatible"
        ? normalizeCompatBaseUrl(profile.baseUrl)
        : profile.baseUrl.trim().replace(/\/+$/, "");

  if (import.meta.env.DEV && !isTauriWebview()) {
    const host = hostFromBaseUrl(normalized);
    if (host === "api.openai.com") {
      return `${window.location.origin}/api-proxy/openai/v1`;
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
    return baseFetch(input, init);
  };
}
