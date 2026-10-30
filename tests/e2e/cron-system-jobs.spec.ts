import { build } from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

const stableStringify = (value: unknown): string => {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
};

test('task list does not present OpenClaw internal automations', async ({ electronApp, page }) => {
  const base = {
    enabled: true, createdAtMs: 1_700_000_000_000, updatedAtMs: 1_700_000_000_000,
    schedule: { kind: 'cron', expr: '0 3 * * *' },
    payload: { kind: 'agentTurn', message: 'My own reminder' },
    delivery: { mode: 'none' }, state: {},
  };
  const jobs = [
    { ...base, id: 'system-heartbeat', name: 'heartbeat-main', declarationKey: 'heartbeat:main', payload: { kind: 'heartbeat' } },
    { ...base, id: 'system-dream', name: 'Memory Dreaming Promotion', declarationKey: 'memory-core:memory-dreaming-promotion' },
    { ...base, id: 'legacy-dream', name: 'Memory Dreaming Promotion', payload: {
      kind: 'agentTurn', message: '__openclaw_memory_core_short_term_promotion_dream__',
    } },
    { ...base, id: 'user-dream', name: 'Memory Dreaming Promotion' },
    { ...base, id: 'user-heartbeat', name: 'heartbeat-main' },
  ];
  await installIpcMocks(electronApp, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    hostApi: {
      [stableStringify(['/api/gateway/status', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } },
      },
    },
  });
  // Filter and transform raw Gateway jobs through the production Main service.
  // Mocking cron.list's final host response would bypass that entire boundary.
  const bundle = await build({
    stdin: {
      contents: `export { createCronApi } from ${JSON.stringify(resolve('electron/services/cron-api.ts'))};`,
      loader: 'ts', resolveDir: process.cwd(), sourcefile: 'cron-e2e-production-entry.ts',
    },
    bundle: true, external: ['electron'], format: 'cjs', platform: 'node',
    target: 'node24', tsconfig: resolve('tsconfig.node.json'), write: false,
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(resolve('electron/utils/paths.ts')).href) },
  });
  await electronApp.evaluate(({ ipcMain }, payload) => {
    const loaded = { exports: {} as { createCronApi: (options: unknown) => { list: () => Promise<unknown> } } };
    const require = process.mainModule!.require.bind(process.mainModule);
    new Function('require', 'module', 'exports', payload.code)(require, loaded, loaded.exports);
    const api = loaded.exports.createCronApi({ gatewayManager: {
      rpc: async (method: string) => {
        if (method !== 'cron.list') throw new Error(`Unexpected cron fixture RPC: ${method}`);
        return { jobs: payload.jobs };
      },
    } });
    type Request = { id?: string; module?: string; action?: string };
    const handlers = (ipcMain as unknown as {
      _invokeHandlers: Map<string, (event: unknown, request: Request) => unknown>;
    })._invokeHandlers;
    const previous = handlers.get('host:invoke')!;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Request) => {
      if (request.module === 'cron' && request.action === 'list') {
        return { id: request.id, ok: true, data: await api.list() };
      }
      return previous(event, request);
    });
  }, { code: bundle.outputFiles![0].text, jobs });
  await completeSetup(page);
  await page.getByTestId('sidebar-nav-cron').click();
  await expect(page.getByTestId('cron-job-card-user-dream')).toBeVisible();
  await expect(page.getByTestId('cron-job-card-user-heartbeat')).toBeVisible();
  await expect(page.getByTestId('cron-job-card-system-heartbeat')).toHaveCount(0);
  await expect(page.getByTestId('cron-job-card-system-dream')).toHaveCount(0);
  await expect(page.getByTestId('cron-job-card-legacy-dream')).toHaveCount(0);
});
