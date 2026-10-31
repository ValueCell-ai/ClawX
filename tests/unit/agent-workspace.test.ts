import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentInstructionsSummary, loadAgentWorkspace } from '@/lib/agent-workspace';
import { listDir, readTextFile } from '@/lib/file-preview-client';

vi.mock('@/lib/file-preview-client', () => ({ listDir: vi.fn(), readTextFile: vi.fn() }));
const entry = (name: string, isDir = false) => ({ name, isDir, path: `/workspace/${name}`, size: 30 });

describe('native assistant workspace', () => {
  beforeEach(() => vi.resetAllMocks());
  it('uses a bounded literal excerpt without rewriting the instruction file', () => {
    const source = '# SOUL.md\n\n**Research** with [primary sources](https://example.com).\nKeep claims precise.\n\nAdditional rules.';
    expect(agentInstructionsSummary(source)).toBe('Research with primary sources. Keep claims precise.');
    expect(source).toContain('Additional rules.');
    expect(agentInstructionsSummary('# Heading only')).toBe('');
    expect(agentInstructionsSummary('# Working style\nUse primary sources.')).toBe('Use primary sources.');
  });
  it('lists native files and the latest memory note without reading memory contents', async () => {
    vi.mocked(listDir).mockResolvedValueOnce({ ok: true, entries: [entry('SOUL.md'), entry('AGENTS.md'), entry('MEMORY.md'), entry('auth-profiles.json'), entry('memory', true)] });
    vi.mocked(listDir).mockResolvedValueOnce({ ok: true, entries: [entry('2026-09-02.md'), entry('2026-10-03.md'), entry('other.txt')] });
    vi.mocked(readTextFile).mockResolvedValue({ ok: true, content: 'Work style', readOnly: false });
    const snapshot = await loadAgentWorkspace('/workspace');
    expect(snapshot).toMatchObject({ workspace: '/workspace', instructions: 'Work style', readOnly: false, error: null });
    expect(snapshot.files.map(file => file.fileName)).toEqual(['SOUL.md', 'AGENTS.md', 'MEMORY.md', '2026-10-03.md']);
    expect(readTextFile).toHaveBeenCalledExactlyOnceWith('/workspace/SOUL.md');
  });
  it('keeps missing, unavailable and read-only instructions distinct', async () => {
    vi.mocked(listDir).mockResolvedValueOnce({ ok: true, entries: [entry('AGENTS.md')] });
    expect(await loadAgentWorkspace('/workspace')).toMatchObject({ instructions: null, error: null });
    expect(readTextFile).not.toHaveBeenCalled();
    vi.mocked(listDir).mockResolvedValueOnce({ ok: false, error: 'notFound' });
    expect(await loadAgentWorkspace('/gone')).toMatchObject({ error: 'notFound', readOnly: true });
    vi.mocked(listDir).mockResolvedValueOnce({ ok: true, entries: [entry('SOUL.md')] });
    vi.mocked(readTextFile).mockResolvedValue({ ok: true, content: 'External instructions', readOnly: true });
    expect(await loadAgentWorkspace('/external')).toMatchObject({ instructions: 'External instructions', readOnly: true });
  });
});
