import { useEffect, useState } from "react";
import type { AiProviderProfile, ExecutionScope, Persona } from "../types/persona";
import {
  estimateContextEgress,
  egressEstimateSummary,
  type EgressEstimate,
} from "../services/contextBuilder";

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
    scope.type === "specific-folder" || scope.type === "full-vault";

  useEffect(() => {
    if (hidden || !showForScope || !persona || !profile?.apiKey?.trim()) {
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
  ]);

  if (hidden || !showForScope || !persona) return null;

  return (
    <div className="shrink-0 border-b border-border bg-surface-overlay/30 px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted/70 mb-1">
        Data sent to AI
      </p>
      {loading && !estimate ? (
        <p className="text-[10px] text-text-muted italic">Estimating scope…</p>
      ) : estimate ? (
        <p className="text-[10px] text-text-muted leading-relaxed">
          {egressEstimateSummary(estimate)}
        </p>
      ) : (
        <p className="text-[10px] text-text-muted italic">Could not estimate scope.</p>
      )}
      <p className="mt-1 text-[9px] text-text-muted/60 leading-relaxed">
        Only notes in the selected scope are considered. Your prompt and system prompt are included separately.
        Metis never uploads your whole disk — only scoped <code className="font-mono text-[8px]">.md</code> content.
      </p>
    </div>
  );
}

/** Confirm dialog before a large folder/vault AI run. */
export function confirmEgressBeforeRun(estimate: EgressEstimate): boolean {
  if (!estimate.requiresConfirm) return true;
  return window.confirm(
    `${egressEstimateSummary(estimate)}\n\nSend this data to ${estimate.providerLabel}?`,
  );
}
