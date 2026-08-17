/**
 * Maps AiProviderProfile → Vercel AI SDK language model factories.
 *
 * SECURITY: All factories use metisFetchForProfile for host pinning.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { AiProviderProfile } from "../types/persona";
import {
  PRESET_LITELLM,
  providerKindForProfile,
} from "../utils/providerProfiles";
import { metisFetchForProfile, resolveProviderBaseUrl } from "./metisFetch";

export { isGoogleProvider, providerKindForProfile } from "../utils/providerProfiles";

export function resolveLanguageModel(
  profile: AiProviderProfile,
  modelId: string,
): LanguageModel {
  const fetch = metisFetchForProfile(profile);
  const apiKey = profile.apiKey;
  const baseURL = resolveProviderBaseUrl(profile);

  const kind = providerKindForProfile(profile);
  switch (kind) {
    case "openai": {
      // @ai-sdk/openai v4 defaults to Responses API; Metis uses Chat Completions.
      const openai = createOpenAI({ apiKey, baseURL, fetch });
      return openai.chat(modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey, baseURL, fetch });
      return google.chat(modelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey, baseURL, fetch });
      return anthropic.messages(modelId);
    }
    case "openai-compatible": {
      const compat = createOpenAICompatible({
        name: profile.id === PRESET_LITELLM ? "litellm" : profile.name,
        apiKey,
        baseURL,
        fetch,
      });
      return compat.chatModel(modelId);
    }
  }
}
