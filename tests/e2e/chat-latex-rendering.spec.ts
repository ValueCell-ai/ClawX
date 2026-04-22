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

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Show me Einstein\'s mass-energy equivalence and a definite integral.' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        'Sure! Einstein famously wrote $E=mc^2$, and the quadratic formula is \\(x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\\).',
        '',
        'A definite integral:',
        '',
        '$$',
        '\\int_0^1 x\\,dx = \\frac{1}{2}',
        '$$',
        '',
        'And a sum with bracket-style block math:',
        '',
        '\\[\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\\]',
      ].join('\n'),
    }],
    timestamp: Date.now(),
  },
];

test.describe('ClawX chat LaTeX rendering', () => {
  test('renders KaTeX markup for $...$, $$...$$, \\(...\\) and \\[...\\] delimiters', async ({ launchElectronApp }) => {
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
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: { messages: seededHistory },
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
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();

      // Wait for a KaTeX inline rendering to appear.
      await expect(page.locator('.katex').first()).toBeVisible({ timeout: 30_000 });
      // Inline math: $E=mc^2$
      await expect(page.locator('.katex').filter({ hasText: /E\s*=\s*mc/ }).first()).toBeVisible();
      // Display math: both $$...$$ and \[...\] forms produce .katex-display blocks.
      await expect(page.locator('.katex-display')).toHaveCount(2);
    } finally {
      await closeElectronApp(app);
    }
  });
});
