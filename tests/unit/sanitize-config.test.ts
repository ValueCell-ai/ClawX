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
import { mkdtemp, writeFile, readFile, rm, access } from 'fs/promises';
import { constants } from 'fs';
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
async function sanitizeConfig(
  filePath: string,
  bundledPlugins?: { all: string[]; enabledByDefault: string[] },
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return false;
  }

  const config = JSON.parse(raw) as Record<string, unknown>;
  let modified = false;
  const BUILTIN_CHANNEL_IDS = new Set([
    'discord',
    'telegram',
    'whatsapp',
    'slack',
    'signal',
    'imessage',
    'matrix',
    'line',
    'msteams',
    'googlechat',
    'mattermost',
  ]);

  /** Non-throwing async existence check. */
  async function fileExists(p: string): Promise<boolean> {
    try {
      await access(p, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

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

  // Mirror: prune stale absolute plugin paths under plugins (array), plugins.load (array),
  // and plugins.load.paths (nested object shape).
  const plugins = config.plugins;
  if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
    const pluginsObj = plugins as Record<string, unknown>;
    if (Array.isArray(pluginsObj.load)) {
      const validLoad: unknown[] = [];
      for (const p of pluginsObj.load) {
        if (typeof p === 'string' && p.startsWith('/')) {
          if (p.includes('node_modules/openclaw/extensions') || !(await fileExists(p))) {
            modified = true;
          } else {
            validLoad.push(p);
          }
        } else {
          validLoad.push(p);
        }
      }
      if (modified) pluginsObj.load = validLoad;
    } else if (pluginsObj.load && typeof pluginsObj.load === 'object' && !Array.isArray(pluginsObj.load)) {
      const loadObj = pluginsObj.load as Record<string, unknown>;
      if (Array.isArray(loadObj.paths)) {
        const validPaths: unknown[] = [];
        const countBefore = loadObj.paths.length;
        for (const p of loadObj.paths) {
          if (typeof p === 'string' && p.startsWith('/')) {
            if (p.includes('node_modules/openclaw/extensions') || !(await fileExists(p))) {
              modified = true;
            } else {
              validPaths.push(p);
            }
          } else {
            validPaths.push(p);
          }
        }
        if (validPaths.length !== countBefore) {
          loadObj.paths = validPaths;
        }
      }
    }

    const allow = Array.isArray(pluginsObj.allow) ? [...pluginsObj.allow as string[]] : [];
    const entries = (
      pluginsObj.entries && typeof pluginsObj.entries === 'object' && !Array.isArray(pluginsObj.entries)
        ? { ...(pluginsObj.entries as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    if ('whatsapp' in entries) {
      delete entries.whatsapp;
      pluginsObj.entries = entries;
      modified = true;
    }

    const configuredBuiltIns = new Set<string>();
    const channels = config.channels;
    if (channels && typeof channels === 'object' && !Array.isArray(channels)) {
      for (const [channelId, section] of Object.entries(channels as Record<string, Record<string, unknown>>)) {
        if (!BUILTIN_CHANNEL_IDS.has(channelId)) continue;
        if (!section || section.enabled === false) continue;
        if (Object.keys(section).length > 0) {
          configuredBuiltIns.add(channelId);
        }
      }
    }

    // Mirror production logic: exclude both built-in channels AND bundled
    // extension IDs from the "external" set, then re-add enabledByDefault ones.
    const bundledAll = new Set(bundledPlugins?.all ?? []);
    const bundledEnabledByDefault = bundledPlugins?.enabledByDefault ?? [];

    const externalPluginIds = allow.filter(
      (id) => !BUILTIN_CHANNEL_IDS.has(id) && !bundledAll.has(id),
    );
    const nextAllow = [...externalPluginIds];
    if (externalPluginIds.length > 0) {
      for (const channelId of configuredBuiltIns) {
        if (!nextAllow.includes(channelId)) {
          nextAllow.push(channelId);
        }
      }
    }

    // Re-add enabledByDefault plugins when allowlist is non-empty
    if (nextAllow.length > 0) {
      for (const pluginId of bundledEnabledByDefault) {
        if (!nextAllow.includes(pluginId)) {
          nextAllow.push(pluginId);
        }
      }
    }

    if (JSON.stringify(nextAllow) !== JSON.stringify(allow)) {
      if (nextAllow.length > 0) {
        pluginsObj.allow = nextAllow;
      } else {
        delete pluginsObj.allow;
      }
      modified = true;
    }

    if (Array.isArray(pluginsObj.allow) && pluginsObj.allow.length === 0) {
      delete pluginsObj.allow;
      modified = true;
    }
    if (pluginsObj.entries && Object.keys(entries).length === 0) {
      delete pluginsObj.entries;
      modified = true;
    }
    const pluginKeysExcludingEnabled = Object.keys(pluginsObj).filter((key) => key !== 'enabled');
    if (pluginsObj.enabled === true && pluginKeysExcludingEnabled.length === 0) {
      delete pluginsObj.enabled;
      modified = true;
    }
    if (Object.keys(pluginsObj).length === 0) {
      delete config.plugins;
      modified = true;
    }
  }

  // Mirror: remove stale tools.web.search.kimi.apiKey when moonshot provider exists.
  const providers = ((config.models as Record<string, unknown> | undefined)?.providers as Record<string, unknown> | undefined) || {};
  if (providers.moonshot) {
    const tools = (config.tools as Record<string, unknown> | undefined) || {};
    const web = (tools.web as Record<string, unknown> | undefined) || {};
    const search = (web.search as Record<string, unknown> | undefined) || {};
    const kimi = (search.kimi as Record<string, unknown> | undefined) || {};
    const plugins = Array.isArray(config.plugins)
      ? { load: [...config.plugins] }
      : ((config.plugins as Record<string, unknown> | undefined) || {});
    const entries = (plugins.entries as Record<string, unknown> | undefined) || {};
    const moonshot = (entries.moonshot as Record<string, unknown> | undefined) || {};
    const moonshotConfig = (moonshot.config as Record<string, unknown> | undefined) || {};
    const currentWebSearch = (moonshotConfig.webSearch as Record<string, unknown> | undefined) || {};
    if (Object.keys(kimi).length > 0) {
      delete kimi.apiKey;
      moonshotConfig.webSearch = { ...kimi, ...currentWebSearch, baseUrl: 'https://api.moonshot.cn/v1' };
      moonshot.config = moonshotConfig;
      entries.moonshot = moonshot;
      plugins.entries = entries;
      config.plugins = plugins;
      delete search.kimi;
      if (Object.keys(search).length === 0) {
        delete web.search;
      } else {
        web.search = search;
      }
      if (Object.keys(web).length === 0) {
        delete tools.web;
      } else {
        tools.web = web;
      }
      if (Object.keys(tools).length === 0) {
        delete config.tools;
      } else {
        config.tools = tools;
      }
      modified = true;
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
      plugins: { entries: { customPlugin: { enabled: true } } },
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
    expect(result.plugins).toEqual({ entries: { customPlugin: { enabled: true } } });
    expect(result.gateway).toEqual({ mode: 'local', auth: { token: 'xyz' } });
    expect(result.agents).toEqual({ defaults: { model: { primary: 'gpt-4' } } });
  });

  it('migrates tools.web.search.kimi into plugins.entries.moonshot.config.webSearch when moonshot provider exists', async () => {
    await writeConfig({
      models: {
        providers: {
          moonshot: { baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions' },
        },
      },
      tools: {
        web: {
          search: {
            kimi: {
              apiKey: 'stale-inline-key',
              baseUrl: 'https://api.moonshot.cn/v1',
            },
          },
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const tools = (result.tools as Record<string, unknown> | undefined) || {};
    const web = (tools.web as Record<string, unknown> | undefined) || {};
    const search = (web.search as Record<string, unknown> | undefined) || {};
    const moonshot = ((((result.plugins as Record<string, unknown>).entries as Record<string, unknown>).moonshot as Record<string, unknown>).config as Record<string, unknown>).webSearch as Record<string, unknown>;
    expect(search).not.toHaveProperty('kimi');
    expect(moonshot).not.toHaveProperty('apiKey');
    expect(moonshot.baseUrl).toBe('https://api.moonshot.cn/v1');
  });

  it('preserves legacy plugins array while migrating moonshot web search config', async () => {
    await writeConfig({
      plugins: ['/tmp/custom-plugin.js'],
      models: {
        providers: {
          moonshot: { baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions' },
        },
      },
      tools: {
        web: {
          search: {
            kimi: {
              baseUrl: 'https://api.moonshot.cn/v1',
            },
          },
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const plugins = result.plugins as Record<string, unknown>;
    const load = plugins.load as string[];
    const moonshot = ((((result.plugins as Record<string, unknown>).entries as Record<string, unknown>).moonshot as Record<string, unknown>).config as Record<string, unknown>).webSearch as Record<string, unknown>;

    expect(load).toEqual(['/tmp/custom-plugin.js']);
    expect(moonshot.baseUrl).toBe('https://api.moonshot.cn/v1');
  });

  it('keeps tools.web.search.kimi.apiKey when moonshot provider is absent', async () => {
    const original = {
      models: {
        providers: {
          openrouter: { baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
        },
      },
      tools: {
        web: {
          search: {
            kimi: {
              apiKey: 'should-stay',
            },
          },
        },
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  // ── plugins.load.paths regression tests (issue #607) ──────────

  it('removes stale absolute paths from plugins.load.paths', async () => {
    await writeConfig({
      plugins: {
        load: {
          paths: [
            '/nonexistent/path/to/some-plugin',
            '/another/missing/plugin/dir',
          ],
        },
        entries: { customPlugin: { enabled: true } },
      },
      gateway: { mode: 'local' },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const plugins = result.plugins as Record<string, unknown>;
    const load = plugins.load as Record<string, unknown>;
    expect(load.paths).toEqual([]);
    // Other plugin config is preserved
    expect(plugins.entries).toEqual({ customPlugin: { enabled: true } });
    // Other top-level sections untouched
    expect(result.gateway).toEqual({ mode: 'local' });
  });

  it('keeps configured built-in channels in plugins.allow when external plugins are enabled', async () => {
    await writeConfig({
      plugins: {
        enabled: true,
        allow: ['whatsapp', 'customPlugin'],
        entries: {
          whatsapp: { enabled: true },
          customPlugin: { enabled: true },
        },
      },
      channels: {
        discord: { enabled: true, token: 'abc' },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.channels).toEqual({ discord: { enabled: true, token: 'abc' } });
    expect(result.plugins).toEqual({
      enabled: true,
      allow: ['customPlugin', 'discord'],
      entries: {
        customPlugin: { enabled: true },
      },
    });
  });

  it('removes bundled node_modules paths from plugins.load.paths', async () => {
    await writeConfig({
      plugins: {
        load: {
          paths: [
            '/home/user/.nvm/versions/node/v22.0.0/lib/node_modules/openclaw/extensions/some-plugin',
          ],
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const plugins = result.plugins as Record<string, unknown>;
    const load = plugins.load as Record<string, unknown>;
    expect(load.paths).toEqual([]);
  });

  it('keeps valid existing paths in plugins.load.paths', async () => {
    // Use tempDir itself as a "valid" path that actually exists
    await writeConfig({
      plugins: {
        load: {
          paths: [
            tempDir,
            '/nonexistent/stale/plugin',
          ],
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const plugins = result.plugins as Record<string, unknown>;
    const load = plugins.load as Record<string, unknown>;
    // tempDir exists so it should be preserved; nonexistent is pruned
    expect(load.paths).toEqual([tempDir]);
  });

  it('preserves non-absolute entries in plugins.load.paths', async () => {
    await writeConfig({
      plugins: {
        load: {
          paths: [
            'relative/plugin-path',
            './another-relative',
            '/nonexistent/absolute/path',
          ],
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const plugins = result.plugins as Record<string, unknown>;
    const load = plugins.load as Record<string, unknown>;
    // Relative paths are preserved (only absolute paths are checked)
    expect(load.paths).toEqual(['relative/plugin-path', './another-relative']);
  });

  it('does nothing when plugins.load.paths contains only valid paths', async () => {
    const original = {
      plugins: {
        load: {
          paths: [tempDir],
          watch: true,
        },
        entries: { test: { enabled: true } },
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  it('preserves other keys in plugins.load alongside paths pruning', async () => {
    await writeConfig({
      plugins: {
        load: {
          paths: ['/nonexistent/stale/path'],
          watch: true,
          extraDirs: ['/some/dir'],
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const plugins = result.plugins as Record<string, unknown>;
    const load = plugins.load as Record<string, unknown>;
    expect(load.paths).toEqual([]);
    // Other load keys are preserved
    expect(load.watch).toBe(true);
    expect(load.extraDirs).toEqual(['/some/dir']);
  });

  it('handles plugins.load as empty object (no paths key)', async () => {
    const original = {
      plugins: {
        load: {},
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  it('handles plugins.load.paths as empty array', async () => {
    const original = {
      plugins: {
        load: { paths: [] },
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  // ── enabledByDefault bundled plugin allowlist tests ──────────────

  it('adds enabledByDefault bundled plugins to plugins.allow when allowlist is non-empty', async () => {
    await writeConfig({
      plugins: {
        allow: ['customPlugin'],
        entries: { customPlugin: { enabled: true } },
      },
    });

    const bundled = {
      all: ['browser', 'openai', 'diffs'],
      enabledByDefault: ['browser', 'openai'],
    };

    const modified = await sanitizeConfig(configPath, bundled);
    expect(modified).toBe(true);

    const result = await readConfig();
    const plugins = result.plugins as Record<string, unknown>;
    const allow = plugins.allow as string[];
    expect(allow).toContain('customPlugin');
    expect(allow).toContain('browser');
    expect(allow).toContain('openai');
    // 'diffs' is bundled but NOT enabledByDefault — should not be added
    expect(allow).not.toContain('diffs');
  });

  it('removes stale bundled plugin IDs from allowlist on upgrade', async () => {
    // Simulate: previous version had 'old-bundled' as enabledByDefault,
    // new version still has it bundled but no longer enabledByDefault.
    // Also 'unknown-plugin' is not in bundled.all — it could be a
    // user-installed third-party plugin, so it must be preserved.
    await writeConfig({
      plugins: {
        allow: ['customPlugin', 'unknown-plugin', 'old-bundled', 'browser'],
      },
    });

    const bundled = {
      all: ['browser', 'openai', 'old-bundled'],  // old-bundled still bundled
      enabledByDefault: ['browser', 'openai'],      // but no longer enabledByDefault
    };

    const modified = await sanitizeConfig(configPath, bundled);
    expect(modified).toBe(true);

    const result = await readConfig();
    const plugins = result.plugins as Record<string, unknown>;
    const allow = plugins.allow as string[];
    expect(allow).toContain('customPlugin');      // external — preserved
    expect(allow).toContain('unknown-plugin');    // not bundled — treated as external, preserved
    expect(allow).toContain('browser');           // still enabledByDefault
    expect(allow).toContain('openai');            // newly added enabledByDefault
    expect(allow).not.toContain('old-bundled');   // bundled but demoted — removed
  });

  it('removes demoted bundled plugin from allowlist when no longer enabledByDefault', async () => {
    // Simulate: 'diffs' was enabledByDefault in v1, demoted to opt-in in v2
    await writeConfig({
      plugins: {
        allow: ['customPlugin', 'diffs', 'browser'],
      },
    });

    const bundled = {
      all: ['browser', 'diffs', 'openai'],
      enabledByDefault: ['browser', 'openai'],  // diffs no longer enabledByDefault
    };

    const modified = await sanitizeConfig(configPath, bundled);
    expect(modified).toBe(true);

    const result = await readConfig();
    const plugins = result.plugins as Record<string, unknown>;
    const allow = plugins.allow as string[];
    expect(allow).toContain('customPlugin');
    expect(allow).toContain('browser');
    expect(allow).toContain('openai');
    expect(allow).not.toContain('diffs');  // demoted — removed
  });

  it('does not add enabledByDefault plugins when allowlist is empty (no external plugins)', async () => {
    // When no external plugins exist, allowlist should be dropped entirely
    await writeConfig({
      plugins: {
        allow: ['whatsapp'],  // built-in channel only
      },
    });

    const bundled = {
      all: ['browser', 'openai'],
      enabledByDefault: ['browser', 'openai'],
    };

    const modified = await sanitizeConfig(configPath, bundled);
    expect(modified).toBe(true);

    const result = await readConfig();
    // plugins.allow should be removed (only built-in, no external plugins)
    expect(result.plugins).toBeUndefined();
  });

  it('does not modify config when no bundled plugins and no allowlist', async () => {
    const original = {
      gateway: { mode: 'local' },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath, { all: ['browser'], enabledByDefault: ['browser'] });
    expect(modified).toBe(false);
  });
});
