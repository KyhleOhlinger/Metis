import { egressEstimateSummary, type EgressEstimate } from "../services/contextBuilder";

/** Confirm dialog before a large folder/vault AI run. */
export function confirmEgressBeforeRun(estimate: EgressEstimate): boolean {
  if (!estimate.requiresConfirm) return true;
  return window.confirm(
    `${egressEstimateSummary(estimate)}\n\nSend this data to ${estimate.providerLabel}?`,
  );
}
