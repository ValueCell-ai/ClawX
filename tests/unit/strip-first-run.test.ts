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
  ensureClawXContext,
  ensureClawXDefaultIdentity,
  ensureClawXIdentityFile,
  mergeClawXSection,
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

describe('ensureClawXIdentityFile', () => {
  it('writes a default ClawX identity when the workspace has none', async () => {
    const workspaceDir = join(testHome, '.openclaw', 'workspace');
    await mkdir(workspaceDir, { recursive: true });

    await ensureClawXIdentityFile(workspaceDir);

    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.toContain('ClawX');
  });

  it('replaces the untouched OpenClaw identity template but preserves custom identities', async () => {
    const workspaceDir = join(testHome, '.openclaw', 'workspace');
    await mkdir(workspaceDir, { recursive: true });

    await writeFile(
      join(workspaceDir, 'IDENTITY.md'),
      [
        '# IDENTITY.md - Who Am I?',
        '',
        '_Fill this in during your first conversation. Make it yours._',
        '',
        '- **Name:**',
        '  _(pick something you like)_',
        '- **Creature:**',
        '  _(AI? robot? familiar? ghost in the machine? something weirder?)_',
        '- **Vibe:**',
        '  _(how do you come across? sharp? warm? chaotic? calm?)_',
        '- **Emoji:**',
        '  _(your signature — pick one that feels right)_',
      ].join('\n'),
      'utf-8',
    );

    await ensureClawXIdentityFile(workspaceDir);
    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.toContain('ClawX');
    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.not.toContain('pick something you like');

    await writeFile(join(workspaceDir, 'IDENTITY.md'), '# IDENTITY.md\n\n- **Name:** Paisley\n', 'utf-8');
    await ensureClawXIdentityFile(workspaceDir);
    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.toBe('# IDENTITY.md\n\n- **Name:** Paisley\n');
  });

  it('removes a lingering BOOTSTRAP.md after identity seeding', async () => {
    const workspaceDir = join(testHome, '.openclaw', 'workspace');
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, 'BOOTSTRAP.md'), 'chat-first bootstrap', 'utf-8');

    await ensureClawXIdentityFile(workspaceDir);

    await expect(access(join(workspaceDir, 'BOOTSTRAP.md'))).rejects.toThrow();
    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.toContain('ClawX');
  });
});

describe('ensureClawXDefaultIdentity', () => {
  it('creates the default workspace and seeds IDENTITY.md for startup-owned workspaces', async () => {
    await ensureClawXDefaultIdentity();

    await expect(readFile(join(testHome, '.openclaw', 'workspace', 'IDENTITY.md'), 'utf-8')).resolves.toContain('ClawX');
  });
});

describe('ensureClawXContext', () => {
  it('does not wait for missing files in non-default agent workspaces', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const defaultWorkspace = join(openclawDir, 'workspace-main');
    const agentWorkspace = join(openclawDir, 'workspace-agent');
    await mkdir(defaultWorkspace, { recursive: true });
    await mkdir(agentWorkspace, { recursive: true });
    await writeFile(join(defaultWorkspace, 'AGENTS.md'), '# AGENTS.md\n\nExisting agents.\n', 'utf-8');
    await writeFile(join(defaultWorkspace, 'TOOLS.md'), '# TOOLS.md\n\nExisting tools.\n', 'utf-8');
    await writeFile(
      join(openclawDir, 'openclaw.json'),
      JSON.stringify({
        agents: {
          defaults: { workspace: defaultWorkspace },
          list: [{ id: 'agent', workspace: agentWorkspace }],
        },
      }),
      'utf-8',
    );

    const result = await Promise.race([
      ensureClawXContext().then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 200)),
    ]);

    expect(result).toBe('done');
    await expect(readFile(join(defaultWorkspace, 'AGENTS.md'), 'utf-8')).resolves.toContain('## ClawX Environment');
    await expect(readFile(join(defaultWorkspace, 'TOOLS.md'), 'utf-8')).resolves.toContain('## ClawX Tool Notes');
    await expect(access(join(agentWorkspace, 'AGENTS.md'))).rejects.toThrow();
    await expect(access(join(agentWorkspace, 'TOOLS.md'))).rejects.toThrow();
  });

  it('does not wait for missing external default workspaces', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const externalWorkspace = join(testHome, '..', `external-missing-${Date.now()}`);
    await mkdir(openclawDir, { recursive: true });
    await writeFile(
      join(openclawDir, 'openclaw.json'),
      JSON.stringify({
        agents: {
          defaults: { workspace: externalWorkspace },
        },
      }),
      'utf-8',
    );

    const result = await Promise.race([
      ensureClawXContext().then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 200)),
    ]);

    expect(result).toBe('done');
  });
});
