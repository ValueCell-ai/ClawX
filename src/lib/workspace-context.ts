import { DEFAULT_WORKSPACE_CWD } from '@shared/workspace';

export { DEFAULT_WORKSPACE_CWD };

export type WorkspaceResolutionSource = 'session' | 'global' | 'default';

export type WorkspaceResolution = {
  cwd: string;
  source: WorkspaceResolutionSource;
  readOnly: boolean;
};

type WorkspaceSessionLike = {
  key?: string;
  workspacePath?: string | null;
  createdLocally?: boolean;
};

export function normalizeWorkspacePath(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  if (/^[\\/]+$/.test(trimmed)) return '/';

  const driveRoot = trimmed.match(/^([A-Za-z]:)([\\/]+)$/);
  if (driveRoot) return `${driveRoot[1]}${driveRoot[2][0]}`;

  return trimmed.replace(/[\\/]+$/, '');
}

function slashPath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function isDefaultWorkspacePath(value: string | null | undefined): boolean {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) return false;
  const slashed = slashPath(normalized);
  return slashed === DEFAULT_WORKSPACE_CWD
    || /^\/(?:Users|home)\/[^/]+\/\.openclaw\/workspace$/i.test(slashed)
    || /^[A-Za-z]:\/Users\/[^/]+\/\.openclaw\/workspace$/i.test(slashed);
}

export function formatWorkspacePath(workspace: string): string {
  const normalized = normalizeWorkspacePath(workspace) ?? '';
  if (!normalized) return '';

  const slashed = slashPath(normalized);
  const windowsHome = slashed.match(/^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/i);
  if (windowsHome) return `~${slashed.slice(windowsHome[0].length) || ''}`;

  const posixHome = slashed.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/i);
  if (posixHome) return `~${slashed.slice(posixHome[0].length) || ''}`;

  return normalized;
}

export function getWorkspaceDisplayLabel(
  workspace: string | null | undefined,
  defaultLabel: string,
  workspaceLabels: Record<string, string> = {},
): string {
  const normalized = normalizeWorkspacePath(workspace) ?? DEFAULT_WORKSPACE_CWD;
  if (isDefaultWorkspacePath(normalized)) return defaultLabel;
  return workspaceLabels[normalized]?.trim() || formatWorkspacePath(normalized);
}

export function resolveEffectiveWorkspace(input: {
  session?: WorkspaceSessionLike | null;
  globalWorkspace?: string | null;
  defaultWorkspace?: string;
}): WorkspaceResolution {
  const defaultWorkspace = normalizeWorkspacePath(input.defaultWorkspace) ?? DEFAULT_WORKSPACE_CWD;
  const sessionWorkspace = normalizeWorkspacePath(input.session?.workspacePath);
  if (sessionWorkspace) {
    return { cwd: sessionWorkspace, source: 'session', readOnly: true };
  }

  const globalWorkspace = normalizeWorkspacePath(input.globalWorkspace);
  if (!input.session || input.session.createdLocally) {
    return {
      cwd: globalWorkspace ?? defaultWorkspace,
      source: globalWorkspace ? 'global' : 'default',
      readOnly: false,
    };
  }

  return { cwd: defaultWorkspace, source: 'default', readOnly: true };
}

export function getSessionWorkspaceForGrouping(
  session: WorkspaceSessionLike,
  globalWorkspace?: string | null,
): string {
  const sessionWorkspace = normalizeWorkspacePath(session.workspacePath);
  if (sessionWorkspace) return sessionWorkspace;

  if (session.createdLocally) {
    return normalizeWorkspacePath(globalWorkspace) ?? DEFAULT_WORKSPACE_CWD;
  }

  return DEFAULT_WORKSPACE_CWD;
}
