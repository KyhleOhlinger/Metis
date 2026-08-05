/** Vault and editor index types shared across the app store. */

export interface FileNode {
  name: string;
  /** Absolute path on the local filesystem */
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface VaultData {
  path: string;
  files: FileNode[];
  is_metis_vault: boolean;
  vault_hint?: string;
  default_image_dir?: string;
  planner_mode?: string | null;
  planner_setup_required?: boolean;
}

export interface NoteMetadata {
  name: string;
  path: string;
  aliases?: string[];
  status?: string;
  date?: string;
  parent?: string;
  related?: string[];
}

export interface AssetMetadata {
  name: string;
  path: string;
}

export type DiskWrite = { path: string; content?: string };

export type EditorNavigateTarget = {
  path: string;
  offset: number;
  matchEnd?: number;
};
