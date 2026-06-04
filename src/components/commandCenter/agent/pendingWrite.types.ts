// ── Pending write types (agent-initiated file operations) ─────────────────────

export type PendingWriteStatus = "pending" | "applying" | "done" | "error";

export type PendingWriteTool =
  | "write_to_current_file"
  | "append_to_current_file"
  | "prepend_to_current_file"
  | "insert_at_cursor"
  | "create_new_note";

export interface PendingWrite {
  /** Unique ID matching the tool_call id from the provider */
  id: string;
  tool: PendingWriteTool;
  /**
   * For write/append/prepend/insert tools: absolute path of the active file.
   * For create_new_note: vault-relative path.
   */
  path: string;
  /** For append/prepend/insert: the chunk to add.  For write/create: the full content. */
  content: string;
  /**
   * Character offset where insert_at_cursor should place the content.
   * Captured at run-time so the insertion point is stable even if the user
   * moves their cursor before clicking Apply.
   */
  cursorOffset?: number;
  status: PendingWriteStatus;
  errorMsg?: string;
}

