import { FileNode } from "../store/useStore";

/** Sort helper: directories first, then alphabetical. */
function sorted(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Recursively update every path in a node subtree after a move. */
function rebasePaths(node: FileNode, oldBase: string, newBase: string): FileNode {
  const newPath = newBase + node.path.slice(oldBase.length);
  return {
    ...node,
    path: newPath,
    children: node.children?.map((c) => rebasePaths(c, oldBase, newBase)),
  };
}

/**
 * Remove the node at `srcPath` from the tree.
 * Returns `[newTree, removedNode]`.
 */
export function removeNode(
  files: FileNode[],
  srcPath: string,
): [FileNode[], FileNode | null] {
  let found: FileNode | null = null;
  const result: FileNode[] = [];

  for (const node of files) {
    if (node.path === srcPath) {
      found = node;
    } else if (node.is_dir && node.children) {
      const [newChildren, f] = removeNode(node.children, srcPath);
      if (f) found = f;
      result.push({ ...node, children: newChildren });
    } else {
      result.push(node);
    }
  }
  return [result, found];
}

/**
 * Insert `node` into the folder at `destDirPath`.
 * Pass `vaultPath` so that vault-root drops work correctly.
 */
export function insertNode(
  files: FileNode[],
  destDirPath: string,
  node: FileNode,
  vaultPath: string,
): FileNode[] {
  if (destDirPath === vaultPath) {
    return sorted([...files, node]);
  }
  return files.map((f) => {
    if (f.path === destDirPath && f.is_dir) {
      return { ...f, children: sorted([...(f.children ?? []), node]) };
    }
    if (f.is_dir && f.children) {
      return {
        ...f,
        children: insertNode(f.children, destDirPath, node, vaultPath),
      };
    }
    return f;
  });
}

/**
 * Move `srcPath` into `destDirPath` entirely in-memory.
 * Returns the updated file tree (or `null` if srcPath was not found).
 */
export function moveNodeInTree(
  files: FileNode[],
  srcPath: string,
  destDirPath: string,
  vaultPath: string,
): FileNode[] | null {
  const [treeWithout, node] = removeNode(files, srcPath);
  if (!node) return null;

  const newNodePath = destDirPath + "/" + node.name;
  const movedNode = rebasePaths(node, node.path, newNodePath);

  return insertNode(treeWithout, destDirPath, movedNode, vaultPath);
}
