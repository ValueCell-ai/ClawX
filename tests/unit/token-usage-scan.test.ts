import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-token-usage-${suffix}`,
    testUserData: `/tmp/clawx-token-usage-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

async function seedOpenClawUsage(
  agentId: string,
  fileName: string,
  timestamp = '2026-03-12T12:19:00.000Z',
): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  const sessionsDir = join(openclawDir, 'agents', agentId, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify({
    agents: { list: [{ id: 'main', name: 'Main', default: true }] },
  }), 'utf8');
  await writeFile(join(sessionsDir, fileName), JSON.stringify({
    type: 'message',
    timestamp,
    message: {
      role: 'assistant',
      model: 'gpt-5.2-2025-12-11',
      provider: 'openai',
      usage: {
        input: 17_649,
        output: 107,
        total: 17_756,
        cost: { total_usd: 0.0042 },
      },
    },
  }), 'utf8');
}

describe('token usage session scan', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('includes OpenClaw transcripts from agent directories that exist only on disk', async () => {
    await seedOpenClawUsage('custom-custom25', 'f8e66f77-0125-4e2f-b750-9c4de01e8f5a.jsonl');

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    await expect(getRecentTokenUsageHistory()).resolves.toEqual([
      expect.objectContaining({
        runtimeKind: 'openclaw',
        agentId: 'custom-custom25',
        sessionId: 'f8e66f77-0125-4e2f-b750-9c4de01e8f5a',
        model: 'gpt-5.2-2025-12-11',
        totalTokens: 17_756,
        costUsd: 0.0042,
      }),
    ]);
  });

  it.each([
    'session-a.deleted.jsonl',
    'session-b.jsonl.reset.2026-03-12T12-19-00.000Z',
  ])('keeps OpenClaw history file %s in usage aggregation', async (fileName) => {
    await seedOpenClawUsage('main', fileName);

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    const entries = await getRecentTokenUsageHistory({ runtimeKind: 'openclaw' });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ runtimeKind: 'openclaw', agentId: 'main' });
  });

  it('returns no usage for cc-connect without reading its private session or Codex files', async () => {
    const privateSessionDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    const privateCodexDir = join(testUserData, 'runtimes', 'cc-connect', 'codex-home', 'sessions');
    await mkdir(privateSessionDir, { recursive: true });
    await mkdir(privateCodexDir, { recursive: true });
    await writeFile(join(privateSessionDir, 'private.json'), JSON.stringify({ usage: { total_tokens: 99 } }), 'utf8');
    await writeFile(join(privateCodexDir, 'private.jsonl'), JSON.stringify({ type: 'token_count', total_tokens: 99 }), 'utf8');

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    await expect(getRecentTokenUsageHistory({ runtimeKind: 'cc-connect' })).resolves.toEqual([]);
  });

  it('does not mix OpenClaw usage into an explicit cc-connect query', async () => {
    await seedOpenClawUsage('main', 'openclaw-session.jsonl');

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    await expect(getRecentTokenUsageHistory({ runtimeKind: 'cc-connect' })).resolves.toEqual([]);
    await expect(getRecentTokenUsageHistory({ runtimeKind: 'openclaw' })).resolves.toHaveLength(1);
  });
});
