import {
  HANDWRITING_OCR_PERSONA_ID,
  LIBRARIAN_PERSONA_ID,
  TASK_PERSONA_ID,
} from "../types/persona";

/** System Default personas — fixed IDs, dedicated panels, not user-editable. */
export const SYSTEM_PERSONA_IDS = new Set<string>([
  LIBRARIAN_PERSONA_ID,
  TASK_PERSONA_ID,
  HANDWRITING_OCR_PERSONA_ID,
]);

export function isSystemPersona(personaId: string): boolean {
  return SYSTEM_PERSONA_IDS.has(personaId);
}

/** Max images per Handwriting OCR batch (vision API cost guard). */
export const MAX_HANDWRITING_OCR_BATCH = 25;
