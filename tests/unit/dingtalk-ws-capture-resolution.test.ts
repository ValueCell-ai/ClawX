import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const WS_PACKAGE = realpathSync(path.resolve(process.cwd(), 'node_modules/ws'));

/**
 * OpenClaw's plugin loader short-circuits to the capture symlink URL. Node
 * then resolves bare imports from that URL instead of the real package
 * directory, so `ws` linked only beside the real `dingtalk-stream` is invisible.
 */
const RESOLVE_PROBE = `
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const entryUrl = pathToFileURL(process.argv[2]).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === entryUrl) {
      return { url: entryUrl, shortCircuit: true, format: 'module' };
    }
    return nextResolve(specifier, context);
  },
});

try {
  await import(entryUrl);
  console.log('OK');
} catch (error) {
  const message = error instanceof Error ? error.message.split('\\n')[0] : String(error);
  console.log(message);
  process.exitCode = 1;
}
`;

describe('DingTalk capture symlink resolution', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds ws from the dingtalk-stream symlink only when the plugin node_modules links it', () => {
    const missing = createCapture({ linkWsIntoPlugin: false });
    const missingResult = importThroughCaptureSymlink(missing.entry);
    expect(missingResult.status).not.toBe(0);
    expect(missingResult.stdout).toContain("Cannot find package 'ws' imported from");
    expect(missingResult.stdout).toContain(`${path.join('package-0', 'node_modules', 'dingtalk', 'node_modules', 'dingtalk-stream')}`);

    const linked = createCapture({ linkWsIntoPlugin: true });
    const linkedResult = importThroughCaptureSymlink(linked.entry);
    expect(linkedResult.status).toBe(0);
    expect(linkedResult.stdout.trim()).toBe('OK');
  });

  function createCapture(options: { linkWsIntoPlugin: boolean }): { root: string; entry: string } {
    const root = mkdtempSync(path.join(tmpdir(), 'dingtalk-ws-capture-'));
    roots.push(root);

    const streamDir = path.join(root, 'package-10', 'node_modules', 'dingtalk-stream');
    const streamEntry = path.join(streamDir, 'dist', 'index.mjs');
    mkdirSync(path.dirname(streamEntry), { recursive: true });
    writeFileSync(streamEntry, "import 'ws';\n");
    writeFileSync(path.join(streamDir, 'package.json'), JSON.stringify({
      name: 'dingtalk-stream',
      version: '2.1.4',
      type: 'module',
    }));
    symlinkSync(WS_PACKAGE, path.join(root, 'package-10', 'node_modules', 'ws'), 'junction');

    const pluginModules = path.join(root, 'package-0', 'node_modules', 'dingtalk', 'node_modules');
    mkdirSync(pluginModules, { recursive: true });
    symlinkSync(streamDir, path.join(pluginModules, 'dingtalk-stream'), 'junction');
    if (options.linkWsIntoPlugin) {
      symlinkSync(WS_PACKAGE, path.join(pluginModules, 'ws'), 'junction');
    }

    return {
      root,
      entry: path.join(pluginModules, 'dingtalk-stream', 'dist', 'index.mjs'),
    };
  }

  function importThroughCaptureSymlink(entry: string): { status: number | null; stdout: string; stderr: string } {
    const probe = path.join(path.dirname(entry), 'resolve-probe.mjs');
    writeFileSync(probe, RESOLVE_PROBE);
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_PRESERVE_SYMLINKS;
    const result = spawnSync(process.execPath, [probe, entry], {
      encoding: 'utf8',
      env,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }
});
