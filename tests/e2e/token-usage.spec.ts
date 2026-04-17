import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

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
          model: 'kimi-k2.5',
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
          model: 'kimi-k2.5',
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

test.describe('ClawX token usage history', () => {

  async function validateUsageHistory(page: Page): Promise<void> {
    const usageHistory = await page.evaluate(async () => {
      return window.electron.ipcRenderer.invoke('usage:recentTokenHistory', 20);
    });
    if (!Array.isArray(usageHistory) || usageHistory.length === 0) {
      throw new Error('No usage history found in IPC usage:recentTokenHistory');
    }

    const hasSeededEntries = usageHistory.some((entry) =>
      typeof entry?.sessionId === 'string' && (
        entry.sessionId === ZERO_TOKEN_SESSION_ID
        || entry.sessionId === NONZERO_TOKEN_SESSION_ID
      ),
    );
    if (!hasSeededEntries) {
      throw new Error('Seeded transcript session IDs were not found in IPC usage history');
    }
  }

  test('displays assistant usage for agent directory with zero and non-zero tokens', async ({ page, homeDir }) => {
    await seedTokenUsageTranscripts(homeDir);
    await completeSetup(page);
    await validateUsageHistory(page);

    const usageHistory = await page.evaluate(async () => {
      return window.electron.ipcRenderer.invoke('usage:recentTokenHistory', 20);
    });

    const zeroEntry = usageHistory.find((entry) => entry?.sessionId === ZERO_TOKEN_SESSION_ID);
    const nonzeroEntry = usageHistory.find((entry) => entry?.sessionId === NONZERO_TOKEN_SESSION_ID);
    expect(zeroEntry).toBeTruthy();
    expect(nonzeroEntry).toBeTruthy();
    expect(nonzeroEntry?.totalTokens).toBe(27);
    expect(zeroEntry?.totalTokens).toBe(0);
    expect(zeroEntry?.agentId).toBe(TEST_AGENT_ID);
    expect(nonzeroEntry?.agentId).toBe(TEST_AGENT_ID);
    expect(zeroEntry?.provider).toBe('kimi');
    expect(nonzeroEntry?.provider).toBe('kimi');
  });

  // TODO: This test needs a reliable way to inject mocked gateway status into
  // the renderer's Zustand store in CI (where no real OpenClaw runtime exists).
  // The hostapi:fetch mock + page.reload approach fails because the reload
  // re-triggers setup flow. Skipping until we add an E2E-aware store hook.
  test.skip('hides gateway internal usage rows from the usage list overview', async ({ page, homeDir }) => {
    await seedTokenUsageTranscripts(homeDir);
    await completeSetup(page);
    await validateUsageHistory(page);

    await page.getByTestId('sidebar-nav-models').click();
    await expect(page.getByTestId('models-page')).toBeVisible();

    const usageEntryRows = page.getByTestId('token-usage-entry');
    await expect.poll(async () => await usageEntryRows.count()).toBe(2);

    await expect(page.locator('[data-testid="token-usage-entry"]', { hasText: GATEWAY_INJECTED_SESSION_ID })).toHaveCount(0);
    await expect(page.locator('[data-testid="token-usage-entry"]', { hasText: DELIVERY_MIRROR_SESSION_ID })).toHaveCount(0);
  });
});
