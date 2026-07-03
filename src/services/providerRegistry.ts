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

  switch (providerKindForProfile(profile)) {
    case "openai":
      return createOpenAI({ apiKey, baseURL, fetch })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL, fetch })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey, baseURL, fetch })(modelId);
    case "openai-compatible":
      return createOpenAICompatible({
        name: profile.id === PRESET_LITELLM ? "litellm" : profile.name,
        apiKey,
        baseURL,
        fetch,
      })(modelId);
  }
}
