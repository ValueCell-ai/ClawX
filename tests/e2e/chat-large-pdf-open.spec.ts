import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

// PDFs at or below 50 MB now render inline through pdfjs-dist.  This
// regression test only covers the *fallback* path for pathologically
// large binaries that exceed the inline-preview ceiling.
const BYTES_OVER_INLINE_LIMIT = 51 * 1024 * 1024;

test.describe('ClawX large pdf preview fallback', () => {
  test('asks for confirmation before directly opening a large pdf', async ({ launchElectronApp }) => {
    const openclawDir = join(homedir(), '.openclaw');
    const pdfPath = join(openclawDir, 'e2e-large-preview-report.pdf');
    mkdirSync(openclawDir, { recursive: true });
    writeFileSync(pdfPath, Buffer.alloc(BYTES_OVER_INLINE_LIMIT, '%PDF-1.4\n'));

    const history = [
      {
        role: 'user',
        id: 'user-1',
        content: [{ type: 'text', text: 'Please inspect the attached report.' }],
        timestamp: Date.now(),
      },
      {
        role: 'assistant',
        id: 'assistant-1',
        content: [{ type: 'text', text: 'Here is the generated report.' }],
        _attachedFiles: [
          {
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            fileSize: BYTES_OVER_INLINE_LIMIT,
            preview: null,
            filePath: pdfPath,
            source: 'message-ref',
          },
        ],
        timestamp: Date.now(),
      },
    ];

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
            result: { messages: history },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: { messages: history },
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

      await app.evaluate(
        async ({ app: _app }, filePathArg) => {
          const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
          const state = globalThis as typeof globalThis & {
            __openedPaths?: string[];
            __messageBoxes?: unknown[];
          };
          state.__openedPaths = [];
          state.__messageBoxes = [];

          ipcMain.removeHandler('dialog:message');
          ipcMain.handle('dialog:message', async (_event: unknown, options: unknown) => {
            state.__messageBoxes!.push(options);
            return { response: 1, checkboxChecked: false };
          });

          ipcMain.removeHandler('shell:openPath');
          ipcMain.handle('shell:openPath', async (_event: unknown, targetPath: string) => {
            state.__openedPaths!.push(targetPath);
            return targetPath === filePathArg ? '' : 'unexpected path';
          });
        },
        pdfPath,
      );

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.getByText('report.pdf').first().click();

      const openButton = page.locator('aside').getByRole('button', { name: '直接打开' });
      await expect(openButton).toBeVisible({ timeout: 30_000 });
      await openButton.click();

      const inspect = await app.evaluate(async () => {
        const state = globalThis as typeof globalThis & {
          __openedPaths?: string[];
          __messageBoxes?: unknown[];
        };
        return {
          openedPaths: state.__openedPaths ?? [],
          messageBoxes: state.__messageBoxes ?? [],
        };
      });

      expect(inspect.openedPaths).toContain(pdfPath);
      expect(inspect.messageBoxes).toHaveLength(1);
      expect(JSON.stringify(inspect.messageBoxes[0])).toContain('report.pdf');
    } finally {
      await closeElectronApp(app);
      rmSync(pdfPath, { force: true });
    }
  });
});
