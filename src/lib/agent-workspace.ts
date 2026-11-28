import { listDir, readTextFile } from './file-preview-client';
import type { FilePreviewTarget } from '@/components/file-preview/types';

export const AGENT_CONTEXT_FILES = ['SOUL.md', 'AGENTS.md', 'USER.md', 'IDENTITY.md', 'MEMORY.md'] as const;
export type AgentContextFileName = typeof AGENT_CONTEXT_FILES[number];

export interface AgentWorkspaceSnapshot {
  workspace: string;
  instructions: string | null;
  readOnly: boolean;
  files: FilePreviewTarget[];
  error: string | null;
}

/** A bounded excerpt of the real SOUL.md, not a second stored assistant profile. */
export function agentInstructionsSummary(source: string): string {
  const paragraph = source.replace(/^\uFEFF/, '').replace(/^#{1,6}\s+.*$/gm, '').split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .find(block => block && !block.startsWith('#') && !block.startsWith('```') && !/^[-*_]{3,}$/.test(block));
  return (paragraph ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '').replace(/\s+/g, ' ').slice(0, 180);
}

/** Read only the standard root files; memory contents are opened on demand. */
export async function loadAgentWorkspace(workspace: string): Promise<AgentWorkspaceSnapshot> {
  const result = await listDir(workspace);
  if (!result.ok) return { workspace, instructions: null, readOnly: true, files: [], error: result.error ?? 'unavailable' };
  const files: FilePreviewTarget[] = AGENT_CONTEXT_FILES.flatMap(name => {
    const entry = result.entries?.find(entry => entry.name === name && !entry.isDir);
    return entry ? [{ filePath: entry.path, fileName: name, ext: '.md', mimeType: 'text/markdown', contentType: 'document' as const, size: entry.size }] : [];
  });
  const memoryDirectory = result.entries?.find(entry => entry.name === 'memory' && entry.isDir);
  if (memoryDirectory) {
    const memory = await listDir(memoryDirectory.path);
    for (const entry of (memory.entries ?? []).filter(entry => !entry.isDir && /^\d{4}-\d{2}-\d{2}.*\.md$/.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 1)) {
      files.push({ filePath: entry.path, fileName: entry.name, ext: '.md', mimeType: 'text/markdown', contentType: 'document', size: entry.size });
    }
  }
  const soul = files.find(file => file.fileName === 'SOUL.md');
  if (!soul) return { workspace, instructions: null, readOnly: true, files, error: null };
  const content = await readTextFile(soul.filePath);
  if (!content.ok) return { workspace, instructions: null, readOnly: true, files, error: content.error ?? 'unavailable' };
  return { workspace, instructions: content.content ?? '', readOnly: !!content.readOnly, files, error: null };
}
