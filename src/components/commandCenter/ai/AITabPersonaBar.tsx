import { useStore } from "@/store/useStore";
import { SYSTEM_PERSONA_IDS } from "@/systemPersonas/registry";
import type { Persona } from "@/types/persona";

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
      data-persona-id={persona.id}
      onClick={onSelect}
      title={`${persona.name} · ${persona.model} — or drag a file/folder here to run`}
      className={[
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all",
        streaming && active
          ? "animate-pulse bg-accent/30 text-accent ring-1 ring-accent"
          : active
            ? "bg-accent/20 text-accent ring-1 ring-accent"
            : "bg-surface-overlay text-text-muted hover:text-text-primary",
      ].join(" ")}
    >
      <span>{persona.icon}</span>
      <span>{persona.name}</span>
    </button>
  );
}

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
    <div className="shrink-0 border-b border-border px-2 py-2 space-y-1.5 max-h-36 overflow-y-auto">
      {!hasPersonas && (
        <p className="px-1 text-[10px] text-text-muted">
          No personas yet — create one below or open Settings to manage agents.
        </p>
      )}
      {systemChips.length > 0 && (
        <div>
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">
            System
          </p>
          <div className="flex items-center gap-1 flex-wrap">
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
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">
            Custom
          </p>
          <div className="flex items-center gap-1 flex-wrap">
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
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => useStore.getState().setEditorTab("agent-history")}
          title="Open agent run log in main view"
          className="rounded-full px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-overlay hover:text-accent transition-colors"
        >
          Run log ↗
        </button>
        <button
          onClick={onNewPersona}
          title="New persona"
          className="rounded-full px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
        >
          +
        </button>
        <button
          onClick={onOpenSettings}
          title="Manage personas"
          className="ml-auto rounded p-0.5 text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
