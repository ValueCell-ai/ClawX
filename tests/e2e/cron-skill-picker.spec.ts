import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('cron skill picker', () => {
  test('inserts a skill token into the scheduled task message without preview', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {},
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
          },
        },
        [stableStringify(['/api/cron/jobs', 'GET'])]: {
          ok: true,
          data: { status: 200, ok: true, json: [] },
        },
        [stableStringify(['/api/channels/accounts', 'GET'])]: {
          ok: true,
          data: { status: 200, ok: true, json: { success: true, channels: [] } },
        },
        [stableStringify(['/api/agents', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              agents: [{
                id: 'main',
                name: 'Main Agent',
                isDefault: true,
                modelDisplay: 'Default Model',
                modelRef: 'openai/gpt-5.5',
                overrideModelRef: null,
                inheritedModel: true,
                workspace: '/tmp/clawx-main-agent',
                agentDir: '/tmp/clawx-main-agent/agent',
                mainSessionKey: 'main/default',
                channelTypes: [],
              }],
              defaultAgentId: 'main',
              defaultModelRef: 'openai/gpt-5.5',
              configuredChannelTypes: [],
              channelOwners: {},
              channelAccountOwners: {},
            },
          },
        },
        [stableStringify(['/api/skills/quick-access', 'POST'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              success: true,
              skills: [{
                name: 'create-skill',
                description: 'Create and refine reusable skills.',
                source: 'workspace',
                sourceLabel: 'Workspace',
                manifestPath: '/tmp/clawx-main-agent/skill/create-skill/SKILL.md',
                baseDir: '/tmp/clawx-main-agent/skill/create-skill',
              }],
            },
          },
        },
      },
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-cron').click();
    await page.getByTestId('cron-new-task-button').click();
    await expect(page.getByTestId('cron-task-dialog')).toBeVisible();

    const message = page.locator('#message');
    await message.click();
    await message.fill('Draft a new helper');

    await page.getByTestId('cron-skill-button').click();
    const skillOption = page.getByTestId('cron-skill-option-create-skill');
    await expect(skillOption).toBeVisible();
    await skillOption.click();

    await expect(message).toHaveValue(/\/create-skill {2}/);

    const token = page.getByTestId('cron-skill-token');
    await expect(token).toHaveText('/create-skill');
    // The cron dialog renders skill tokens as non-interactive spans (no preview).
    await expect(token).toHaveJSProperty('tagName', 'SPAN');
  });
});
