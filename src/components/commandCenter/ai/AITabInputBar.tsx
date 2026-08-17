import type { Persona } from "@/types/persona";
import type { PendingWrite } from "../agent/pendingWrite.types";
import type { ContextStrategy } from "@/services/contextBuilder";
import { usePersonaStore } from "@/store/usePersonaStore";
import { getDisplayChord, aiRunChordMatches } from "@/services/keybindingRuntime";

interface AITabInputBarProps {
  userMessage: string;
  setUserMessage: (msg: string) => void;
  streaming: boolean;
  hasApiKey: boolean;
  activePersona: Persona | undefined;
  isSystemPersonaActive: boolean;
  response: string;
  pendingWrites: PendingWrite[];
  handleRun: () => void;
  handleStop: () => void;
  onClear: () => void;
}

export function AITabInputBar({
  userMessage,
  setUserMessage,
  streaming,
  hasApiKey,
  activePersona,
  isSystemPersonaActive,
  response,
  pendingWrites,
  handleRun,
  handleStop,
  onClear,
}: AITabInputBarProps) {
  const settings = usePersonaStore((s) => s.settings);
  const runKeys = getDisplayChord("ai-run", settings);

  return (
    <div className="shrink-0 border-t border-border p-2 space-y-1.5">
      <textarea
        value={userMessage}
        onChange={(e) => setUserMessage(e.target.value)}
        onKeyDown={(e) => {
          if (aiRunChordMatches(e.nativeEvent, settings)) {
            e.preventDefault();
            handleRun();
          }
        }}
        placeholder={
          isSystemPersonaActive
            ? `Use the panel above to run ${activePersona?.name ?? "this agent"}`
            : activePersona
              ? `Ask ${activePersona.name}… (${runKeys} to run)`
              : "Select a persona first"
        }
        disabled={!activePersona || streaming || isSystemPersonaActive}
        rows={3}
        className="w-full resize-none rounded-md border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <div className="flex items-center gap-1.5">
        {streaming ? (
          <button
            onClick={handleStop}
            className="flex-1 rounded-md bg-red-500/20 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
          >
            ■ Stop
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={!activePersona || !hasApiKey || !userMessage.trim() || isSystemPersonaActive}
            className="flex-1 rounded-md bg-accent py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ▶ Run {activePersona?.icon ?? ""}
          </button>
        )}
        {(response || pendingWrites.length > 0) && !streaming && (
          <button
            onClick={onClear}
            title="Clear"
            className="rounded-md px-2 py-1.5 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export function AITabStrategyBadge({
  strategy,
  streaming,
  label,
}: {
  strategy: ContextStrategy | null;
  streaming: boolean;
  label: string;
}) {
  if (!strategy || streaming) return null;
  return (
    <div className="shrink-0 border-t border-border px-3 py-1">
      <p className="text-[9px] text-text-muted opacity-70">{label}</p>
    </div>
  );
}
