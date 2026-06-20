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
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

describe('token usage session scan', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('includes transcripts from agent directories that exist on disk but are not configured', async () => {
    const openclawDir = join(testHome, '.openclaw');
    await mkdir(openclawDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
    }, null, 2), 'utf8');

    const diskOnlySessionsDir = join(openclawDir, 'agents', 'custom-custom25', 'sessions');
    await mkdir(diskOnlySessionsDir, { recursive: true });
    await writeFile(
      join(diskOnlySessionsDir, 'f8e66f77-0125-4e2f-b750-9c4de01e8f5a.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:19:00.000Z',
          message: {
            role: 'assistant',
            model: 'gpt-5.2-2025-12-11',
            provider: 'openai',
            usage: {
              input: 17649,
              output: 107,
              total: 17756,
            },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    const entries = await getRecentTokenUsageHistory();

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: 'custom-custom25',
          sessionId: 'f8e66f77-0125-4e2f-b750-9c4de01e8f5a',
          model: 'gpt-5.2-2025-12-11',
          totalTokens: 17756,
        }),
      ]),
    );
  });

  it('includes cc-connect managed session stores without reading Codex transcripts', async () => {
    const ccConnectSessionsDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    await mkdir(ccConnectSessionsDir, { recursive: true });
    await writeFile(
      join(ccConnectSessionsDir, 'clawx-research_1234abcd.json'),
      JSON.stringify({
        sessions: {
          s1: {
            id: 's1',
            history: [{
              role: 'assistant',
              timestamp: '2026-06-14T03:00:00.000Z',
              model: 'gpt-5.1-codex',
              provider: 'openai',
              usage: {
                input_tokens: 13,
                output_tokens: 8,
                cache_read_tokens: 5,
              },
            }],
          },
        },
        active_session: {
          'clawx:research:desk': 's1',
        },
      }, null, 2),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    const entries = await getRecentTokenUsageHistory();

    expect(entries).toEqual([
      expect.objectContaining({
        agentId: 'research',
        sessionId: 'agent:research:desk',
        model: 'gpt-5.1-codex',
        provider: 'openai',
        inputTokens: 13,
        outputTokens: 8,
        cacheReadTokens: 5,
        totalTokens: 26,
      }),
    ]);
  });

  it('includes cc-connect Codex token_count events from managed CODEX_HOME transcripts', async () => {
    const codexSessionId = '019ee57f-c0cb-7440-aa79-f3e07489b29f';
    const ccConnectSessionsDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    const codexTranscriptDir = join(testUserData, 'runtimes', 'cc-connect', 'codex-home', 'sessions', '2026', '06', '20');
    await mkdir(ccConnectSessionsDir, { recursive: true });
    await mkdir(codexTranscriptDir, { recursive: true });

    await writeFile(
      join(ccConnectSessionsDir, 'clawx-research_1234abcd.json'),
      JSON.stringify({
        sessions: {
          s1: {
            id: 's1',
            agent_session_id: codexSessionId,
            history: [],
          },
        },
        active_session: {
          'clawx:research:desk': 's1',
        },
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(codexTranscriptDir, `rollout-2026-06-20T22-46-55-${codexSessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-06-20T14:05:28.576Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 1_179_291,
                cached_input_tokens: 307_456,
                output_tokens: 7_416,
                reasoning_output_tokens: 0,
                total_tokens: 1_186_707,
              },
              last_token_usage: {
                input_tokens: 51_101,
                cached_input_tokens: 7_552,
                output_tokens: 211,
                reasoning_output_tokens: 0,
                total_tokens: 51_312,
              },
              model_context_window: 258_400,
            },
          },
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    const entries = await getRecentTokenUsageHistory();

    expect(entries).toEqual([
      expect.objectContaining({
        agentId: 'research',
        sessionId: 'agent:research:desk',
        provider: 'codex',
        inputTokens: 51_101,
        outputTokens: 211,
        cacheReadTokens: 7_552,
        totalTokens: 51_312,
      }),
    ]);
  });
});
