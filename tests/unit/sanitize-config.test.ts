/**
 * Tests for openclaw.json config sanitization before Gateway start.
 *
 * Uses a temp directory with real file I/O to avoid fs/promises mock complexity.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;
let configPath: string;

async function writeConfig(data: unknown): Promise<void> {
  await writeFile(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readConfig(): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Standalone version of the sanitization logic for testing.
 * Mirrors the logic in openclaw-auth.ts#sanitizeOpenClawConfig.
 */
async function sanitizeConfig(filePath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return false;
  }

  const config = JSON.parse(raw) as Record<string, unknown>;
  let modified = false;

  const skills = config.skills;
  if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
    const skillsObj = skills as Record<string, unknown>;
    const VALID_SKILLS_KEYS = new Set(['allowBundled', 'load', 'install', 'limits', 'entries']);
    for (const key of Object.keys(skillsObj)) {
      if (!VALID_SKILLS_KEYS.has(key)) {
        delete skillsObj[key];
        modified = true;
      }
    }
  }

  if (modified) {
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }
  return modified;
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'clawx-test-'));
  configPath = join(tempDir, 'openclaw.json');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('sanitizeOpenClawConfig', () => {
  it('removes skills.enabled at the top level of skills', async () => {
    await writeConfig({
      skills: {
        enabled: true,
        entries: {
          'my-skill': { enabled: true, apiKey: 'abc' },
        },
      },
      gateway: { mode: 'local' },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.skills).not.toHaveProperty('enabled');
    const skills = result.skills as Record<string, unknown>;
    const entries = skills.entries as Record<string, Record<string, unknown>>;
    expect(entries['my-skill'].enabled).toBe(true);
    expect(entries['my-skill'].apiKey).toBe('abc');
    expect(result.gateway).toEqual({ mode: 'local' });
  });

  it('does nothing when config is already valid', async () => {
    const original = {
      skills: {
        entries: { 'my-skill': { enabled: true } },
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  it('handles config with no skills section', async () => {
    const original = { gateway: { mode: 'local' } };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  it('handles empty config', async () => {
    await writeConfig({});

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  it('returns false for missing config file', async () => {
    const modified = await sanitizeConfig(join(tempDir, 'nonexistent.json'));
    expect(modified).toBe(false);
  });

  it('removes multiple unknown keys from skills', async () => {
    await writeConfig({
      skills: {
        enabled: true,
        disabled: false,
        someOther: 'value',
        entries: { 'x': { enabled: false } },
        allowBundled: ['web-search'],
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const skills = result.skills as Record<string, unknown>;
    expect(Object.keys(skills).sort()).toEqual(['allowBundled', 'entries']);
    const entries = skills.entries as Record<string, Record<string, unknown>>;
    expect(entries['x'].enabled).toBe(false);
  });

  it('preserves all valid skills keys', async () => {
    const original = {
      skills: {
        allowBundled: ['web-search'],
        load: { extraDirs: ['/my/dir'], watch: true },
        install: { preferBrew: false },
        limits: { maxSkillsInPrompt: 5 },
        entries: { 'a-skill': { enabled: true, apiKey: 'key', env: { FOO: 'bar' } } },
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });
});
