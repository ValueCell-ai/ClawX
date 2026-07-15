import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { expandPath } from '../utils/paths';

export type AcpSessionAccessContext = {
  sessionKey: string;
  generation: number;
  workspaceRoot: string;
  executionCwd: string;
};

async function canonicalDirectory(input: string, label: string): Promise<string> {
  const canonicalPath = await realpath(expandPath(input));
  const directoryStat = await stat(canonicalPath);
  if (!directoryStat.isDirectory()) throw new Error(`${label} must be a directory`);
  return canonicalPath;
}

function isInside(child: string, parent: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === ''
    || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

export class AcpSessionAccessRegistry {
  private activeGrant: AcpSessionAccessContext | null = null;

  async prepareGrant(input: AcpSessionAccessContext): Promise<AcpSessionAccessContext> {
    const workspaceRoot = await canonicalDirectory(input.workspaceRoot, 'ACP workspace root');
    const executionCwd = await canonicalDirectory(input.executionCwd, 'ACP execution cwd');
    if (!isInside(executionCwd, workspaceRoot)) {
      throw new Error('ACP execution cwd must be inside the workspace root');
    }
    return { ...input, workspaceRoot, executionCwd };
  }

  snapshot(): AcpSessionAccessContext | null {
    return this.activeGrant ? { ...this.activeGrant } : null;
  }

  commitGrant(context: AcpSessionAccessContext): void {
    this.activeGrant = { ...context };
  }

  restore(snapshot: AcpSessionAccessContext | null): void {
    this.activeGrant = snapshot ? { ...snapshot } : null;
  }

  get(sessionKey: string, generation: number): AcpSessionAccessContext | null {
    if (this.activeGrant?.sessionKey !== sessionKey || this.activeGrant.generation !== generation) return null;
    return { ...this.activeGrant };
  }
}
