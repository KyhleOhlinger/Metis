import { egressEstimateSummary, type EgressEstimate } from "../services/contextBuilder";
import { appConfirm } from "../store/useToastStore";
import { formatError } from "../utils/formatError";

export type EgressGate =
  | { proceed: true }
  | { proceed: false; reason: "cancelled" }
  | { proceed: false; reason: "error"; message: string };

export function destinationHostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl.trim();
  } catch {
    return baseUrl.trim();
  }
}

let lastConsentIdentity: string | null = null;

function consentIdentity(estimate: EgressEstimate): string {
  return `${estimate.profileId}|${estimate.destinationHost}`;
}

/** Confirm dialog before a large folder/vault AI run. */
export async function confirmEgressBeforeRun(estimate: EgressEstimate): Promise<boolean> {
  const identity = consentIdentity(estimate);
  const providerChanged = lastConsentIdentity !== null && lastConsentIdentity !== identity;
  if (!estimate.requiresConfirm && !providerChanged) {
    lastConsentIdentity = identity;
    return true;
  }
  const accepted = await appConfirm(
    `${egressEstimateSummary(estimate)}\n\nSend this data to ${estimate.providerLabel} (${estimate.destinationHost})?`,
    { title: "Confirm AI egress", confirmLabel: "Send" },
  );
  if (accepted) lastConsentIdentity = identity;
  return accepted;
}

/**
 * One place for "estimate, then confirm". A failed estimate aborts the run.
 * A dismissed dialog cancels without an error.
 */
export async function confirmEstimatedEgress(
  loadEstimate: () => Promise<EgressEstimate>,
): Promise<EgressGate> {
  try {
    const estimate = await loadEstimate();
    const accepted = await confirmEgressBeforeRun(estimate);
    return accepted ? { proceed: true } : { proceed: false, reason: "cancelled" };
  } catch (e) {
    return {
      proceed: false,
      reason: "error",
      message: `Could not estimate what would be sent: ${formatError(e)}`,
    };
  }
}
