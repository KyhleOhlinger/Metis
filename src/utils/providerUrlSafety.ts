/**
 * Provider URL allowlisting for packaged Tauri builds.
 *
 * SECURITY: Shipped OpenAI, Gemini, and Anthropic profiles stay on this list.
 * OpenAI-compatible profiles, including LiteLLM, may use any HTTPS host the
 * user types. Loopback HTTP is for a gateway on this computer. Cloud-metadata
 * hosts and URLs with embedded credentials stay rejected.
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
  "llm-gateway.example.invalid",
  "date.nager.at",
  "raw.githubusercontent.com",
] as const;

const PACKAGED_HTTPS_HOST_SET = new Set<string>(PACKAGED_HTTPS_HOSTS);

/** Hosts used by holiday import and source update. Not valid AI chat endpoints. */
const NON_AI_HTTPS_HOSTS = new Set(["date.nager.at", "raw.githubusercontent.com"]);

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

export function isAiProviderHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (NON_AI_HTTPS_HOSTS.has(h)) return false;
  return isPackagedHttpsHost(h);
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
  return assertSafeUrl(raw, "packaged");
}

/** Shipped AI profile base URLs. Holiday and GitHub raw hosts are rejected. */
export function assertSafeAiProviderUrl(raw: string): URL {
  return assertSafeUrl(raw, "ai");
}

/**
 * LiteLLM and other OpenAI-compatible profiles. Any HTTPS host is accepted.
 * HTTP stays limited to localhost / 127.0.0.1.
 */
export function assertSafeCustomGatewayUrl(raw: string): URL {
  return assertSafeUrl(raw, "custom-gateway");
}

function assertSafeUrl(raw: string, mode: "packaged" | "ai" | "custom-gateway"): URL {
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

  if (mode === "custom-gateway") return parsed;

  const hostAllowed = mode === "ai" ? isAiProviderHost(host) : isPackagedHttpsHost(host);
  if (!hostAllowed) {
    throw new Error(
      `Host "${host}" is not in the packaged network allowlist. Use a shipped ` +
        "provider, an OpenAI-compatible or LiteLLM profile for your own gateway, " +
        "or localhost / 127.0.0.1.",
    );
  }

  return parsed;
}

export function packagedHttpsHostHint(): string {
  return (
    "OpenAI-compatible and LiteLLM profiles accept any https base URL. " +
    "A gateway on this computer uses http://127.0.0.1. OpenAI, Gemini, and " +
    "Anthropic profiles stay on their shipped hosts."
  );
}
