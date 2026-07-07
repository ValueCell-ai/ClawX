import type { ChatSession } from '@/stores/chat';
import {
  DEFAULT_WORKSPACE_CWD,
  getSessionWorkspaceForGrouping,
  getWorkspaceDisplayLabel,
  isDefaultWorkspacePath,
} from '@/lib/workspace-context';

export type WorkspaceSessionEntry<TSession> = {
  session: TSession;
  activityMs: number;
};

export type WorkspaceSessionGroup<TSession> = {
  workspacePath: string;
  label: string;
  sessions: Array<WorkspaceSessionEntry<TSession>>;
};

function getSessionCreatedAtMsFromKey(sessionKey: string): number | undefined {
  const match = sessionKey.match(/(?:^|:)session-(\d{11,})(?=$|:)/);
  if (!match) return undefined;

  const createdAtMs = Number(match[1]);
  return Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : undefined;
}

export function getSessionActivityMs(
  session: ChatSession,
  sessionLastActivity: Record<string, number>,
): number {
  const lastActivityMs = sessionLastActivity[session.key];
  if (Number.isFinite(lastActivityMs) && lastActivityMs > 0) return lastActivityMs;

  if (typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) && session.updatedAt > 0) {
    return session.updatedAt;
  }

  return getSessionCreatedAtMsFromKey(session.key) ?? 0;
}

function getCanonicalWorkspacePathForGrouping(
  session: ChatSession,
  globalWorkspace?: string | null,
): string {
  const workspacePath = getSessionWorkspaceForGrouping(session, globalWorkspace);
  return isDefaultWorkspacePath(workspacePath) ? DEFAULT_WORKSPACE_CWD : workspacePath;
}

function compareWorkspaceGroups<TSession>(
  left: WorkspaceSessionGroup<TSession>,
  right: WorkspaceSessionGroup<TSession>,
): number {
  const leftDefault = isDefaultWorkspacePath(left.workspacePath);
  const rightDefault = isDefaultWorkspacePath(right.workspacePath);
  if (leftDefault && !rightDefault) return -1;
  if (!leftDefault && rightDefault) return 1;

  const byLabel = left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' });
  if (byLabel !== 0) return byLabel;
  return left.workspacePath.localeCompare(right.workspacePath, undefined, { numeric: true, sensitivity: 'base' });
}

export function groupSessionsByWorkspace<TSession extends ChatSession>(
  sessions: readonly TSession[],
  sessionLastActivity: Record<string, number>,
  defaultWorkspaceLabel: string,
  globalWorkspace?: string | null,
): Array<WorkspaceSessionGroup<TSession>> {
  const groupByWorkspace = new Map<string, WorkspaceSessionGroup<TSession>>();

  for (const session of sessions) {
    const workspacePath = getCanonicalWorkspacePathForGrouping(session, globalWorkspace);
    let group = groupByWorkspace.get(workspacePath);
    if (!group) {
      group = {
        workspacePath,
        label: getWorkspaceDisplayLabel(workspacePath, defaultWorkspaceLabel),
        sessions: [],
      };
      groupByWorkspace.set(workspacePath, group);
    }

    group.sessions.push({
      session,
      activityMs: getSessionActivityMs(session, sessionLastActivity),
    });
  }

  return Array.from(groupByWorkspace.values())
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((left, right) => right.activityMs - left.activityMs),
    }))
    .sort(compareWorkspaceGroups);
}
