/**
 * Handwriting OCR — vision LLM transcription of vault images to Markdown.
 *
 * SECURITY: Only sends one image at a time to the user's configured provider.
 */

import OpenAI from "openai";
import type { AiProviderProfile, Persona } from "../types/persona";
import { createAIClient, scrubSecretsFromMessage } from "./aiService";
import {
  describeGeminiNativeError,
  geminiNativeTranscribeImage,
  profileUsesGeminiNative,
} from "./geminiNative";

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
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!profile.apiKey?.trim()) {
    return { ok: false, error: "No API key configured for this provider." };
  }

  const userText = `${OCR_USER_PROMPT}\n\nImage file: ${imageFileName}`;

  try {
    if (profileUsesGeminiNative(profile)) {
      const text = await geminiNativeTranscribeImage(
        profile,
        persona.model,
        persona.systemPrompt,
        userText,
        imageBase64,
        mimeType,
      );
      const trimmed = text.trim();
      if (!trimmed) return { ok: false, error: "Empty transcription from the model." };
      return { ok: true, text: trimmed };
    }

    const client = createAIClient(profile);
    const completion = await client.chat.completions.create({
      model: persona.model,
      max_tokens: 8192,
      messages: [
        { role: "system", content: persona.systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    const text = typeof raw === "string" ? raw.trim() : "";

    if (!text) return { ok: false, error: "Empty transcription from the model." };
    return { ok: true, text };
  } catch (err) {
    if (profileUsesGeminiNative(profile)) {
      return { ok: false, error: describeGeminiNativeError(err) };
    }
    if (err instanceof OpenAI.APIError) {
      const hint =
        err.status === 400 || err.status === 404
          ? " — use a vision-capable model (e.g. gpt-4o, gemini-1.5-flash)."
          : "";
      const msg = scrubSecretsFromMessage(err.message || `HTTP ${err.status}`);
      return { ok: false, error: `${msg}${hint}` };
    }
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, error: scrubSecretsFromMessage(raw) };
  }
}
