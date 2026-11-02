/** Redact credential-shaped substrings before they reach logs or UI errors. */

export function scrubSecretsFromMessage(raw: string): string {
  return raw
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-***")
    .replace(/sk-or-v1-[A-Za-z0-9]{8,}/g, "sk-or-***")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/gsk_[A-Za-z0-9]{16,}/g, "gsk_***")
    .replace(/AIzaSy[A-Za-z0-9_-]{20,}/g, "AIzaSy***")
    .replace(/pplx-[A-Za-z0-9]{16,}/g, "pplx-***")
    .replace(/\b[A-Fa-f0-9]{32}\b/g, "***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi, "Bearer ***")
    .replace(
      /((?:api[_-]?key|access[_-]?token|authorization)"?\s*[:=]\s*"?)[^"',\s}]+/gi,
      "$1***",
    );
}
