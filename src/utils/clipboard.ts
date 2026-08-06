import { toastError, toastSuccess } from "@/store/useToastStore";
import { formatError } from "./formatError";

/** Copy text to the system clipboard; surfaces failures via toast. */
export async function copyTextToClipboard(
  text: string,
  options?: { successMessage?: string },
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    if (options?.successMessage) toastSuccess(options.successMessage);
    return true;
  } catch (err) {
    toastError(`Could not copy to clipboard: ${formatError(err)}`);
    return false;
  }
}
