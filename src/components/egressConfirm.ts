import { egressEstimateSummary, type EgressEstimate } from "../services/contextBuilder";
import { appConfirm } from "../store/useToastStore";
import { formatError } from "../utils/formatError";

export type EgressGate =
  | { proceed: true }
  | { proceed: false; reason: "cancelled" }
  | { proceed: false; reason: "error"; message: string };

/** Confirm dialog before a large folder/vault AI run. */
export async function confirmEgressBeforeRun(estimate: EgressEstimate): Promise<boolean> {
  if (!estimate.requiresConfirm) return true;
  return appConfirm(
    `${egressEstimateSummary(estimate)}\n\nSend this data to ${estimate.providerLabel}?`,
    { title: "Confirm AI egress", confirmLabel: "Send" },
  );
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
