// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, normalizePath, type ViteDevServer } from 'vite';
import { getDevWatchIgnored } from '../../scripts/vite-dev-watch';

const fixtures: Array<{ root: string; server?: ViteDevServer }> = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.server?.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

describe('development file watching', () => {
  it('scopes generated directory exclusions to the checkout, including paths with glob characters', () => {
    const root = join(tmpdir(), 'clawx [dev]+');
    const ignored = getDevWatchIgnored(root);
    for (const directory of ['build', 'release', 'dist-electron', 'artifacts', 'playwright-report']) {
      expect(ignored.test(normalizePath(join(root, directory)))).toBe(true);
      expect(ignored.test(normalizePath(join(root, directory, 'runtime', 'entry.mjs')))).toBe(true);
    }
    for (const file of ['src/build/entry.ts', 'electron/main/index.ts', 'shared/types.ts', 'resources/skills/example/SKILL.md', 'builder.ts']) {
      expect(ignored.test(normalizePath(join(root, file)))).toBe(false);
    }
    expect(ignored.test(normalizePath(join(root + '-other', 'build', 'entry.mjs')))).toBe(false);
  });

  it('observes source edits while leaving generated runtime trees unwatched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-dev-watch-'));
    const fixture: { root: string; server?: ViteDevServer } = { root };
    fixtures.push(fixture);
    const sources = ['src/build/entry.ts', 'electron/main.ts', 'shared/types.ts'];
    const generated = ['build/runtime/entry.mjs', 'release/app/entry.mjs', 'dist-electron/main.js', 'artifacts/result.json', 'playwright-report/index.html'];
    for (const file of [...sources, ...generated]) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), 'export const value = 1;\n');
    }
    let ready!: () => void;
    const watchReady = new Promise<void>((resolve) => { ready = resolve; });
    const events: string[] = [];
    fixture.server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true },
      server: { watch: { ignored: [getDevWatchIgnored(root)] } },
      plugins: [{
        name: 'observe-test-watcher',
        configureServer(server) {
          server.watcher.once('ready', ready);
          server.watcher.on('change', (file) => { events.push(normalizePath(relative(root, file))); });
        },
      }],
    });
    await watchReady;
    // A ready event may precede other initial paths queued by Vite; wait for
    // each expected source to be registered before modifying it.
    await expect.poll(() => {
      const watched = new Map(Object.entries(fixture.server!.watcher.getWatched())
        .map(([directory, files]) => [normalizePath(directory), files]));
      return sources.every((file) => {
        const pathname = normalizePath(join(root, file));
        const separator = pathname.lastIndexOf('/');
        return watched.get(pathname.slice(0, separator))?.includes(pathname.slice(separator + 1));
      });
    }, { timeout: 5000 }).toBe(true);
    const watchedDirectories = Object.keys(fixture.server.watcher.getWatched());
    expect(watchedDirectories.some((directory) => getDevWatchIgnored(root).test(normalizePath(directory)))).toBe(false);

    await Promise.all([...sources, ...generated].map((file) => writeFile(join(root, file), 'export const value = 2;\n')));
    await expect.poll(() => sources.every((file) => events.includes(file)), { timeout: 5000 }).toBe(true);
    expect(events.some((file) => generated.includes(file))).toBe(false);
  }, 15000);
});
