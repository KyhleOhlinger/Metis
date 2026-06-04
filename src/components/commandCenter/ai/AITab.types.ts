import type { ExecutionScope, HistoryEntry, Persona } from "@/types/persona";
import type { usePersonaStore } from "@/store/usePersonaStore";
import type { FileNode } from "@/store/useStore";

export interface AITabProps {
  onOpenSettings: () => void;
  activePersona: Persona | undefined;
  personas: Persona[];
  activePersonaId: string | null;
  settings: ReturnType<typeof usePersonaStore.getState>["settings"];
  history: HistoryEntry[];
  activeFileContent: string;
  activeFilePath: string | null;
  vaultPath: string | null;
  files: FileNode[];
  initialScope?: ExecutionScope;
  onSelectPersona: (id: string) => void;
  onAddHistory: (entry: HistoryEntry) => void;
  onClearHistory: () => void;
  onNewPersona: () => void;
}
