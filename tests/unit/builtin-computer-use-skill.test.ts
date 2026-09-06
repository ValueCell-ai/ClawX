// @vitest-environment node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '', resources: '' }));
const mutateConfig = vi.hoisted(() => vi.fn());
vi.mock('os', async (original) => ({ ...await original<typeof import('os')>(), homedir: () => state.home }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => state.home }));
vi.mock('@electron/utils/paths', () => ({
  getResourcesDir: () => state.resources,
  getOpenClawDir: () => join(state.home, 'runtime'),
  getOpenClawResolvedDir: () => join(state.home, 'runtime'),
  getOpenClawSkillsDir: () => join(state.home, '.openclaw', 'skills'),
  expandPath: (value: string) => value,
}));
vi.mock('@electron/utils/agent-config', () => ({ listAgentsSnapshot: async () => ({ agents: [] }) }));
vi.mock('@electron/gateway/config-delivery', () => ({
  mutateOpenClawConfig: mutateConfig,
  readOpenClawConfigSnapshot: async () => ({ config: { computerUseEnabled: false } }),
}));

const resources = resolve('resources');
const relativeSkill = 'skills/computer-use/SKILL.md';
let root: string;

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'clawx-builtin-computer-'));
  state.home = join(root, 'home');
  state.resources = resources;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('built-in computer-use resource', () => {
  it('keeps concise frontmatter and executable examples aligned with the real plugin', async () => {
    const content = readFileSync(join(resources, relativeSkill), 'utf8');
    const frontmatter = YAML.parse(content.split('---')[1]);
    expect(Object.keys(frontmatter).sort()).toEqual(['description', 'name']);
    expect(frontmatter.name).toBe('computer-use');
    expect(frontmatter.description).toContain('/computer-use');
    expect(content.split('\n').length).toBeLessThanOrEqual(115);
    const pluginPath = pathToFileURL(join(resources, 'openclaw-plugins/clawx-cua-computer/computer-tool.mjs')).href;
    const { COMPUTER_ACTIONS, mapComputerAction } = await import(pluginPath);
    for (const action of COMPUTER_ACTIONS) expect(content).toContain(`\`${action}\``);
    const examples = [...content.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
    expect(examples).toHaveLength(2);
    expect(examples.map((example) => mapComputerAction(example).toolName)).toEqual(['type_text', 'press_key']);
  });

  it.each(['dev', 'packaged'])('installs and discovers the real skill in %s without enabling tools', async (mode) => {
    if (mode === 'packaged') {
      const config = YAML.parse(readFileSync(resolve('electron-builder.yml'), 'utf8'));
      const mapping = config.extraResources.find((entry: { from: string }) => entry.from === 'resources/');
      expect(mapping).toMatchObject({ to: 'resources/', filter: expect.arrayContaining(['**/*']) });
      expect(mapping.filter.some((pattern: string) => pattern.startsWith('!skills'))).toBe(false);
      state.resources = join(root, 'app', mapping.to);
      cpSync(join(resources, 'skills'), join(state.resources, 'skills'), { recursive: true });
    }
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    const installed = join(state.home, '.openclaw', relativeSkill);
    expect(existsSync(installed)).toBe(true);
    expect(readFileSync(installed, 'utf8')).toBe(readFileSync(join(resources, relativeSkill), 'utf8'));

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    expect(await listLocalSkills()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'computer-use', name: 'computer-use', enabled: true, filePath: expect.stringContaining('SKILL.md') }),
    ]));
    const { collectQuickAccessSkills } = await import('@electron/utils/skill-quick-access');
    const skills = await collectQuickAccessSkills({
      agentsRoots: [], legacyRoots: [], openClawRoots: [join(state.home, '.openclaw', 'skills')],
      openClawDir: join(state.home, 'runtime'),
    });
    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'computer-use', description: expect.stringContaining('/computer-use') }),
    ]));
    await ensureBuiltinSkillsInstalled();
    expect(readFileSync(installed, 'utf8')).toBe(readFileSync(join(resources, relativeSkill), 'utf8'));
    expect(mutateConfig).not.toHaveBeenCalled();
  });

  it.each([true, false])('preserves a user-owned directory (has manifest: %s)', async (hasManifest) => {
    const target = join(state.home, '.openclaw', 'skills', 'computer-use');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, hasManifest ? 'SKILL.md' : 'notes.txt'), 'User managed');
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    expect(readFileSync(join(target, hasManifest ? 'SKILL.md' : 'notes.txt'), 'utf8')).toBe('User managed');
    if (!hasManifest) expect(existsSync(join(target, 'SKILL.md'))).toBe(false);
    expect(mutateConfig).not.toHaveBeenCalled();
  });
});
