// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { createBuilderInvocation } from '../../scripts/run-electron-builder.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = mkdtempSync(path.join(tmpdir(), 'clawx-signing-config-'));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

const toolRoot = path.join(temporary, 'tool with spaces');
const javaRoot = path.join(temporary, 'java with spaces');
for (const file of [
  path.join(javaRoot, 'bin', 'java.exe'),
  path.join(toolRoot, 'jar', 'code_sign_tool-1.3.3.jar'),
  path.join(toolRoot, 'conf', 'code_sign_tool.properties'),
]) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'offline fixture');
}
const env = {
  CLAWX_WINDOWS_SIGNING: '1',
  ES_USERNAME: 'synthetic@example.invalid', ES_PASSWORD: 'synthetic-secret',
  ES_CREDENTIAL_ID: 'synthetic-id', ES_TOTP_SECRET: 'synthetic-totp',
  WINDOWS_PUBLISHER_NAME: 'Example & Partners (Hong Kong), Limited',
  ES_CODE_SIGN_TOOL_PATH: toolRoot, JAVA_HOME: javaRoot,
};

describe('Windows builder invocation', () => {
  it.runIf(process.platform === 'win32')('merges signing into the real builder schema without losing package or update settings', async () => {
    const require = createRequire(import.meta.url);
    const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
    const { getConfig, validateConfiguration } = builderRequire('app-builder-lib/out/util/config/config.js');
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    try {
      const config = await getConfig(root, path.join(root, 'scripts/windows-builder-config.cjs'));
      await validateConfiguration(config, { isEnabled: false });
      const base = parse(readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
      for (const field of ['nsis', 'publish', 'extraResources', 'appId', 'productName']) {
        expect(config[field]).toEqual(base[field]);
      }
      expect(config.win.extraResources).toEqual(base.win.extraResources);
      expect(config.win.verifyUpdateCodeSignature).toBe(true);
      expect(config.forceCodeSigning).toBe(true);
      expect(config.win.signtoolOptions.publisherName).toEqual([env.WINDOWS_PUBLISHER_NAME]);
      expect(config.win.signtoolOptions.signingHashAlgorithms).toEqual(['sha256']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps unsigned local builds usable without a signing account', () => {
    const invocation = createBuilderInvocation({ args: ['--win', '--publish', 'never'], platform: 'win32', env: {} });
    expect(invocation.options.shell).toBe(false);
    expect(invocation.args.slice(1)).toEqual(['--win', '--publish', 'never']);
    expect(invocation.command).toBe(process.execPath);
  });

  it('selects the shared signing config without shell interpolation or credential arguments', () => {
    const invocation = createBuilderInvocation({ args: ['--win', '--publish', 'never'], platform: 'win32', env });
    expect(invocation.options.shell).toBe(false);
    expect(invocation.args.slice(-2)).toEqual(['--config', path.join(root, 'scripts', 'windows-builder-config.cjs')]);
    expect(invocation.args.join(' ')).not.toContain(env.ES_PASSWORD);
    expect(invocation.args.join(' ')).not.toContain(env.WINDOWS_PUBLISHER_NAME);
    expect(invocation.options.env.WINDOWS_PUBLISHER_NAME).toBe(env.WINDOWS_PUBLISHER_NAME);
  });

  it.each(['--mac', '--linux', '--config=other.yml', '-c', '-c.win.verifyUpdateCodeSignature=false', '--config.forceCodeSigning=false'])(
    'rejects conflicting release configuration %s', (arg) => {
      expect(() => createBuilderInvocation({ args: [arg], platform: 'win32', env })).toThrow();
    },
  );

  it('fails instead of launching an unsigned build when credentials are absent', () => {
    expect(() => createBuilderInvocation({ args: ['--win'], platform: 'win32', env: { CLAWX_WINDOWS_SIGNING: '1' } })).toThrow(/Missing Windows signing/);
  });

  it('preserves unsigned macOS file descriptor setup', () => {
    const invocation = createBuilderInvocation({ args: ['--mac'], platform: 'darwin', env: {} });
    expect(invocation.command).toBe('/bin/bash');
    expect(invocation.args[1]).toContain('ulimit -n 65536');
    expect(invocation.args[1]).toContain("'--mac'");
  });
});

type Step = { name?: string; uses?: string; if?: string; shell?: string; run?: string; env?: Record<string, string> };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

describe('Windows distribution workflows', () => {
  it.each(['release.yml', 'win-build-test.yml', 'package-win-manual.yml'])('%s requires the common signed build for every channel', (file) => {
    const text = readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    const workflow = parse(text) as Workflow;
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
    const build = steps.find((step) => step.run?.includes('pnpm run package:win'))!;
    const setup = steps.find((step) => step.run?.includes('./scripts/setup-windows-signing.ps1'))!;
    const java = steps.find((step) => step.uses?.startsWith('actions/setup-java@'))!;
    expect(build).toBeDefined();
    expect(build.shell).toBe('bash'); // GitHub uses errexit: preflight failure stops packaging.
    expect(build.run!.indexOf('--check')).toBeLessThan(build.run!.indexOf('pnpm run package:win'));
    expect(build.env?.CLAWX_WINDOWS_SIGNING).toBe('1');
    expect(build.env?.WINDOWS_PUBLISHER_NAME).toBe('${{ vars.WINDOWS_PUBLISHER_NAME }}');
    for (const name of ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET']) {
      expect(build.env?.[name]).toBe(`\${{ secrets.${name} }}`);
    }
    expect(steps.indexOf(java)).toBeLessThan(steps.indexOf(setup));
    expect(steps.indexOf(setup)).toBeLessThan(steps.indexOf(build));
    if (file === 'release.yml') {
      for (const step of [java, setup, build]) expect(step.if).toBe("matrix.platform == 'win'");
    }
    expect(text).not.toMatch(/signpath|UNSIGNED_EXE_COUNT|is_stable|Update latest.yml sha512/i);
  });
});
