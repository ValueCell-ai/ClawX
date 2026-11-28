import { navigateToSection } from './fixtures/navigation';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const TEST_AGENT_ID = 'agent';
const ZERO_TOKEN_SESSION_ID = 'agent-session-zero-token';
const NONZERO_TOKEN_SESSION_ID = 'agent-session-nonzero-token';
const GATEWAY_INJECTED_SESSION_ID = 'agent-session-gateway-injected';
const DELIVERY_MIRROR_SESSION_ID = 'agent-session-delivery-mirror';

async function seedTokenUsageTranscripts(homeDir: string): Promise<void> {
  const sessionDir = join(homeDir, '.openclaw', 'agents', TEST_AGENT_ID, 'sessions');
  const now = new Date();
  const zeroTimestamp = new Date(now.getTime() - 20_000).toISOString();
  const nonzeroTimestamp = now.toISOString();
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, `${ZERO_TOKEN_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        timestamp: zeroTimestamp,
        message: {
          role: 'assistant',
          model: 'kimi-k2.6',
          provider: 'kimi',
          usage: {
            total_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(sessionDir, `${NONZERO_TOKEN_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        timestamp: nonzeroTimestamp,
        message: {
          role: 'assistant',
          model: 'kimi-k2.6',
          provider: 'kimi',
          usage: {
            total_tokens: 27,
            input_tokens: 20,
            output_tokens: 7,
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(sessionDir, `${GATEWAY_INJECTED_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        timestamp: new Date(now.getTime() - 10_000).toISOString(),
        message: {
          role: 'assistant',
          model: 'gateway-injected',
          usage: {
            total_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(sessionDir, `${DELIVERY_MIRROR_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        timestamp: new Date(now.getTime() - 5_000).toISOString(),
        message: {
          role: 'assistant',
          model: 'delivery-mirror',
          usage: {
            total_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );
}

test('shows transcript usage while excluding internal gateway entries', async ({ launchElectronApp, homeDir }) => {
  await seedTokenUsageTranscripts(homeDir);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
    });
    const page = await getStableWindow(app);
    await page.reload();
    await navigateToSection(page, 'models');
    await page.getByTestId('models-tab-usage').click();

    const rows = page.getByTestId('token-usage-entry');
    await expect(rows).toHaveCount(2);
    for (const [sessionId, total] of [[ZERO_TOKEN_SESSION_ID, '0'], [NONZERO_TOKEN_SESSION_ID, '27']]) {
      const row = rows.filter({ has: page.getByText(sessionId, { exact: true }) });
      await expect(row.getByText('kimi-k2.6', { exact: true })).toBeVisible();
      await expect(row.getByText(`kimi · ${TEST_AGENT_ID}`, { exact: true })).toBeVisible();
      await expect(row.locator('[data-total-value]')).toHaveText(total);
    }
    await expect(rows.filter({ hasText: GATEWAY_INJECTED_SESSION_ID })).toHaveCount(0);
    await expect(rows.filter({ hasText: DELIVERY_MIRROR_SESSION_ID })).toHaveCount(0);
  } finally {
    await closeElectronApp(app);
  }
});
