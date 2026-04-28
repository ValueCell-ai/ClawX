import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { testHome } = vi.hoisted(() => ({
  testHome: `/tmp/clawx-openclaw-workspace-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

import {
  mergeClawXSection,
  removeChatFirstBootstrapFiles,
  stripFirstRunSection,
} from '../../electron/utils/openclaw-workspace';

beforeEach(async () => {
  await rm(testHome, { recursive: true, force: true });
});

describe('stripFirstRunSection', () => {
  it('removes the First Run section when it exists', () => {
    const input = [
      '# AGENTS.md',
      '',
      'Some preamble content.',
      '',
      '## First Run',
      '',
      "If `BOOTSTRAP.md` exists, that's your birth certificate. Follow it, figure out who you are, then delete it. You won't need it again.",
      '',
      '## Other Section',
      '',
      'Other content.',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).not.toContain('## First Run');
    expect(result).not.toContain('BOOTSTRAP.md');
    expect(result).toContain('# AGENTS.md');
    expect(result).toContain('Some preamble content.');
    expect(result).toContain('## Other Section');
    expect(result).toContain('Other content.');
  });

  it('returns content unchanged when no First Run section exists', () => {
    const input = '# AGENTS.md\n\nSome content.\n';
    expect(stripFirstRunSection(input)).toBe(input);
  });

  it('handles First Run section at end of file', () => {
    const input = [
      '# AGENTS.md',
      '',
      '## First Run',
      '',
      'Bootstrap text.',
      '',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).not.toContain('## First Run');
    expect(result).not.toContain('Bootstrap text');
    expect(result).toContain('# AGENTS.md');
  });

  it('does not collapse adjacent sections', () => {
    const input = [
      '## Section A',
      'content a',
      '',
      '## First Run',
      '',
      'bootstrap text',
      '',
      '## Section B',
      'content b',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).toContain('## Section A');
    expect(result).toContain('content a');
    expect(result).toContain('## Section B');
    expect(result).toContain('content b');
    expect(result).not.toContain('## First Run');
  });

  it('does not remove sections with similar but different names', () => {
    const input = [
      '## First Run Setup',
      'This should stay.',
      '',
      '## First Run',
      'This should go.',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).toContain('## First Run Setup');
    expect(result).toContain('This should stay.');
    expect(result).not.toContain('This should go.');
  });

  it('collapses triple blank lines left by removal', () => {
    const input = [
      'before',
      '',
      '',
      '## First Run',
      '',
      'text',
      '',
      '',
      'after',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('before');
    expect(result).toContain('after');
  });

  it('still changes AGENTS content when only First Run is removed', () => {
    const section = [
      '## ClawX Environment',
      '',
      'You are ClawX.',
    ].join('\n');
    const original = [
      '# AGENTS.md',
      '',
      '## First Run',
      '',
      "If `BOOTSTRAP.md` exists, that's your birth certificate. Follow it, figure out who you are, then delete it. You won't need it again.",
      '',
      '## Session Startup',
      '',
      'Read SOUL.md first.',
      '',
      '<!-- clawx:begin -->',
      '## ClawX Environment',
      '',
      'You are ClawX.',
      '<!-- clawx:end -->',
      '',
    ].join('\n');

    const stripped = stripFirstRunSection(original);
    const merged = mergeClawXSection(stripped, section);

    expect(merged).not.toBe(original);
    expect(merged).not.toContain('## First Run');
    expect(merged).toContain('## Session Startup');
    expect(merged).toContain('<!-- clawx:begin -->');
    expect(merged).toContain('<!-- clawx:end -->');
  });
});

describe('removeChatFirstBootstrapFiles', () => {
  it('removes only BOOTSTRAP.md from the default workspace', async () => {
    const workspaceDir = join(testHome, '.openclaw', 'workspace');
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, 'BOOTSTRAP.md'), 'chat-first bootstrap', 'utf-8');
    await writeFile(join(workspaceDir, 'SOUL.md'), 'existing soul', 'utf-8');

    await removeChatFirstBootstrapFiles();

    await expect(access(join(workspaceDir, 'BOOTSTRAP.md'))).rejects.toThrow();
    await expect(readFile(join(workspaceDir, 'SOUL.md'), 'utf-8')).resolves.toBe('existing soul');
  });

  it('removes BOOTSTRAP.md from configured agent workspaces', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const mainWorkspace = join(openclawDir, 'workspace-main');
    const agentWorkspace = join(openclawDir, 'workspace-agent');
    await mkdir(mainWorkspace, { recursive: true });
    await mkdir(agentWorkspace, { recursive: true });
    await writeFile(join(mainWorkspace, 'BOOTSTRAP.md'), 'main bootstrap', 'utf-8');
    await writeFile(join(agentWorkspace, 'BOOTSTRAP.md'), 'agent bootstrap', 'utf-8');
    await writeFile(
      join(openclawDir, 'openclaw.json'),
      JSON.stringify({
        agents: {
          defaults: { workspace: mainWorkspace },
          list: [{ workspace: agentWorkspace }],
        },
      }),
      'utf-8',
    );

    await removeChatFirstBootstrapFiles();

    await expect(access(join(mainWorkspace, 'BOOTSTRAP.md'))).rejects.toThrow();
    await expect(access(join(agentWorkspace, 'BOOTSTRAP.md'))).rejects.toThrow();
  });
});
