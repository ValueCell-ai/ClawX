/**
 * Tests for openclaw.json config sanitization before Gateway start.
 *
 * The sanitizeOpenClawConfig() function in openclaw-auth.ts relies on
 * Electron-specific helpers (readOpenClawJson / writeOpenClawJson) that
 * read from ~/.openclaw/openclaw.json.  To avoid mocking Electron + the
 * real HOME directory, this test uses a standalone version of the
 * sanitization logic that mirrors the production code exactly, operating
 * on a temp directory with real file I/O.
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
 * Standalone mirror of the sanitization logic in openclaw-auth.ts.
 * Uses the same blocklist approach as the production code.
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

  // Mirror of the production blocklist logic
  const skills = config.skills;
  if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
    const skillsObj = skills as Record<string, unknown>;
    const KNOWN_INVALID_SKILLS_ROOT_KEYS = ['enabled', 'disabled'];
    for (const key of KNOWN_INVALID_SKILLS_ROOT_KEYS) {
      if (key in skillsObj) {
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

describe('sanitizeOpenClawConfig (blocklist approach)', () => {
  it('removes skills.enabled at the root level of skills', async () => {
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
    // Root-level "enabled" should be gone
    expect(result.skills).not.toHaveProperty('enabled');
    // entries[key].enabled must be preserved
    const skills = result.skills as Record<string, unknown>;
    const entries = skills.entries as Record<string, Record<string, unknown>>;
    expect(entries['my-skill'].enabled).toBe(true);
    expect(entries['my-skill'].apiKey).toBe('abc');
    // Other top-level sections are untouched
    expect(result.gateway).toEqual({ mode: 'local' });
  });

  it('removes skills.disabled at the root level of skills', async () => {
    await writeConfig({
      skills: {
        disabled: false,
        entries: { 'x': { enabled: false } },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.skills).not.toHaveProperty('disabled');
    const skills = result.skills as Record<string, unknown>;
    const entries = skills.entries as Record<string, Record<string, unknown>>;
    expect(entries['x'].enabled).toBe(false);
  });

  it('removes both enabled and disabled when present together', async () => {
    await writeConfig({
      skills: {
        enabled: true,
        disabled: false,
        entries: { 'a': { enabled: true } },
        allowBundled: ['web-search'],
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const skills = result.skills as Record<string, unknown>;
    expect(skills).not.toHaveProperty('enabled');
    expect(skills).not.toHaveProperty('disabled');
    // Valid keys are preserved
    expect(skills.allowBundled).toEqual(['web-search']);
    expect(skills.entries).toBeDefined();
  });

  it('does nothing when config is already valid', async () => {
    const original = {
      skills: {
        entries: { 'my-skill': { enabled: true } },
        allowBundled: ['web-search'],
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  it('preserves unknown valid keys (forward-compatible)', async () => {
    // If OpenClaw adds new valid keys to skills in the future,
    // the blocklist approach should NOT strip them.
    const original = {
      skills: {
        entries: { 'x': { enabled: true } },
        allowBundled: ['web-search'],
        load: { extraDirs: ['/my/dir'], watch: true },
        install: { preferBrew: false },
        limits: { maxSkillsInPrompt: 5 },
        futureNewKey: { some: 'value' },  // hypothetical future key
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

  it('handles skills being an array (no-op, no crash)', async () => {
    // Edge case: skills is not an object
    await writeConfig({ skills: ['something'] });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  it('preserves all other top-level config sections', async () => {
    await writeConfig({
      skills: { enabled: true, entries: {} },
      channels: { discord: { token: 'abc', enabled: true } },
      plugins: { entries: { whatsapp: { enabled: true } } },
      gateway: { mode: 'local', auth: { token: 'xyz' } },
      agents: { defaults: { model: { primary: 'gpt-4' } } },
      models: { providers: { openai: { baseUrl: 'https://api.openai.com' } } },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    // skills.enabled removed
    expect(result.skills).not.toHaveProperty('enabled');
    // All other sections unchanged
    expect(result.channels).toEqual({ discord: { token: 'abc', enabled: true } });
    expect(result.plugins).toEqual({ entries: { whatsapp: { enabled: true } } });
    expect(result.gateway).toEqual({ mode: 'local', auth: { token: 'xyz' } });
    expect(result.agents).toEqual({ defaults: { model: { primary: 'gpt-4' } } });
  });
});
