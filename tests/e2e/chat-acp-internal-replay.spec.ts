import type { AcpSessionUpdateEnvelope } from '../../shared/acp-chat/types';
import { closeElectronApp, expect, getRecordedHostInvocations, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import {
  collectNativeReplay,
  nativeReplayMessages,
  NATIVE_REPLAY_QUOTED_REQUEST,
  NATIVE_REPLAY_SESSION_KEY,
  NATIVE_REPLAY_TEXT,
} from './fixtures/acp-native-replay';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

function replayHostMocks(sessionUpdates: AcpSessionUpdateEnvelope[]): Record<string, unknown> {
  const hostApi: Record<string, unknown> = {
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          agents: [{ id: 'main', name: 'main', workspace: '/workspace', mainSessionKey: NATIVE_REPLAY_SESSION_KEY }],
        },
      },
    },
    [stableStringify(['sessions', 'history', { sessionKey: NATIVE_REPLAY_SESSION_KEY, limit: 1000 }])]: {
      success: true, messages: nativeReplayMessages(),
    },
    [stableStringify(['sessions', 'turnTimings', { sessionKey: NATIVE_REPLAY_SESSION_KEY, limit: 1000 }])]: {
      success: true, timings: [],
    },
  };
  for (const workspace of ['/workspace', '~/.openclaw/workspace', '/']) {
    for (const createIfMissing of [false, true]) {
      const input = {
        sessionKey: NATIVE_REPLAY_SESSION_KEY,
        workspaceRoot: workspace,
        cwd: workspace,
        ...(createIfMissing ? { createIfMissing: true } : {}),
      };
      hostApi[stableStringify(['chat', 'loadAcpSession', input])] = {
        success: true, generation: 1, sessionUpdates,
      };
    }
  }
  return hostApi;
}

test('hides native ACP control-user replay while retaining quoted text, assistant and tool output after reload', async ({ launchElectronApp, homeDir }) => {
  // Exercise the installed adapter first: hand-crafted filtered ACP updates
  // would miss the full-transcript fallback responsible for this regression.
  const sessionUpdates = await collectNativeReplay(homeDir, nativeReplayMessages());
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [{ key: NATIVE_REPLAY_SESSION_KEY, displayName: 'main', workspacePath: '/workspace' }] },
        },
      },
      hostApi: replayHostMocks(sessionUpdates),
      recordHostInvocations: true,
    });
    const page = await getStableWindow(app);
    for (let load = 0; load < 2; load += 1) {
      const previousInvocations = (await getRecordedHostInvocations(app)).length;
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      const chat = page.getByTestId('acp-chat-timeline');
      await expect(chat).toBeVisible({ timeout: 30_000 });
      const users = chat.getByTestId('acp-user-message');
      await expect(users).toHaveCount(2);
      await expect(users.nth(0)).toHaveText(NATIVE_REPLAY_TEXT.request);
      await expect(users.nth(1)).toHaveText(NATIVE_REPLAY_QUOTED_REQUEST);
      await expect(chat.getByText(NATIVE_REPLAY_TEXT.exec, { exact: true })).toHaveCount(0);
      await expect(chat.getByText(NATIVE_REPLAY_TEXT.cron, { exact: true })).toHaveCount(0);
      await expect(chat.getByText(NATIVE_REPLAY_TEXT.hidden, { exact: true })).toHaveCount(0);
      // Wait for the real transcript supplement to inspect the raw hidden MEDIA
      // record, rather than checking absence before asynchronous recovery runs.
      await expect.poll(async () => {
        const calls = (await getRecordedHostInvocations(app)).slice(previousInvocations);
        const completed = calls.find((call) => call.module === 'diagnostics'
          && call.action === 'recordAcpTrace'
          && call.payload?.event === 'openclaw-media:history-request-succeeded');
        return (completed?.payload?.details as { candidateCount?: number } | undefined)?.candidateCount;
      }).toBe(0);
      await expect(chat.getByText('internal-report.pdf', { exact: false })).toHaveCount(0);
      await expect(chat.getByText('INTERNAL_HIDDEN_CAPTION', { exact: false })).toHaveCount(0);
      await expect(chat.getByText(NATIVE_REPLAY_TEXT.reply, { exact: true })).toBeVisible();
      await expect(chat.getByText(NATIVE_REPLAY_TEXT.explanation, { exact: true })).toBeVisible();
      await expect(chat.getByTestId('acp-thought-block')).toContainText(NATIVE_REPLAY_TEXT.thought);
      const tool = chat.getByTestId('acp-tool-call-card');
      await expect(tool).toBeVisible();
      await expect(tool).toContainText('inspect-report-state');
      await tool.getByTestId('acp-tool-toggle').click();
      await expect(tool.getByTestId('acp-tool-output-pre')).toContainText(NATIVE_REPLAY_TEXT.toolOutput);
    }
  } finally {
    await closeElectronApp(app);
  }
});
