import type { FilePreviewTarget } from '@/components/file-preview/types';
import type { WorkspaceTreeNode } from './workspace-tree';

const normalizeRoot = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');

export function workspaceRelativePath(file: FilePreviewTarget | null, workspace: string): string | null {
  if (!file || !workspace || file.attachmentFileRef) return null;
  const root = normalizeRoot(workspace);
  if (file.workspaceFileRef) {
    return normalizeRoot(file.workspaceFileRef.workspaceRoot) === root ? file.workspaceFileRef.relativePath : null;
  }
  const path = file.filePath.replace(/\\/g, '/');
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

export function visibleWorkspaceChildren(root: WorkspaceTreeNode, query: string, showHidden: boolean): WorkspaceTreeNode[] {
  const search = query.trim().toLocaleLowerCase();
  const visit = (nodes: WorkspaceTreeNode[], parentMatches = false): WorkspaceTreeNode[] => nodes.flatMap(node => {
    if (!showHidden && node.name.startsWith('.')) return [];
    const matches = parentMatches || node.relPath.toLocaleLowerCase().includes(search);
    if (!node.isDir) return !search || matches ? [node] : [];
    const children = visit(node.children ?? [], matches);
    return !search || matches || children.length ? [{ ...node, children }] : [];
  });
  return visit(root.children ?? []);
}

export function expandedSearchPaths(nodes: WorkspaceTreeNode[]): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  const visit = (items: WorkspaceTreeNode[]) => items.forEach(node => {
    if (node.isDir) { result[node.relPath] = true; visit(node.children ?? []); }
  });
  visit(nodes);
  return result;
}
