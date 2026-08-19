import { useStore } from "@/store/useStore";

/** Open the persistent Agent Run Log in the main editor pane. */
export function openAgentRunLog(): void {
  useStore.getState().setEditorTab("agent-history");
}
