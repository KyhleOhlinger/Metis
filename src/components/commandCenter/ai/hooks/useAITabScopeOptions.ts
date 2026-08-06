import { useMemo } from "react";
import type { ExecutionScope } from "@/types/persona";
import type { FileNode } from "@/store/useStore";

export function useAITabScopeOptions(files: FileNode[]) {
  const folders = useMemo(() => {
    const result: { path: string; name: string }[] = [];
    function walk(nodes: FileNode[], depth = 0) {
      for (const n of nodes) {
        if (n.is_dir) {
          result.push({ path: n.path, name: "  ".repeat(depth) + n.name });
          if (n.children) walk(n.children, depth + 1);
        }
      }
    }
    walk(files);
    return result;
  }, [files]);

  const noteFiles = useMemo(() => {
    const result: { path: string; label: string }[] = [];
    function walk(nodes: FileNode[], prefix = "") {
      for (const n of nodes) {
        if (n.is_dir) {
          if (n.children) walk(n.children, prefix + n.name + "/");
        } else if (n.name.endsWith(".md")) {
          result.push({ path: n.path, label: prefix + n.name });
        }
      }
    }
    walk(files);
    return result;
  }, [files]);

  return { folders, noteFiles };
}

export function scopeLabelFor(
  scope: ExecutionScope,
  activeFilePath: string | null,
): string {
  if (scope.type === "current-file") {
    return activeFilePath
      ? (activeFilePath.split("/").pop() ?? "Current File")
      : "Current File";
  }
  if (scope.type === "specific-file") {
    return scope.filePath.split("/").pop() ?? "File";
  }
  if (scope.type === "specific-folder") {
    return scope.folderPath.split("/").pop() ?? "Folder";
  }
  return "Full Vault";
}
