import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX chat skill trigger', () => {
  test('renders the localized Chinese skill label after the @ trigger', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                language: 'zh',
                setupComplete: true,
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  { id: 'main', name: 'main' },
                  { id: 'research', name: 'research' },
                ],
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
                skills: [
                  {
                    name: 'create-skill',
                    description: 'Create and refine reusable skills.',
                    source: 'workspace',
                    sourceLabel: 'Workspace',
                    manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
                    baseDir: '/tmp/workspace/skill/create-skill',
                  },
                ],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-agent')).toBeVisible();
      await expect(page.getByTestId('chat-composer-skill')).toHaveText('技能');

      const isSkillAfterAgent = await page.evaluate(() => {
        const agentTrigger = document.querySelector('[data-testid="chat-composer-agent"]');
        const skillTrigger = document.querySelector('[data-testid="chat-composer-skill"]');
        if (!(agentTrigger instanceof HTMLElement) || !(skillTrigger instanceof HTMLElement)) {
          return false;
        }
        return Boolean(agentTrigger.compareDocumentPosition(skillTrigger) & Node.DOCUMENT_POSITION_FOLLOWING);
      });

      expect(isSkillAfterAgent).toBe(true);

      await page.getByTestId('chat-composer-input').fill('Draft a new helper');
      await page.getByTestId('chat-composer-input').evaluate((element) => {
        if (!(element instanceof HTMLTextAreaElement)) return;
        const cursorPosition = 'Draft '.length;
        element.focus();
        element.setSelectionRange(cursorPosition, cursorPosition);
      });
      await page.getByTestId('chat-composer-skill').click();
      await page.getByText('/create-skill', { exact: true }).click();
      await expect(page.getByTestId('chat-composer-input')).toHaveValue('Draft /create-skill  a new helper');
      await expect(page.getByTestId('chat-composer-skill-token')).toHaveText('/create-skill');
    } finally {
      await closeElectronApp(app);
    }
  });
});
