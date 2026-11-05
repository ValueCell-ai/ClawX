// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { compactPluginMirror, PLUGIN_COMPACT_POLICIES } from '../../scripts/openclaw-plugin-compact.mjs';

type Files = Record<string, string>;

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clawx-plugin-compact-'));
  tempRoots.push(root);
  return root;
}

function writeFiles(root: string, files: Files): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

function pkg(manifest: Record<string, unknown>): string {
  return `${JSON.stringify({ version: '1.0.0', ...manifest }, null, 2)}\n`;
}

function readManifest(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

/** Runs `body` as an ES module in a fresh Node process so the output is loaded natively. */
function runModule(cwd: string, body: string): unknown {
  const script = join(cwd, `probe-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(script, `${body}\n`);
  try {
    return JSON.parse(execFileSync(process.execPath, [script], { cwd, encoding: 'utf8' }));
  } finally {
    rmSync(script, { force: true });
  }
}

function importUrl(file: string): string {
  return JSON.stringify(pathToFileURL(file).href);
}

const BASE_PLUGIN: Files = {
  'package.json': pkg({
    name: 'fixture-plugin',
    type: 'module',
    main: './dist/index.mjs',
    dependencies: { 'dep-a': '1.0.0', 'keep-me': '1.0.0' },
    openclaw: { extensions: ['./dist/index.mjs'] },
  }),
  'openclaw.plugin.json': '{ "id": "fixture" }\n',
  'dist/index.mjs': [
    "import { shared } from './shared.js';",
    "import { a } from 'dep-a';",
    "import { keep } from 'keep-me';",
    'export const fromIndex = shared;',
    'export const value = a();',
    'export const kept = keep();',
  ].join('\n'),
  'dist/other.js': "import { shared } from './shared.js';\nexport const fromOther = shared;\n",
  'dist/shared.js': 'export const shared = { created: Math.random() };\n',
  'dist/index.d.ts': 'export declare const value: string;\n',
  'src/index.ts': 'export const value = 1;\n',
  'node_modules/dep-a/package.json': pkg({ name: 'dep-a', main: 'index.js' }),
  'node_modules/dep-a/index.js': "module.exports.a = () => 'A' + require('node:path').sep.length;\n",
  'node_modules/dep-a/LICENSE': 'MIT dep-a\n',
  'node_modules/keep-me/package.json': pkg({
    name: 'keep-me', type: 'module', exports: './index.js', dependencies: { 'keep-dep': '1.0.0' },
  }),
  'node_modules/keep-me/index.js': "import k from 'keep-dep';\nexport const keep = () => 'K' + k;\n",
  'node_modules/keep-dep/package.json': pkg({ name: 'keep-dep', main: 'index.js' }),
  'node_modules/keep-dep/index.js': 'module.exports = 1;\n',
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('compactPluginMirror', () => {
  it('bundles own modules in place and drops inlined dependencies', async () => {
    const plugin = makeRoot();
    writeFiles(plugin, BASE_PLUGIN);

    const result = await compactPluginMirror(plugin, { bundle: true, keepPackages: ['keep-me'] });

    expect([...result.bundledPackages]).toEqual(['dep-a']);
    expect(result.after).toBeLessThan(result.before);
    for (const entry of ['dist/index.mjs', 'dist/other.js', 'dist/shared.js']) {
      expect(existsSync(join(plugin, entry))).toBe(true);
    }
    expect(existsSync(join(plugin, 'node_modules/dep-a'))).toBe(false);
    expect(existsSync(join(plugin, 'node_modules/keep-me/index.js'))).toBe(true);
    expect(existsSync(join(plugin, 'node_modules/keep-dep/index.js'))).toBe(true);
    expect(readManifest(plugin).dependencies).toEqual({ 'keep-me': '1.0.0' });
    expect(existsSync(join(plugin, 'src'))).toBe(false);
    expect(existsSync(join(plugin, 'dist/index.d.ts'))).toBe(false);
    expect(readFileSync(join(plugin, 'THIRD_PARTY_LICENSES.txt'), 'utf8')).toContain('dep-a@1.0.0');

    const loaded = runModule(plugin, [
      `const index = await import(${importUrl(join(plugin, 'dist/index.mjs'))});`,
      `const other = await import(${importUrl(join(plugin, 'dist/other.js'))});`,
      'console.log(JSON.stringify({ same: index.fromIndex === other.fromOther, value: index.value, kept: index.kept }));',
    ].join('\n'));
    expect(loaded).toEqual({ same: true, value: 'A1', kept: 'K1' });
  });

  it('turns lazily imported ESM dependencies into chunks instead of writing them back', async () => {
    const plugin = makeRoot();
    writeFiles(plugin, {
      ...BASE_PLUGIN,
      'dist/other.js': "export const lazy = async () => (await import('lazy-esm')).default;\n",
      'node_modules/lazy-esm/package.json': pkg({ name: 'lazy-esm', type: 'module', exports: './index.js' }),
      'node_modules/lazy-esm/index.js': "export default 'lazy';\n",
    });

    const result = await compactPluginMirror(plugin, { bundle: true, keepPackages: ['keep-me'] });

    expect(result.bundledPackages.has('lazy-esm')).toBe(true);
    expect(existsSync(join(plugin, 'node_modules/lazy-esm'))).toBe(false);
    expect(readdirSync(join(plugin, 'dist')).some((name) => name.startsWith('chunk-lazy-'))).toBe(true);
    const loaded = runModule(plugin, [
      `const other = await import(${importUrl(join(plugin, 'dist/other.js'))});`,
      'console.log(JSON.stringify(await other.lazy()));',
    ].join('\n'));
    expect(loaded).toBe('lazy');
  });

  it('refuses to emit ESM chunks into a CommonJS package', async () => {
    const plugin = makeRoot();
    writeFiles(plugin, {
      ...BASE_PLUGIN,
      'package.json': pkg({ name: 'fixture-plugin', main: './dist/index.mjs', dependencies: { 'dep-a': '1.0.0' } }),
    });

    await expect(compactPluginMirror(plugin, { bundle: true })).rejects.toThrow(/"type": "module"/);
    expect(readFileSync(join(plugin, 'dist/index.mjs'), 'utf8')).toBe(BASE_PLUGIN['dist/index.mjs']);
  });

  it('rejects bundled __dirname readers unless they are allowlisted', async () => {
    const files: Files = {
      ...BASE_PLUGIN,
      'dist/index.mjs': "import { dir } from 'dep-b';\nexport const where = dir();\n",
      'node_modules/dep-b/package.json': pkg({ name: 'dep-b', main: 'index.js' }),
      'node_modules/dep-b/index.js': 'module.exports.dir = () => __dirname;\n',
    };
    const rejected = makeRoot();
    writeFiles(rejected, files);
    await expect(compactPluginMirror(rejected, { bundle: true, keepPackages: ['keep-me'] }))
      .rejects.toThrow(/reads __dirname\/__filename/);
    expect(existsSync(join(rejected, 'node_modules/dep-b'))).toBe(true);

    const allowed = makeRoot();
    writeFiles(allowed, files);
    await compactPluginMirror(allowed, { bundle: true, keepPackages: ['keep-me'], modulePathReaders: ['dep-b'] });
    const loaded = runModule(allowed, [
      `const index = await import(${importUrl(join(allowed, 'dist/index.mjs'))});`,
      'console.log(JSON.stringify(index.where));',
    ].join('\n'));
    expect(String(loaded)).toBe(realpathSync(join(allowed, 'dist')));
  });

  it('re-bundles an installed package without moving its entries, workers or assets', async () => {
    const plugin = makeRoot();
    writeFiles(plugin, {
      ...BASE_PLUGIN,
      'package.json': pkg({ name: 'fixture-plugin', type: 'module', main: './dist/index.mjs', dependencies: { 'native-ish': '1.0.0' } }),
      'dist/index.mjs': "export * from 'native-ish';\n",
      'dist/other.js': 'export {};\n',
      'node_modules/native-ish/package.json': pkg({
        name: 'native-ish',
        type: 'module',
        exports: { '.': './dist/index.js', './extra': './dist/extra.js' },
        optionalDependencies: { 'inline-me': '1.0.0', 'native-ish-plat': '1.0.0' },
      }),
      'node_modules/native-ish/dist/index.js': [
        "import { createRequire } from 'node:module';",
        "import { existsSync, readFileSync } from 'node:fs';",
        "import { fileURLToPath } from 'node:url';",
        "import { helper } from './internal/helper.js';",
        'const require = createRequire(import.meta.url);',
        "const platformPackage = ['native-ish', process.env.NATIVE_ISH_TARGET ?? 'plat'].join('-');",
        "export const asset = () => readFileSync(new URL('./asset.txt', import.meta.url), 'utf8');",
        "export const workerExists = () => existsSync(fileURLToPath(new URL('./worker.js', import.meta.url)));",
        'export const platform = () => require(platformPackage).id;',
        "export const inlined = async () => (await import('inline-me')).default;",
        'export const help = helper;',
      ].join('\n'),
      'node_modules/native-ish/dist/internal/helper.js': "import { more } from './more.js';\nexport const helper = () => 'help' + more;\n",
      'node_modules/native-ish/dist/internal/more.js': "export const more = '!';\n",
      'node_modules/native-ish/dist/extra.js': "export const extra = 'extra';\n",
      'node_modules/native-ish/dist/worker.js': "console.log('worker');\n",
      'node_modules/native-ish/dist/asset.txt': 'ASSET',
      'node_modules/inline-me/package.json': pkg({ name: 'inline-me', type: 'module', exports: './index.js' }),
      'node_modules/inline-me/index.js': "export default 'inlined';\n",
      'node_modules/inline-me/LICENSE': 'MIT inline-me\n',
      'node_modules/native-ish-plat/package.json': pkg({ name: 'native-ish-plat', main: 'index.js' }),
      'node_modules/native-ish-plat/index.js': "module.exports = { id: 'plat' };\n",
    });

    const result = await compactPluginMirror(plugin, { bundle: true, rebundlePackages: ['native-ish'] });

    const nativeDir = join(plugin, 'node_modules/native-ish');
    expect(existsSync(join(nativeDir, 'dist/internal'))).toBe(false);
    for (const kept of ['dist/index.js', 'dist/extra.js', 'dist/worker.js', 'dist/asset.txt']) {
      expect(existsSync(join(nativeDir, kept))).toBe(true);
    }
    expect(readManifest(nativeDir).optionalDependencies).toEqual({ 'native-ish-plat': '1.0.0' });
    expect(existsSync(join(plugin, 'node_modules/inline-me'))).toBe(false);
    expect(existsSync(join(plugin, 'node_modules/native-ish-plat/index.js'))).toBe(true);
    expect(result.bundledPackages.has('inline-me')).toBe(true);
    expect(readdirSync(join(plugin, 'node_modules')).sort()).toEqual(['native-ish', 'native-ish-plat']);

    const loaded = runModule(plugin, [
      `const m = await import(${importUrl(join(plugin, 'dist/index.mjs'))});`,
      'console.log(JSON.stringify({ asset: m.asset(), worker: m.workerExists(), platform: m.platform(), inlined: await m.inlined(), help: m.help() }));',
    ].join('\n'));
    expect(loaded).toEqual({ asset: 'ASSET', worker: true, platform: 'plat', inlined: 'inlined', help: 'help!' });
  });

  it('refuses output that locates a file which moved away from the bundled code', async () => {
    const plugin = makeRoot();
    writeFiles(plugin, {
      ...BASE_PLUGIN,
      'dist/index.mjs': "import { locate } from './sub/locate.js';\nexport const a = locate;\n",
      'dist/other.js': "import { locate } from './sub/locate.js';\nexport const b = locate;\n",
      'dist/sub/locate.js': "export const locate = () => new URL('./data.json', import.meta.url);\n",
      'dist/sub/data.json': '{}\n',
    });

    await expect(compactPluginMirror(plugin, { bundle: true, keepPackages: ['keep-me'] }))
      .rejects.toThrow(/locates missing dist\/data\.json/);
  });

  it('keeps unshipped optional imports external instead of resolving above the mirror', async () => {
    const root = makeRoot();
    const plugin = join(root, 'plugin');
    writeFiles(root, {
      'node_modules/outside-dep/package.json': pkg({ name: 'outside-dep', main: 'index.js' }),
      'node_modules/outside-dep/index.js': "module.exports = 'outside';\n",
    });
    writeFiles(plugin, {
      ...BASE_PLUGIN,
      'dist/other.js': [
        'export const optional = async () => {',
        "  try { return (await import('outside-dep')).default; } catch { return 'missing'; }",
        '};',
      ].join('\n'),
    });

    const result = await compactPluginMirror(plugin, { bundle: true, keepPackages: ['keep-me'] });

    expect([...result.unresolved]).toEqual(['outside-dep']);
    expect(result.bundledPackages.has('outside-dep')).toBe(false);
  });

  it('only prunes when bundling is disabled', async () => {
    const plugin = makeRoot();
    writeFiles(plugin, BASE_PLUGIN);

    await compactPluginMirror(plugin, { bundle: false });

    expect(existsSync(join(plugin, 'node_modules/dep-a/index.js'))).toBe(true);
    expect(readFileSync(join(plugin, 'dist/index.mjs'), 'utf8')).toBe(BASE_PLUGIN['dist/index.mjs']);
    expect(existsSync(join(plugin, 'src'))).toBe(false);
    expect(readManifest(plugin).dependencies).toEqual({ 'dep-a': '1.0.0', 'keep-me': '1.0.0' });
  });
});

describe('plugin compaction wiring', () => {
  it('compacts the heavy channel plugin mirrors in dev and packaged builds', () => {
    expect(Object.keys(PLUGIN_COMPACT_POLICIES).sort()).toEqual(['dingtalk', 'feishu-openclaw-plugin', 'qqbot', 'wecom']);
    for (const script of ['scripts/bundle-openclaw-plugins.mjs', 'scripts/after-pack.cjs']) {
      const source = readFileSync(resolve(process.cwd(), script), 'utf8');
      expect(source).toContain('PLUGIN_COMPACT_POLICIES[pluginId]');
      expect(source).toContain('compactPluginMirror(');
    }
  });
});
