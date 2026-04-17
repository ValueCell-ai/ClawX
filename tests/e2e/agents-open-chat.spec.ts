import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

test.describe('Agents page direct chat handoff', () => {
  test('opens an agent main session from the Agents page', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789 },
        gatewayRpc: {
          '["sessions.list",{}]': {
            success: true,
            result: {
              sessions: [
                { key: 'agent:main:main', displayName: 'agent:main:main' },
              ],
            },
          },
          '["chat.history",{"sessionKey":"agent:research:main","limit":1000}]': {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          '["/api/gateway/status","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789 },
            },
          },
          '["/api/agents","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                agents: [
                  {
                    id: 'main',
                    name: 'Main',
                    isDefault: true,
                    modelDisplay: 'gpt-5',
                    modelRef: 'openai/gpt-5',
                    overrideModelRef: null,
                    inheritedModel: true,
                    workspace: '~/.openclaw/workspace',
                    agentDir: '~/.openclaw/agents/main/agent',
                    mainSessionKey: 'agent:main:main',
                    channelTypes: [],
                  },
                  {
                    id: 'research',
                    name: 'Research Desk',
                    isDefault: false,
                    modelDisplay: 'gpt-5',
                    modelRef: 'openai/gpt-5',
                    overrideModelRef: null,
                    inheritedModel: false,
                    workspace: '~/.openclaw/workspace',
                    agentDir: '~/.openclaw/agents/research/agent',
                    mainSessionKey: 'agent:research:main',
                    channelTypes: [],
                  },
                ],
                defaultAgentId: 'main',
                defaultModelRef: 'openai/gpt-5',
                configuredChannelTypes: [],
                channelOwners: {},
                channelAccountOwners: {},
              },
            },
          },
          '["/api/channels/accounts","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                channels: [],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await page.getByTestId('agents-open-chat-research').click();

      await expect(page.getByRole('button', { name: 'Add Agent' })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
