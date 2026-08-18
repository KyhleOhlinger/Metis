import { useEffect, useState } from "react";
import type { AiProviderProfile, ExecutionScope, Persona } from "../types/persona";
import {
  estimateContextEgress,
  egressEstimateSummary,
  type EgressEstimate,
} from "../services/contextBuilder";
import { Hint, InlineBanner, SubsectionLabel } from "./commandCenter/shared/ui";

interface Props {
  scope: ExecutionScope;
  userMessage: string;
  persona: Persona | null;
  profile: AiProviderProfile | undefined;
  activeFileContent: string;
  activeFilePath: string | null;
  vaultPath: string | null;
  hidden?: boolean;
}

/** Live preview of how much vault content may be sent to the AI for the current scope. */
export function EgressTransparency({
  scope,
  userMessage,
  persona,
  profile,
  activeFileContent,
  activeFilePath,
  vaultPath,
  hidden,
}: Props) {
  const [estimate, setEstimate] = useState<EgressEstimate | null>(null);
  const [loading, setLoading] = useState(false);

  const showForScope =
    scope.type === "specific-folder" ||
    scope.type === "full-vault" ||
    scope.type === "current-file" ||
    scope.type === "specific-file";

  const hasApiKey = Boolean(profile?.apiKey?.trim());

  useEffect(() => {
    if (hidden || !showForScope || !persona || !hasApiKey || !profile) {
      setEstimate(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void estimateContextEgress(
        scope,
        userMessage,
        persona,
        profile,
        activeFileContent,
        activeFilePath,
        vaultPath,
      )
        .then((est) => {
          if (!cancelled) setEstimate(est);
        })
        .catch(() => {
          if (!cancelled) setEstimate(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    hidden,
    showForScope,
    scope,
    userMessage,
    persona,
    profile,
    activeFileContent,
    activeFilePath,
    vaultPath,
    hasApiKey,
  ]);

  if (hidden || !showForScope || !persona) return null;

  if (!hasApiKey) {
    return (
      <div className="shrink-0 border-b border-border px-3 py-2">
        <InlineBanner>
          <SubsectionLabel>Data sent to AI</SubsectionLabel>
          <p className="mt-1">
            Configure an API key in settings to preview what will be sent for this scope.
          </p>
        </InlineBanner>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-border px-3 py-2">
      <InlineBanner>
        <SubsectionLabel>Data sent to AI</SubsectionLabel>
        {loading && !estimate ? (
          <p className="mt-1 italic">Estimating scope…</p>
        ) : estimate ? (
          <p className="mt-1 text-text-secondary">{egressEstimateSummary(estimate)}</p>
        ) : (
          <p className="mt-1 italic">Could not estimate scope.</p>
        )}
        <div className="mt-1.5">
          <Hint>
            Only notes in the selected scope are considered. Your prompt and system prompt are
            included separately.
          </Hint>
        </div>
      </InlineBanner>
    </div>
  );
}
