import { SYSTEM_PERSONA_IDS } from "@/systemPersonas/registry";
import type { Persona } from "@/types/persona";
import { openAgentRunLog } from "@/utils/openAgentRunLog";
import { SectionAction, SubsectionLabel } from "../shared/ui";

interface AITabPersonaBarProps {
  personas: Persona[];
  activePersonaId: string | null;
  streaming: boolean;
  onSelectPersona: (id: string) => void;
  onNewPersona: () => void;
  onOpenSettings: () => void;
}

function PersonaChip({
  persona,
  active,
  streaming,
  onSelect,
}: {
  persona: Persona;
  active: boolean;
  streaming: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-persona-id={persona.id}
      onClick={onSelect}
      title={`${persona.name} · ${persona.model} — or drag a file/folder here to run`}
      className={[
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all",
        streaming && active
          ? "animate-pulse bg-accent/30 text-accent ring-1 ring-accent"
          : active
            ? "bg-accent/20 text-accent ring-1 ring-accent"
            : "bg-surface-base/60 text-text-muted hover:text-text-primary",
      ].join(" ")}
    >
      <span>{persona.icon}</span>
      <span>{persona.name}</span>
    </button>
  );
}

const actionBtnCls =
  "rounded-full px-2 py-0.5 text-[10px] text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary";

export function AITabPersonaBar({
  personas,
  activePersonaId,
  streaming,
  onSelectPersona,
  onNewPersona,
  onOpenSettings,
}: AITabPersonaBarProps) {
  const systemChips = personas.filter((p) => !p.disabled && SYSTEM_PERSONA_IDS.has(p.id));
  const customChips = personas.filter((p) => !p.disabled && !SYSTEM_PERSONA_IDS.has(p.id));
  const hasPersonas = systemChips.length > 0 || customChips.length > 0;

  return (
    <div className="shrink-0 border-b border-border px-3 py-2.5">
      <div className="rounded-md border border-border bg-surface-overlay p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SubsectionLabel>Agents</SubsectionLabel>
          <button
            type="button"
            onClick={() => openAgentRunLog()}
            title="Open full agent run log in main view (⌘⇧L)"
            className="rounded-full px-2 py-0.5 text-[10px] font-medium text-accent/90 transition-colors hover:bg-surface-overlay hover:text-accent"
          >
            Run log ↗
          </button>
        </div>

        {!hasPersonas && (
          <p className="text-[10px] text-text-muted">
            No personas yet — create one or open settings to configure agents.
          </p>
        )}

        {hasPersonas && (
          <div className="space-y-2">
            {systemChips.length > 0 && (
              <div>
                <SubsectionLabel>System</SubsectionLabel>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {systemChips.map((p) => (
                    <PersonaChip
                      key={p.id}
                      persona={p}
                      active={activePersonaId === p.id}
                      streaming={streaming}
                      onSelect={() => onSelectPersona(p.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            {customChips.length > 0 && (
              <div>
                <SubsectionLabel>Custom</SubsectionLabel>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {customChips.map((p) => (
                    <PersonaChip
                      key={p.id}
                      persona={p}
                      active={activePersonaId === p.id}
                      streaming={streaming}
                      onSelect={() => onSelectPersona(p.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
          <button type="button" onClick={onNewPersona} title="New persona" className={actionBtnCls}>
            + New persona
          </button>
          <SectionAction onClick={onOpenSettings}>AI settings</SectionAction>
        </div>
      </div>
    </div>
  );
}
