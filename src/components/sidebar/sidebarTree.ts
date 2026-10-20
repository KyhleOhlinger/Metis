import type { FileNode } from "@/store/useStore";
import { isSupernoteNoteFile } from "@/constants/supernote";

/** Folders stay in the tree. `.note` binaries are opened from their markdown companion. */
export function isSidebarTreeEntry(node: Pick<FileNode, "is_dir" | "name">): boolean {
  return node.is_dir || !isSupernoteNoteFile(node.name);
}
