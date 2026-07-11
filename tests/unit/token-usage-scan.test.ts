import { mkdir, rm, utimes, writeFile } from 'fs/promises';
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
              cost: {
                total_usd: 0.0042,
              },
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
          runtimeKind: 'openclaw',
          agentId: 'custom-custom25',
          sessionId: 'f8e66f77-0125-4e2f-b750-9c4de01e8f5a',
          model: 'gpt-5.2-2025-12-11',
          totalTokens: 17756,
          costUsd: 0.0042,
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
        runtimeKind: 'cc-connect',
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

  it('maps cc-connect named and orphan session usage to stable agent session keys', async () => {
    const ccConnectSessionsDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    await mkdir(ccConnectSessionsDir, { recursive: true });
    await writeFile(
      join(ccConnectSessionsDir, 'clawx-research_1234abcd.json'),
      JSON.stringify({
        sessions: {
          active: {
            id: 'active',
            history: [{
              role: 'assistant',
              timestamp: '2026-06-14T03:00:00.000Z',
              model: 'active-model',
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            }],
          },
          named: {
            id: 'named',
            history: [{
              role: 'assistant',
              timestamp: '2026-06-14T04:00:00.000Z',
              model: 'named-model',
              usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
            }],
          },
          orphan: {
            id: 'orphan',
            history: [{
              role: 'assistant',
              timestamp: '2026-06-14T05:00:00.000Z',
              model: 'orphan-model',
              usage: { input_tokens: 3, output_tokens: 3, total_tokens: 6 },
            }],
          },
        },
        active_session: { 'clawx:research:main': 'active' },
        user_sessions: { 'clawx:research:main': ['active', 'named'] },
      }, null, 2),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    const entries = await getRecentTokenUsageHistory({ runtimeKind: 'cc-connect' });

    expect(entries).toEqual([
      expect.objectContaining({
        runtimeKind: 'cc-connect',
        agentId: 'research',
        sessionId: 'agent:research:orphan',
        model: 'orphan-model',
        totalTokens: 6,
      }),
      expect.objectContaining({
        runtimeKind: 'cc-connect',
        agentId: 'research',
        sessionId: 'agent:research:named',
        model: 'named-model',
        totalTokens: 4,
      }),
      expect.objectContaining({
        runtimeKind: 'cc-connect',
        agentId: 'research',
        sessionId: 'agent:research:main',
        model: 'active-model',
        totalTokens: 2,
      }),
    ]);
  });

  it('preserves cc-connect usage for OpenClaw-compatible cron session keys', async () => {
    const ccConnectSessionsDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    await mkdir(ccConnectSessionsDir, { recursive: true });
    await writeFile(
      join(ccConnectSessionsDir, 'clawx-main_1234abcd.json'),
      JSON.stringify({
        sessions: {
          'cron:job-123': {
            id: 'cron:job-123',
            history: [{
              role: 'assistant',
              timestamp: '2026-06-14T06:00:00.000Z',
              model: 'cron-model',
              usage: { input_tokens: 7, output_tokens: 8, total_tokens: 15 },
            }],
          },
        },
        active_session: { 'clawx:main:cron:job-123': 'cron:job-123' },
        user_sessions: { 'clawx:main:cron:job-123': ['cron:job-123'] },
      }, null, 2),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    await expect(getRecentTokenUsageHistory({ runtimeKind: 'cc-connect' })).resolves.toEqual([
      expect.objectContaining({
        runtimeKind: 'cc-connect',
        agentId: 'main',
        sessionId: 'agent:main:cron:job-123',
        model: 'cron-model',
        totalTokens: 15,
      }),
    ]);
  });

  it('filters token usage by runtime kind when requested', async () => {
    const openclawDir = join(testHome, '.openclaw', 'agents', 'main', 'sessions');
    const ccConnectSessionsDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    await mkdir(openclawDir, { recursive: true });
    await mkdir(ccConnectSessionsDir, { recursive: true });

    await writeFile(
      join(openclawDir, 'openclaw-session.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-06-14T02:00:00.000Z',
          message: {
            role: 'assistant',
            model: 'openclaw-model',
            usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
          },
        }),
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(ccConnectSessionsDir, 'clawx-main_1234abcd.json'),
      JSON.stringify({
        sessions: {
          s1: {
            id: 's1',
            history: [{
              role: 'assistant',
              timestamp: '2026-06-14T03:00:00.000Z',
              model: 'cc-connect-model',
              usage: { input_tokens: 5, output_tokens: 6, total_tokens: 11 },
            }],
          },
        },
        active_session: { 'clawx:main:main': 's1' },
      }, null, 2),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    const openclawEntries = await getRecentTokenUsageHistory({ runtimeKind: 'openclaw' });
    const ccConnectEntries = await getRecentTokenUsageHistory({ runtimeKind: 'cc-connect' });

    expect(openclawEntries).toEqual([
      expect.objectContaining({
        runtimeKind: 'openclaw',
        sessionId: 'openclaw-session',
        model: 'openclaw-model',
      }),
    ]);
    expect(ccConnectEntries).toEqual([
      expect.objectContaining({
        runtimeKind: 'cc-connect',
        sessionId: 'agent:main:main',
        model: 'cc-connect-model',
      }),
    ]);
  });

  it('sorts all cc-connect usage candidates by event timestamp before applying the limit', async () => {
    const ccConnectSessionsDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    await mkdir(ccConnectSessionsDir, { recursive: true });
    const olderUsageNewerFile = join(ccConnectSessionsDir, 'clawx-main_newerfile.json');
    const newerUsageOlderFile = join(ccConnectSessionsDir, 'clawx-research_olderfile.json');
    await writeFile(
      olderUsageNewerFile,
      JSON.stringify({
        sessions: {
          s1: {
            id: 's1',
            history: [{
              role: 'assistant',
              timestamp: '2026-06-14T03:00:00.000Z',
              model: 'gpt-5.1-codex-old',
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            }],
          },
        },
        active_session: { 'clawx:main:main': 's1' },
      }, null, 2),
      'utf8',
    );
    await writeFile(
      newerUsageOlderFile,
      JSON.stringify({
        sessions: {
          s2: {
            id: 's2',
            history: [{
              role: 'assistant',
              timestamp: '2026-06-14T04:00:00.000Z',
              model: 'gpt-5.1-codex-new',
              usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
            }],
          },
        },
        active_session: { 'clawx:research:desk': 's2' },
      }, null, 2),
      'utf8',
    );
    await utimes(olderUsageNewerFile, new Date('2026-06-14T05:00:00.000Z'), new Date('2026-06-14T05:00:00.000Z'));
    await utimes(newerUsageOlderFile, new Date('2026-06-14T02:00:00.000Z'), new Date('2026-06-14T02:00:00.000Z'));

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    const entries = await getRecentTokenUsageHistory(1);

    expect(entries).toEqual([
      expect.objectContaining({
        runtimeKind: 'cc-connect',
        agentId: 'research',
        sessionId: 'agent:research:desk',
        model: 'gpt-5.1-codex-new',
        totalTokens: 4,
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
                total_cost_usd: '0.0123',
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
        runtimeKind: 'cc-connect',
        agentId: 'research',
        sessionId: 'agent:research:desk',
        provider: 'codex',
        inputTokens: 51_101,
        outputTokens: 211,
        cacheReadTokens: 7_552,
        totalTokens: 51_312,
        costUsd: 0.0123,
      }),
    ]);
  });

  it('falls back to managed Codex session_meta workspace while cc-connect session mappings lag', async () => {
    const codexSessionId = '019ee57f-c0cb-7440-aa79-f3e07489b29f';
    const ccConnectDir = join(testUserData, 'runtimes', 'cc-connect');
    const workspaceDir = join(ccConnectDir, 'workspaces', 'main');
    const managedCodexTranscriptDir = join(ccConnectDir, 'codex-home', 'sessions', '2026', '06', '20');
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(managedCodexTranscriptDir, { recursive: true });
    await writeFile(join(ccConnectDir, 'config.toml'), [
      '[[projects]]',
      'name = "clawx-main"',
      '',
      '[projects.agent.options]',
      `work_dir = "${workspaceDir}"`,
      '',
    ].join('\n'), 'utf8');
    await writeFile(
      join(managedCodexTranscriptDir, `rollout-2026-06-20T22-46-55-${codexSessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-06-20T14:05:20.000Z',
          type: 'session_meta',
          payload: {
            id: codexSessionId,
            cwd: workspaceDir.replace(/^\/tmp\//, '/private/tmp/'),
            model_provider: 'clawx-openai',
          },
        }),
        JSON.stringify({
          timestamp: '2026-06-20T14:05:21.000Z',
          type: 'turn_context',
          payload: {
            model: 'gpt-clawx-local',
          },
        }),
        JSON.stringify({
          timestamp: '2026-06-20T14:05:28.576Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 12,
                cached_input_tokens: 0,
                output_tokens: 7,
                total_tokens: 19,
              },
            },
          },
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    await expect(getRecentTokenUsageHistory({ runtimeKind: 'cc-connect' })).resolves.toEqual([
      expect.objectContaining({
        runtimeKind: 'cc-connect',
        agentId: 'main',
        sessionId: 'agent:main:main',
        provider: 'clawx-openai',
        model: 'gpt-clawx-local',
        inputTokens: 12,
        outputTokens: 7,
        totalTokens: 19,
      }),
    ]);
  });

  it('does not read user-global Codex transcripts for cc-connect usage', async () => {
    const codexSessionId = '019ee57f-c0cb-7440-aa79-f3e07489b29f';
    const ccConnectSessionsDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    const globalCodexTranscriptDir = join(testHome, '.codex', 'sessions', '2026', '06', '20');
    await mkdir(ccConnectSessionsDir, { recursive: true });
    await mkdir(globalCodexTranscriptDir, { recursive: true });

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
      join(globalCodexTranscriptDir, `rollout-2026-06-20T22-46-55-${codexSessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-06-20T14:05:28.576Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 9,
                output_tokens: 1,
                total_tokens: 10,
              },
            },
          },
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    await expect(getRecentTokenUsageHistory()).resolves.toEqual([]);
  });

  it('maps managed Codex transcript usage for cc-connect orphan sessions to stable agent session keys', async () => {
    const codexSessionId = '019ee57f-c0cb-7440-aa79-f3e07489b29f';
    const ccConnectSessionsDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    const managedCodexTranscriptDir = join(testUserData, 'runtimes', 'cc-connect', 'codex-home', 'sessions', '2026', '06', '20');
    await mkdir(ccConnectSessionsDir, { recursive: true });
    await mkdir(managedCodexTranscriptDir, { recursive: true });

    await writeFile(
      join(ccConnectSessionsDir, 'clawx-research_1234abcd.json'),
      JSON.stringify({
        sessions: {
          orphan: {
            id: 'orphan',
            agent_session_id: codexSessionId,
            history: [],
          },
        },
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(managedCodexTranscriptDir, `rollout-2026-06-20T22-46-55-${codexSessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-06-20T14:05:28.576Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 9,
                output_tokens: 1,
                total_tokens: 10,
              },
            },
          },
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    await expect(getRecentTokenUsageHistory({ runtimeKind: 'cc-connect' })).resolves.toEqual([
      expect.objectContaining({
        runtimeKind: 'cc-connect',
        agentId: 'research',
        sessionId: 'agent:research:orphan',
        provider: 'codex',
        totalTokens: 10,
      }),
    ]);
  });

  it('does not read unlinked managed CODEX_HOME transcripts for cc-connect usage', async () => {
    const linkedCodexSessionId = '019ee57f-c0cb-7440-aa79-f3e07489b29f';
    const unlinkedCodexSessionId = '019ee57f-c0cb-7440-aa79-f3e07489b2aa';
    const ccConnectSessionsDir = join(testUserData, 'runtimes', 'cc-connect', 'data', 'sessions');
    const managedCodexTranscriptDir = join(testUserData, 'runtimes', 'cc-connect', 'codex-home', 'sessions', '2026', '06', '20');
    await mkdir(ccConnectSessionsDir, { recursive: true });
    await mkdir(managedCodexTranscriptDir, { recursive: true });

    await writeFile(
      join(ccConnectSessionsDir, 'clawx-research_1234abcd.json'),
      JSON.stringify({
        sessions: {
          s1: {
            id: 's1',
            agent_session_id: linkedCodexSessionId,
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
      join(managedCodexTranscriptDir, `rollout-2026-06-20T22-46-55-${unlinkedCodexSessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-06-20T14:05:28.576Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 9,
                output_tokens: 1,
                total_tokens: 10,
              },
            },
          },
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    await expect(getRecentTokenUsageHistory()).resolves.toEqual([]);
  });
});
