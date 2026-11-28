import { navigateToSection } from './fixtures/navigation';
import { completeSetup, expect, getRecordedHostInvocations, installIpcMocks, test } from './fixtures/electron';
import type { AgentSummary } from '../../shared/types/agent';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const SESSIONS_LIST_PAYLOAD = {
  includeDerivedTitles: true,
  includeLastMessage: true,
};
const MAIN_SESSION_KEY = 'agent:main:main';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const MAIN_AGENT = {
  id: 'main',
  name: 'Main',
  isDefault: true,
  modelDisplay: 'Default Model',
  inheritedModel: true,
  workspace: DEFAULT_WORKSPACE,
  agentDir: '~/.openclaw/agents/main/agent',
  mainSessionKey: MAIN_SESSION_KEY,
  channelTypes: [],
} satisfies AgentSummary;

test.describe('ClawX gateway lifecycle resilience', () => {
  test('app remains fully navigable while gateway is disconnected', async ({ page }) => {
    // In E2E mode, gateway auto-start is skipped, so the app starts
    // with gateway in "stopped" state — simulating the disconnected scenario.
    await completeSetup(page);

    // Navigate through all major pages to verify nothing crashes
    // when the gateway is not running.
    await navigateToSection(page, 'models');
    await expect(page.getByTestId('models-page')).toBeVisible();

    await navigateToSection(page, 'agents');
    await expect(page.getByTestId('agents-page')).toBeVisible();

    await navigateToSection(page, 'channels');
    await expect(page.getByTestId('channels-page')).toBeVisible();

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();

    await page.getByTestId('sidebar-new-chat').click();
    await expect(page.getByTestId('chat-composer-gateway-status')).toHaveText('stopped');
  });

  test('composer reflects gateway startup, disconnection and recovery', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'stopped', port: 18789 },
    });
    await completeSetup(page);

    const indicator = page.getByTestId('chat-composer-gateway-status');
    await expect(indicator).toHaveText('stopped');

    for (const [status, label] of [
      [{ state: 'running', pid: 12345, gatewayReady: false }, 'starting'],
      [{ state: 'running', pid: 12345, gatewayReady: true }, 'connected'],
      [{ state: 'error', error: 'WebSocket closed before handshake' }, 'error'],
      [{ state: 'reconnecting', reconnectAttempts: 1 }, 'reconnecting'],
      [{ state: 'running', pid: 23456, gatewayReady: true }, 'connected'],
    ] as const) {
      await electronApp.evaluate(({ BrowserWindow }, nextStatus) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('gateway:status-changed', {
          port: 18789,
          ...nextStatus,
        });
      }, status);
      await expect(indicator).toHaveText(label);
    }
  });

  test('uses the existing sidebar restart indicator for owned recovery instead of page-level warnings', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 100, connectedAt: 1, gatewayReady: true },
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 100, connectedAt: 1, gatewayReady: true },
          },
        },
        [stableStringify(['/api/agents', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { success: true, agents: [MAIN_AGENT], defaultAgentId: MAIN_AGENT.id },
          },
        },
        [stableStringify(['/api/channels/accounts', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              success: true,
              gatewayHealth: {
                state: 'unresponsive',
                reasons: ['gateway_unresponsive'],
                consecutiveHeartbeatMisses: 1,
                recovery: {
                  state: 'restart-executing',
                  lastAliveAt: 100,
                  deadlineAt: 280,
                  lastDeadlineProbeAt: 281,
                  lastDeadlineProbeResult: 'failed',
                  lastDeadlineProbeError: 'deadline-probe-timeout',
                  escalationReason: 'deadline-probe-timeout',
                  externallyManaged: false,
                },
              },
              channels: [],
            },
          },
        },
        [stableStringify(['/api/diagnostics/gateway-snapshot', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              capturedAt: 123,
              platform: 'darwin',
              gateway: {
                state: 'unresponsive',
                reasons: ['gateway_unresponsive'],
                consecutiveHeartbeatMisses: 1,
                recovery: {
                  state: 'restart-executing',
                  lastAliveAt: 100,
                  deadlineAt: 280,
                  lastDeadlineProbeAt: 281,
                  lastDeadlineProbeResult: 'failed',
                  lastDeadlineProbeError: 'deadline-probe-timeout',
                  escalationReason: 'deadline-probe-timeout',
                  externallyManaged: false,
                },
              },
              channels: [],
              clawxLogTail: 'clawx-log',
              gatewayLogTail: 'gateway-log',
              gatewayErrLogTail: '',
            },
          },
        },
        [stableStringify(['/api/cron/jobs', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: [],
          },
        },
      },
      gatewayRpc: {
        [stableStringify(['skills.status', null])]: { success: false, error: 'Gateway not connected' },
      },
    });

    await page.reload();
    await completeSetup(page);

    await navigateToSection(page, 'channels');
    await expect(page.getByTestId('channels-health-banner')).toBeVisible();
    await expect(page.getByTestId('channels-recovery-status')).toContainText(/ClawX is restarting its Gateway/i);
    await expect(page.getByText('Gateway control plane appears unresponsive.')).toBeVisible();
    await page.getByTestId('channels-toggle-diagnostics').click();
    await expect(page.getByTestId('channels-diagnostics')).toContainText('"state": "restart-executing"');

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'starting',
        port: 18789,
        gatewayReady: false,
      });
    });

    const restartIndicator = page.getByTestId('sidebar-gateway-restarting');
    await expect(restartIndicator).toHaveAttribute('data-state', 'visible');
    await expect(restartIndicator).toContainText(/Local service restarting|本地服务重启中/i);

    const oldWarningCopy = /Local service is not running|Start the local service|本地服务尚未启动|本地服务暂不可用|Gateway service is not running|Gateway is not running\.|Gateway 服务未运行|Agent 或频道变更|网关未运行。|没有活跃的网关|Scheduled tasks cannot be managed|无法管理定时任务|Channels cannot connect|无法管理频道/i;

    await navigateToSection(page, 'agents');
    await expect(page.getByTestId('agents-page')).toBeVisible();
    await expect(page.getByText(oldWarningCopy)).toHaveCount(0);

    await navigateToSection(page, 'channels');
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByText(oldWarningCopy)).toHaveCount(0);

    await page.getByTestId('sidebar-nav-cron').click();
    await expect(page.getByTestId('cron-page')).toBeVisible();
    await expect(page.getByText(oldWarningCopy)).toHaveCount(0);

    await navigateToSection(page, 'skills');
    await expect(page.getByTestId('skills-page')).toBeVisible();
    await expect(page.getByTestId('skills-gateway-banner')).toHaveCount(0);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'running',
        port: 18789,
        pid: 200,
        connectedAt: 2,
        gatewayReady: true,
      });
    });

    await expect(restartIndicator).toHaveAttribute('data-state', 'hidden');
  });

  test('chat sidebar session catalog reloads when gateway becomes ready after restart', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      recordHostInvocations: true,
      gatewayStatus: { state: 'running', port: 18789, pid: 100, connectedAt: 1, gatewayReady: false },
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 100, connectedAt: 1, gatewayReady: false },
          },
        },
        [stableStringify(['/api/agents', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { success: true, agents: [MAIN_AGENT], defaultAgentId: MAIN_AGENT.id },
          },
        },
        [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
          success: true,
          generation: 1,
        },
      },
      gatewayRpc: {
        [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
          success: true,
          result: { sessions: [] },
        },
      },
    });

    await page.reload();
    await completeSetup(page);
    await expect(page.getByTestId('sidebar-gateway-restarting')).toHaveAttribute('data-state', 'visible');
    await expect(page.getByText('history after ready')).toHaveCount(0);
    const chatReads = async () => (await getRecordedHostInvocations(electronApp))
      .filter(({ module, action }) => module === 'chat' && ['getAcpSessionFamily', 'loadAcpSession'].includes(action ?? ''))
      .map(({ action }) => action);
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    expect(await chatReads()).toEqual([]);

    await installIpcMocks(electronApp, {
      recordHostInvocations: true,
      gatewayStatus: { state: 'running', port: 18789, pid: 200, connectedAt: 2, gatewayReady: true },
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 200, connectedAt: 2, gatewayReady: true },
          },
        },
        [stableStringify(['/api/agents', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { success: true, agents: [MAIN_AGENT], defaultAgentId: MAIN_AGENT.id },
          },
        },
        [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
          success: true,
          generation: 1,
        },
      },
      gatewayRpc: {
        [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
          success: true,
          result: {
            sessions: [{ key: MAIN_SESSION_KEY, displayName: 'history after ready', updatedAt: 1001 }],
          },
        },
      },
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'running',
        port: 18789,
        pid: 200,
        connectedAt: 2,
        gatewayReady: true,
      });
    });

    const history = page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`);
    await expect(history).toContainText('history after ready', { timeout: 10_000 });
    expect(await chatReads()).toEqual([]);
    await history.click();
    await expect.poll(chatReads).toEqual(expect.arrayContaining(['getAcpSessionFamily', 'loadAcpSession']));
    await expect(page.getByTestId('sidebar-gateway-restarting')).toHaveAttribute('data-state', 'hidden');
  });

  test('chat sidebar keeps conversations while a restarted gateway is still admitting agent databases', async ({ electronApp, page }) => {
    const agentsRoute = {
      [stableStringify(['/api/agents', 'GET'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { success: true, agents: [MAIN_AGENT], defaultAgentId: MAIN_AGENT.id },
        },
      },
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
        success: true,
        generation: 1,
      },
    };
    const statusRoute = (status: Record<string, unknown>) => ({
      [stableStringify(['/api/gateway/status', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: status },
      },
    });
    const readyBeforeRestart = { state: 'running', port: 18789, pid: 100, connectedAt: 1, gatewayReady: true };
    const admittingAfterRestart = { state: 'running', port: 18789, pid: 200, connectedAt: 2, gatewayReady: false };
    const readyAfterAdmission = { ...admittingAfterRestart, gatewayReady: true };

    await installIpcMocks(electronApp, {
      gatewayStatus: readyBeforeRestart,
      hostApi: { ...statusRoute(readyBeforeRestart), ...agentsRoute },
      gatewayRpc: {
        [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
          success: true,
          result: {
            sessions: [{ key: MAIN_SESSION_KEY, displayName: 'conversation before restart', updatedAt: 1000 }],
          },
        },
      },
    });

    await page.reload();
    await completeSetup(page);
    const sessionRow = page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`);
    await expect(sessionRow).toContainText('conversation before restart', { timeout: 10_000 });

    // Restarted Gateway is connected but its agent database is still being admitted:
    // Main keeps gatewayReady=false, and sessions.list would answer with an empty catalog.
    await installIpcMocks(electronApp, {
      gatewayStatus: admittingAfterRestart,
      hostApi: { ...statusRoute(admittingAfterRestart), ...agentsRoute },
      gatewayRpc: {
        [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
          success: true,
          result: { sessions: [] },
        },
      },
    });
    await electronApp.evaluate(({ BrowserWindow }, status) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('gateway:status-changed', status);
    }, admittingAfterRestart);

    await expect(page.getByTestId('sidebar-gateway-restarting')).toHaveAttribute('data-state', 'visible');
    await page.waitForTimeout(1_500);
    await expect(sessionRow).toContainText('conversation before restart');

    await installIpcMocks(electronApp, {
      gatewayStatus: readyAfterAdmission,
      hostApi: { ...statusRoute(readyAfterAdmission), ...agentsRoute },
      gatewayRpc: {
        [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
          success: true,
          result: {
            sessions: [{ key: MAIN_SESSION_KEY, displayName: 'conversation after admission', updatedAt: 1001 }],
          },
        },
      },
    });
    await electronApp.evaluate(({ BrowserWindow }, status) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('gateway:status-changed', status);
    }, readyAfterAdmission);

    await expect(sessionRow).toContainText('conversation after admission', { timeout: 10_000 });
    await expect(page.getByTestId('sidebar-gateway-restarting')).toHaveAttribute('data-state', 'hidden');
  });
});
