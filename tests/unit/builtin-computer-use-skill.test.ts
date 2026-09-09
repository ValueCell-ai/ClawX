// @vitest-environment node

import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '', resources: '' }));
const mutateConfig = vi.hoisted(() => vi.fn());
vi.mock('fs/promises', async (original) => ({ ...await original<typeof import('fs/promises')>() }));
vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('os', async (original) => ({ ...await original<typeof import('os')>(), homedir: () => state.home }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('os')>(), homedir: () => state.home }));
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
  readOpenClawConfigSnapshot: async () => ({ config: {} }),
}));

const resources = resolve('resources');
const upstreamCommit = '45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f';
const upstreamPath = 'libs/cua-driver/rust/Skills/cua-driver';
// Independent Git blob IDs verify vendored provenance, not installed-version ownership.
const upstreamBlobs: Record<string, string> = {
  'UPSTREAM-SKILL.md': '08bb4acaeffc2c57e08386189e8929661613fad5',
  'MACOS.md': '2e4424190da51b1d61f9d0b8f13efdf7d4a80693',
  'WINDOWS.md': '504b5f427c05ed092dcdf05e19a2b54b921906fb',
  'LINUX.md': '5a84eb0024df5f2012bdb0b3879aea9258e36e99',
  'BROWSER.md': '35e652fb61bd3c528387b6aba22fbf1bc51ec5c1',
  'RECORDING.md': 'c3bbea99a6e2b88e3340ed1cf74b36db40326014',
  'EMBEDDING.md': 'f21d82cbffce3d2b9a3dcc69debbfd4087ea0ded',
  'README.md': 'ca550f708d2f3806c5a0ad8512a9f53d4dc0a8da',
  'LICENSE.md': 'b8b198ce3ebaa22c9f59588a80f9f1875d85b34a',
};
let root: string;
const sourceDir = () => join(state.resources, 'skills', 'computer-use');
const targetDir = () => join(state.home, '.openclaw', 'skills', 'computer-use');

function expectBundle() {
  expect(lstatSync(targetDir()).isDirectory()).toBe(true);
  expect(readdirSync(targetDir()).sort()).toEqual(readdirSync(sourceDir()).sort());
  for (const file of readdirSync(sourceDir())) {
    expect(lstatSync(join(targetDir(), file)).isFile()).toBe(true);
    expect(readFileSync(join(targetDir(), file)).equals(readFileSync(join(sourceDir(), file))), file).toBe(true);
  }
  expect(mutateConfig).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'clawx-builtin-computer-'));
  state.home = join(root, 'home');
  state.resources = resources;
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('built-in computer-use resource', () => {
  it('keeps one concise computer-use entrypoint ahead of pinned native guidance', () => {
    const content = readFileSync(join(sourceDir(), 'SKILL.md'), 'utf8');
    const frontmatter = YAML.parse(content.split('---')[1]);
    expect(Object.keys(frontmatter).sort()).toEqual(['description', 'name']);
    expect(frontmatter.name).toBe('computer-use');
    expect(frontmatter.description).toContain('/computer-use');
    expect(content.split('\n').length).toBeLessThanOrEqual(165);
    expect(content).toContain('official CUA 0.25.0');
    expect(content).not.toContain('0.21.0');
    expect(content).toContain('takes precedence');
    expect(content).not.toContain('Use only the available `computer` tool');
    for (const file of Object.keys(upstreamBlobs)) expect(content).toContain(file);
    expect(content).toContain(`https://github.com/trycua/cua/blob/${upstreamCommit}/libs/cua-driver/docs/action-result-contract.md`);
  });

  it('vendors all eight unchanged documents and the root MIT license with verifiable provenance', () => {
    expect(readFileSync(join(sourceDir(), '.gitattributes'), 'utf8')).toContain('*.md -text');
    const provenance = JSON.parse(readFileSync(join(sourceDir(), 'UPSTREAM.json'), 'utf8'));
    expect(provenance).toMatchObject({
      repository: 'https://github.com/trycua/cua',
      tag: 'cua-driver-rs-v0.25.0', commit: upstreamCommit, version: '0.25.0',
    });
    expect(provenance.files.map((file: { destination: string }) => file.destination).sort()).toEqual(Object.keys(upstreamBlobs).sort());
    for (const file of provenance.files) {
      expect(file.source).toBe(file.destination === 'LICENSE.md' ? 'LICENSE.md' : `${upstreamPath}/${file.destination === 'UPSTREAM-SKILL.md' ? 'SKILL.md' : file.destination}`);
      const bytes = readFileSync(join(sourceDir(), file.destination));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')).toBe(upstreamBlobs[file.destination]);
    }
    expect(YAML.parse(readFileSync(join(sourceDir(), 'UPSTREAM-SKILL.md'), 'utf8').split('---')[1]).version).toBe('0.25.0');
    expect(readFileSync(join(sourceDir(), 'LICENSE.md'), 'utf8')).toContain('MIT License');
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
    expectBundle();
    for (const [, file] of readFileSync(join(targetDir(), 'SKILL.md'), 'utf8').matchAll(/\]\(([^):]+\.md)\)/g)) {
      expect(existsSync(resolve(targetDir(), file))).toBe(true);
    }
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
    expect(skills.filter((skill) => ['computer-use', 'cua-driver'].includes(skill.name))).toHaveLength(1);
  });

  it('skips matching content without copying or rewriting files', async () => {
    cpSync(sourceDir(), targetDir(), { recursive: true });
    const copy = vi.spyOn(await import('@electron/utils/plugin-install'), 'cpAsyncSafe');
    const modified = lstatSync(join(targetDir(), 'SKILL.md')).mtimeMs;
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    await ensureBuiltinSkillsInstalled();
    expect(copy).not.toHaveBeenCalled();
    expect(lstatSync(join(targetDir(), 'SKILL.md')).mtimeMs).toBe(modified);
    expectBundle();
  });

  it.each(['SKILL.md', 'MACOS.md', 'UPSTREAM.json', '.gitattributes', 'extra file', 'extra directory', 'missing file', 'arbitrary directory', 'file at target'])('replaces differing same-name content: %s', async (variant) => {
    if (variant === 'file at target') {
      mkdirSync(join(targetDir(), '..'), { recursive: true });
      writeFileSync(targetDir(), 'Not a directory');
    } else {
      cpSync(sourceDir(), targetDir(), { recursive: true });
      if (variant === 'extra file') writeFileSync(join(targetDir(), 'notes.txt'), 'User notes');
      else if (variant === 'extra directory') {
        mkdirSync(join(targetDir(), 'notes'));
        writeFileSync(join(targetDir(), 'notes', 'custom.md'), 'User instructions');
      } else if (variant === 'missing file') rmSync(join(targetDir(), 'MACOS.md'));
      else if (variant === 'arbitrary directory') {
        rmSync(targetDir(), { recursive: true });
        mkdirSync(targetDir());
        writeFileSync(join(targetDir(), 'notes.txt'), 'No manifest');
      } else writeFileSync(join(targetDir(), variant), 'User instructions');
    }
    const other = join(targetDir(), '..', 'my-computer-use');
    mkdirSync(other);
    writeFileSync(join(other, 'SKILL.md'), 'Custom skill');
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    expectBundle();
    expect(readFileSync(join(other, 'SKILL.md'), 'utf8')).toBe('Custom skill');
  });

  it.each(['directory', 'dangling', ...(process.platform === 'win32' ? [] : ['file'])])('replaces a %s symlink without following its external target', async (kind) => {
    const outside = join(root, 'outside');
    mkdirSync(join(targetDir(), '..'), { recursive: true });
    if (kind !== 'dangling') {
      mkdirSync(outside);
      writeFileSync(join(outside, 'SKILL.md'), 'External content');
    }
    if (kind === 'file') {
      cpSync(sourceDir(), targetDir(), { recursive: true });
      rmSync(join(targetDir(), 'SKILL.md'));
      symlinkSync(join(outside, 'SKILL.md'), join(targetDir(), 'SKILL.md'));
    } else symlinkSync(outside, targetDir(), 'junction');
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    expectBundle();
    if (kind === 'dangling') expect(existsSync(outside)).toBe(false);
    else expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).toBe('External content');
  });

  it('uses the current bundled source without historical or hardcoded installation hashes', async () => {
    cpSync(sourceDir(), targetDir(), { recursive: true });
    state.resources = join(root, 'next-resources');
    cpSync(join(resources, 'skills/computer-use'), sourceDir(), { recursive: true });
    writeFileSync(join(sourceDir(), 'SKILL.md'), 'Next bundled version');
    writeFileSync(join(sourceDir(), 'NEW.md'), 'New reference');
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    expectBundle();
  });

  it.each([false, true])('stages before publication and retries partial copy failures (existing=%s)', async (existing) => {
    if (existing) {
      mkdirSync(targetDir(), { recursive: true });
      writeFileSync(join(targetDir(), 'SKILL.md'), 'Old content');
    }
    const copy = vi.spyOn(await import('@electron/utils/plugin-install'), 'cpAsyncSafe');
    let stagedPath = '';
    copy.mockImplementationOnce(async (source, destination) => {
      stagedPath = destination;
      mkdirSync(destination, { recursive: true });
      cpSync(join(source, 'SKILL.md'), join(destination, 'SKILL.md'));
      throw new Error('Partial copy failure');
    });
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    expect(stagedPath).not.toBe(targetDir());
    expect(existsSync(stagedPath)).toBe(false);
    if (existing) expect(readFileSync(join(targetDir(), 'SKILL.md'), 'utf8')).toBe('Old content');
    else expect(existsSync(targetDir())).toBe(false);
    await ensureBuiltinSkillsInstalled();
    expectBundle();
    expect(copy).toHaveBeenCalledTimes(2);
    expect(readdirSync(join(state.home, '.openclaw'))).toEqual(['skills']);
  });

  it('rejects a corrupted staged copy without damaging the installed directory', async () => {
    mkdirSync(targetDir(), { recursive: true });
    writeFileSync(join(targetDir(), 'SKILL.md'), 'Old content');
    const installer = await import('@electron/utils/plugin-install');
    const realCopy = installer.cpAsyncSafe;
    const copy = vi.spyOn(installer, 'cpAsyncSafe').mockImplementationOnce(async (source, destination) => {
      await realCopy(source, destination);
      writeFileSync(join(destination, 'SKILL.md'), 'Corrupted copy');
    });
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    expect(copy).toHaveBeenCalledOnce();
    expect(readFileSync(join(targetDir(), 'SKILL.md'), 'utf8')).toBe('Old content');
    expect(readdirSync(join(state.home, '.openclaw'))).toEqual(['skills']);
  });

  it('rolls back failed publication and retries on the next startup', async () => {
    mkdirSync(targetDir(), { recursive: true });
    writeFileSync(join(targetDir(), 'SKILL.md'), 'Old content');
    const fs = await import('fs/promises');
    const realRename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementationOnce(realRename).mockRejectedValueOnce(new Error('Publication failed'));
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    expect(readFileSync(join(targetDir(), 'SKILL.md'), 'utf8')).toBe('Old content');
    await ensureBuiltinSkillsInstalled();
    expectBundle();
    expect(readdirSync(join(state.home, '.openclaw'))).toEqual(['skills']);
  });

  it.each(['dangling', ...(process.platform === 'win32' ? [] : ['relative'])])('retains the previous %s symlink if publication and rollback both fail', async (kind) => {
    mkdirSync(join(targetDir(), '..'), { recursive: true });
    const outside = join(targetDir(), '..', 'my-custom');
    if (kind === 'relative') {
      mkdirSync(outside);
      writeFileSync(join(outside, 'SKILL.md'), 'External content');
      symlinkSync('my-custom', targetDir(), 'dir');
    } else symlinkSync(outside, targetDir(), 'junction');
    const fs = await import('fs/promises');
    const realRename = fs.rename;
    const rename = vi.spyOn(fs, 'rename').mockImplementationOnce(realRename)
      .mockRejectedValueOnce(new Error('Publication failed'))
      .mockRejectedValueOnce(new Error('Rollback failed'));
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    const saved = String(rename.mock.calls[0][1]);
    expect(lstatSync(saved).isSymbolicLink()).toBe(true);
    expect(existsSync(targetDir())).toBe(false);
    if (kind === 'relative') expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).toBe('External content');
    else expect(existsSync(outside)).toBe(false);
  });

  it('overwrites edits made during staging because the entire directory is managed', async () => {
    cpSync(sourceDir(), targetDir(), { recursive: true });
    writeFileSync(join(targetDir(), 'SKILL.md'), 'Before staging');
    const installer = await import('@electron/utils/plugin-install');
    const realCopy = installer.cpAsyncSafe;
    vi.spyOn(installer, 'cpAsyncSafe').mockImplementationOnce(async (source, destination) => {
      await realCopy(source, destination);
      writeFileSync(join(targetDir(), 'SKILL.md'), 'During staging');
    });
    const { ensureBuiltinSkillsInstalled } = await import('@electron/utils/skill-config');
    await ensureBuiltinSkillsInstalled();
    expectBundle();
  });
});
