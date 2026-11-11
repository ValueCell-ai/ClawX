import { _electron as electron, expect, test } from '@playwright/test';
import electronBinaryPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Exercise the native Electron boundary with a synthetic child and isolated
// app data. No Gateway, customer profile, provider, or listening port is needed.
for (const withManifest of [false, true]) {
  test(`utility process starts with ${withManifest ? 'a' : 'no'} cron migration manifest`, async () => {
    const testInfo = test.info();
    const directory = testInfo.outputPath('isolated-electron');
    await mkdir(directory, { recursive: true });
    const entry = join(directory, 'main.cjs');
    const childEntry = join(directory, 'child.mjs');
    const manifest = withManifest ? join(directory, '迁移 evidence.json') : null;
    if (manifest) await writeFile(manifest, JSON.stringify({ version: 1, jobs: [] }));
    await writeFile(childEntry, `
      process.stdout.write(JSON.stringify({
        manifest: process.env.CLAWX_CRON_MIGRATION_MANIFEST ?? null,
        proxy: process.env.HTTP_PROXY ?? '',
        debug: process.env.OPENCLAW_DEBUG,
      }));
      process.exitCode = 0;
    `);
    await build({
      stdin: {
        contents: `
          import { app } from 'electron';
          import { forkOpenClawUtilityProcess } from './electron/utils/openclaw-utility-process';
          import { writeCronInferenceLaunchManifest } from './electron/gateway/cron-inference-continuity';
          import { withCronMigrationManifestEnv } from './electron/gateway/config-sync-env';
          app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
          app.whenReady();
          export async function probe() {
            const manifest = await writeCronInferenceLaunchManifest(
              ${JSON.stringify(directory)}, ${JSON.stringify(manifest)} ?? undefined, [],
            );
            const env = withCronMigrationManifestEnv({ ...process.env, HTTP_PROXY: '' }, manifest);
            const hasManifest = Object.hasOwn(env, 'CLAWX_CRON_MIGRATION_MANIFEST');
            return await new Promise((resolve, reject) => {
              const child = forkOpenClawUtilityProcess(${JSON.stringify(childEntry)}, [], {
                env, stdio: 'pipe', serviceName: 'ClawX launch environment regression',
              });
              let stdout = '';
              let stderr = '';
              const timeout = setTimeout(() => { child.kill(); reject(new Error('Child timed out')); }, 15000);
              child.stdout.on('data', chunk => { stdout += chunk; });
              child.stderr.on('data', chunk => { stderr += chunk; });
              child.on('error', error => { clearTimeout(timeout); reject(error); });
              child.on('exit', code => { clearTimeout(timeout); resolve({ code, stdout, stderr, hasManifest }); });
            });
          }
        `,
        loader: 'ts', resolveDir: resolve('.'),
      },
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: entry,
      tsconfig: resolve('tsconfig.node.json'),
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // An absent launch value must also suppress a stale inherited manifest.
    env.CLAWX_CRON_MIGRATION_MANIFEST = join(directory, 'stale-manifest.json');
    env.HTTP_PROXY = 'http://127.0.0.1:9';
    const app = await electron.launch({ executablePath: String(electronBinaryPath), args: [entry], env });
    try {
      const result = await app.evaluate(async ({ app }, entry) => {
        await app.whenReady();
        const main = process.mainModule!.require(entry) as {
          probe: () => Promise<{ code: number; stdout: string; stderr: string; hasManifest: boolean }>;
        };
        return await main.probe();
      }, entry);
      expect(result.code, result.stderr).toBe(0);
      expect(result.hasManifest).toBe(withManifest);
      expect(JSON.parse(result.stdout)).toEqual({ manifest, proxy: '', debug: '1' });
    } finally {
      await app.close();
    }
  });
}
