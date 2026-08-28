/**
 * Provider URL allowlisting for packaged Tauri builds.
 *
 * SECURITY: The HTTP plugin and CSP must not use `https://**`. Custom
 * OpenAI-compatible hosts are limited to this list (plus loopback). Adding a
 * new cloud provider requires updating this module, capabilities/default.json,
 * and tauri.conf.json connect-src together.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Exact HTTPS hostnames allowed for AI / holiday / source-update traffic. */
export const PACKAGED_HTTPS_HOSTS = [
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.perplexity.ai",
  "api.anthropic.com",
  "openrouter.ai",
  "api.openrouter.ai",
  "api.together.xyz",
  "api.mistral.ai",
  "api.fireworks.ai",
  "api.deepseek.com",
  "api.x.ai",
  "api.cerebras.ai",
  "date.nager.at",
  "raw.githubusercontent.com",
] as const;

const PACKAGED_HTTPS_HOST_SET = new Set<string>(PACKAGED_HTTPS_HOSTS);

/** Azure OpenAI-style subdomains (wildcard in capabilities). */
const PACKAGED_HTTPS_SUFFIXES = [".openai.azure.com", ".cognitiveservices.azure.com"] as const;

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "169.254.169.254",
]);

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_HOSTS.has(h);
}

export function isPackagedHttpsHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (PACKAGED_HTTPS_HOST_SET.has(h)) return true;
  return PACKAGED_HTTPS_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

function isBlockedMetadataHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (METADATA_HOSTS.has(h)) return true;
  // IPv6 AWS IMDSv2
  return h === "fd00:ec2::254";
}

/**
 * Parse and reject unsafe provider / plugin-http destinations.
 * Allows HTTPS packaged hosts, loopback HTTP(S), and nothing else.
 */
export function assertSafeProviderUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Base URL is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Base URL is not a valid URL.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Provider URL must not include credentials.");
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("Provider URL must use https (or http on localhost).");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new Error("Provider URL is missing a hostname.");
  }
  if (isBlockedMetadataHost(host)) {
    throw new Error("Provider URL host is not allowed.");
  }

  if (isLoopbackHost(host)) {
    return parsed;
  }

  if (protocol !== "https:") {
    throw new Error("HTTP is only allowed for localhost / 127.0.0.1.");
  }

  if (!isPackagedHttpsHost(host)) {
    throw new Error(
      `Host "${host}" is not in the packaged network allowlist. Use a shipped ` +
        "provider, Azure OpenAI, or a local gateway on localhost / 127.0.0.1.",
    );
  }

  return parsed;
}

export function packagedHttpsHostHint(): string {
  return (
    "HTTPS endpoints must be a shipped provider (OpenAI, Gemini, Groq, Anthropic, " +
    "Perplexity, OpenRouter, Azure, …) or a local gateway on localhost / 127.0.0.1."
  );
}
