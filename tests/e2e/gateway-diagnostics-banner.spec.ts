import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

// Matches issue #884: the embedded acpx plugin probe crashes with exit
// code 3221225781 (STATUS_DLL_NOT_FOUND) because the Visual C++
// Redistributable is missing.  The main process classifies the stderr
// line and exposes the diagnostic via status.activeDiagnostics + the
// gateway:diagnostic IPC event.
test.describe('Gateway startup diagnostics banner', () => {
  test('renders the ACPX VC++ Redistributable banner when the diagnostic is active', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const now = Date.now();
      const diagnosticStatus = {
        state: 'running',
        port: 18789,
        pid: 12345,
        connectedAt: now,
        activeDiagnostics: [
          {
            code: 'ACPX_VC_REDIST_MISSING',
            rawLine:
              '[plugins] embedded acpx runtime backend probe failed: '
              + 'embedded ACP runtime probe failed '
              + '(agent=codex; command=npx @zed-industries/codex-acp@^0.11.1; '
              + 'ACP agent exited before initialize completed (exit=3221225781, signal=null))',
            detail:
              'Embedded acpx ACP probe crashed with Windows STATUS_DLL_NOT_FOUND.',
            firstSeenAt: now,
            lastSeenAt: now,
            occurrences: 1,
          },
        ],
      };

      await installIpcMocks(app, {
        gatewayStatus: diagnosticStatus,
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: 'agent:main:main', displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: diagnosticStatus },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'main' }] },
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
      // Banner appears once the gateway store ingests the status.
      const banner = page.getByTestId('gateway-diagnostic-ACPX_VC_REDIST_MISSING');
      await expect(banner).toBeVisible({ timeout: 15_000 });
      // And it offers a Download button that links to the MS aka.ms URL;
      // we assert the button is present and clickable (we don't click
      // because clicking opens an external browser).
      await expect(
        banner.getByRole('button', { name: /download/i }),
      ).toBeVisible();

      // Take a screenshot for PR documentation when an output path is set.
      // Run with CLAWX_BANNER_SCREENSHOT=<path> to capture.
      const screenshotPath = process.env.CLAWX_BANNER_SCREENSHOT;
      if (screenshotPath) {
        await page.screenshot({ path: screenshotPath, fullPage: false });
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});
