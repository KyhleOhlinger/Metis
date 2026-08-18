import type { Persona, Settings } from "@/types/persona";
import { appConfirm } from "@/store/useToastStore";
import { findProviderProfile } from "./providerProfiles";

/**
 * Set the default API provider and optionally repoint all personas to it.
 */
export async function changeDefaultProviderWithPrompt(opts: {
  newProfileId: string;
  currentDefaultId: string | null | undefined;
  personas: Persona[];
  settings: Settings;
  setDefaultProviderProfileId: (id: string) => void;
  setAllPersonasProviderProfile: (profileId: string) => void;
}): Promise<void> {
  const {
    newProfileId,
    currentDefaultId,
    personas,
    settings,
    setDefaultProviderProfileId,
    setAllPersonasProviderProfile,
  } = opts;

  if (newProfileId === currentDefaultId) return;

  setDefaultProviderProfileId(newProfileId);

  const profileName = findProviderProfile(settings, newProfileId)?.name ?? "this provider";
  const affected = personas.filter((p) => p.providerProfileId !== newProfileId);
  if (affected.length === 0) return;

  const ok = await appConfirm(
    `Switch all ${affected.length} persona${affected.length === 1 ? "" : "s"} to use ${profileName} as their API provider?`,
    {
      title: "Update personas?",
      confirmLabel: "Update all",
      cancelLabel: "Keep current",
    },
  );
  if (ok) setAllPersonasProviderProfile(newProfileId);
}
