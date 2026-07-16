/**
 * Handwriting OCR — vision LLM transcription of vault images to Markdown.
 *
 * SECURITY: Only sends one image at a time to the user's configured provider.
 */

import type { AiProviderProfile, Persona } from "../types/persona";
import {
  describeLlmError,
  generateVisionCompletion,
  scrubSecretsFromMessage,
  type LlmCompletionMeta,
} from "./llmService";

const OCR_USER_PROMPT =
  "Transcribe all handwritten text in this image into Markdown. " +
  "Preserve structure (headings, bullet lists, numbered lists, tables) where visible. " +
  "Mark uncertain words or phrases with [?]. " +
  "Output ONLY the transcription body — no preamble, no code fences.";

export async function transcribeHandwritingImage(
  persona: Persona,
  profile: AiProviderProfile,
  imageBase64: string,
  mimeType: string,
  imageFileName: string,
): Promise<{ ok: true; text: string; meta: LlmCompletionMeta } | { ok: false; error: string }> {
  if (!profile.apiKey?.trim()) {
    return { ok: false, error: "No API key configured for this provider." };
  }

  const userText = `${OCR_USER_PROMPT}\n\nImage file: ${imageFileName}`;

  try {
    const { text, meta } = await generateVisionCompletion(
      persona,
      profile,
      userText,
      imageBase64,
      mimeType,
    );
    if (!text) return { ok: false, error: "Empty transcription from the model." };
    return { ok: true, text, meta };
  } catch (err) {
    const msg = describeLlmError(err);
    const hint =
      msg.includes("400") || msg.includes("404")
        ? " — use a vision-capable model (e.g. gpt-4o, gemini-2.0-flash)."
        : "";
    return { ok: false, error: `${scrubSecretsFromMessage(msg)}${hint}` };
  }
}
