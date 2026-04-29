/**
 * Agent workspace file tree.
 *
 * Loads the directory tree rooted at `agent.workspace` (e.g.
 * `~/.openclaw/workspace` for the default agent) for the
 * `WorkspaceBrowserBody` / artifact-panel browser tab.  Strictly scoped to that one directory
 * so sibling configuration paths (`runs/`, `agents/`,
 * `auth-profiles.json`, …) under `~/.openclaw` are never exposed.
 */
import { listTree, type TreeNode } from './api-client';
import {
  basenameOf,
  classifyFileExt,
  extnameOf,
  getMimeTypeForExt,
  type FileContentType,
} from './generated-files';

export interface WorkspaceTreeNode {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  /** True when the file's mtime is at or after the provided run start time. */
  isFresh?: boolean;
  ext?: string;
  mimeType?: string;
  contentType?: FileContentType;
  children?: WorkspaceTreeNode[];
}

export interface LoadWorkspaceTreeResult {
  root: WorkspaceTreeNode;
  truncated: boolean;
}

export interface LoadWorkspaceTreeOptions {
  runStartedAt?: number | null;
  maxDepth?: number;
  maxNodes?: number;
  includeHidden?: boolean;
}

function decorate(node: TreeNode, runStartedAt: number | null): WorkspaceTreeNode {
  if (node.isDir) {
    const children = (node.children ?? []).map((child) => decorate(child, runStartedAt));
    return {
      name: node.name,
      relPath: node.relPath,
      absPath: node.absPath,
      isDir: true,
      mtime: node.mtime,
      children,
    };
  }
  const ext = extnameOf(node.absPath);
  const isFresh =
    runStartedAt != null && typeof node.mtime === 'number' && node.mtime >= runStartedAt;
  return {
    name: node.name,
    relPath: node.relPath,
    absPath: node.absPath,
    isDir: false,
    size: node.size,
    mtime: node.mtime,
    ext,
    mimeType: getMimeTypeForExt(ext),
    contentType: classifyFileExt(ext),
    isFresh,
  };
}

export async function loadWorkspaceTree(
  workspace: string,
  opts: LoadWorkspaceTreeOptions = {},
): Promise<LoadWorkspaceTreeResult | null> {
  if (!workspace) return null;
  const result = await listTree(workspace, {
    maxDepth: opts.maxDepth,
    maxNodes: opts.maxNodes,
    includeHidden: opts.includeHidden,
  });
  if (!result.ok || !result.root) {
    return null;
  }
  const runStartedAt = opts.runStartedAt ?? null;
  const root = decorate(result.root, runStartedAt);
  // Use the workspace's directory name for the synthetic root label so the
  // tree shows e.g. `workspace` instead of an absolute path.
  root.name = basenameOf(workspace) || root.name;
  return { root, truncated: !!result.truncated };
}

export function findNode(root: WorkspaceTreeNode, relPath: string): WorkspaceTreeNode | null {
  if (!root) return null;
  if (root.relPath === relPath) return root;
  if (!root.children) return null;
  for (const child of root.children) {
    const hit = findNode(child, relPath);
    if (hit) return hit;
  }
  return null;
}

export function collectInitialExpanded(
  root: WorkspaceTreeNode | null,
  initialDepth = 1,
): Set<string> {
  const out = new Set<string>();
  if (!root) return out;
  const walk = (node: WorkspaceTreeNode, depth: number): void => {
    if (!node.isDir) return;
    if (depth <= initialDepth) {
      out.add(node.relPath);
    }
    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}
