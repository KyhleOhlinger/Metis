import { egressEstimateSummary, type EgressEstimate } from "../services/contextBuilder";
import { appConfirm } from "../store/useToastStore";

/** Confirm dialog before a large folder/vault AI run. */
export async function confirmEgressBeforeRun(estimate: EgressEstimate): Promise<boolean> {
  if (!estimate.requiresConfirm) return true;
  return appConfirm(
    `${egressEstimateSummary(estimate)}\n\nSend this data to ${estimate.providerLabel}?`,
    { title: "Confirm AI egress", confirmLabel: "Send" },
  );
}
