import { pathToFileURL } from 'node:url';
import {
  closeElectronApp,
  expect,
  getRecordedLegacyIpcInvocations,
  getStableWindow,
  installAttachmentHostFixture,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

test('previews replayed Markdown file links through real scoped attachment access', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const fixture = await installAttachmentHostFixture(app, {
      sessions: [{ key: SESSION_KEY, title: 'Markdown files' }],
    });
    const report = await fixture.createOutsideFile('报告 #1.md', '# Financial report\n\nTotal profit: 130.');
    const csv = await fixture.createOutsideFile('summary.csv', 'Month,Revenue,Profit\nJanuary,100,40\n');
    const reportUri = pathToFileURL(report).href;
    const csvUri = pathToFileURL(csv).href;
    await fixture.setSessionReplay(SESSION_KEY, [{
      sessionUpdate: 'user_message', messageId: 'file-user', content: [{ type: 'text', text: 'Create a report' }],
    }, {
      sessionUpdate: 'agent_message', messageId: 'file-reply', content: [{ type: 'text', text: [
        `[report.md](${reportUri}) and [summary.csv](${csvUri})`,
        '', '[Docs](https://example.com)', '[Unsafe](javascript:alert%281%29)',
        '[Remote file](file://remote-host/share/report.md)',
        '', `\`[Example](${reportUri})\``, '', '<script>alert(1)</script>',
      ].join('\n') }],
    }]);
    await fixture.setTranscriptResponses(SESSION_KEY, [[]]);
    const page = await getStableWindow(app);
    await page.reload();
    const message = page.getByTestId('acp-assistant-message');
    const reportLink = message.getByRole('button', { name: 'report.md', exact: true });
    await expect(reportLink).toBeVisible({ timeout: 30_000 });
    await expect(message.getByTestId('acp-markdown-file-link')).toHaveCount(2);
    await expect(message.locator('a, script')).toHaveCount(0);
    await expect(message).toContainText('<script>alert(1)</script>');
    expect((await fixture.getHostInvocations()).filter(call => call.module === 'files'
      && ['resolveAttachment', 'readAttachmentText', 'readAttachmentBinary'].includes(call.action ?? ''))).toEqual([]);

    await reportLink.click();
    const panel = page.getByTestId('artifact-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Financial report' })).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('Total profit: 130.');
    await message.getByRole('button', { name: 'summary.csv', exact: true }).click();
    await expect(panel).toContainText('January', { timeout: 30_000 });
    const calls = await fixture.getHostInvocations();
    for (const uri of [reportUri, csvUri]) {
      expect(calls.some(call => call.module === 'files' && call.action === 'resolveAttachment'
        && (call.payload?.ref as Record<string, unknown> | undefined)?.uri === uri)).toBe(true);
    }
    expect(calls.some(call => call.module === 'files' && call.action === 'readAttachmentText'
      && call.payload?.sessionKey === SESSION_KEY && call.payload?.uri === reportUri)).toBe(true);
    expect(await fixture.getShellInvocations()).toEqual([]);
    expect(await getRecordedLegacyIpcInvocations(app)).toEqual([]);
  } finally {
    await closeElectronApp(app);
  }
});

test('handles streamed links, unavailable files, and directory system open', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const fixture = await installAttachmentHostFixture(app, {
      sessions: [{ key: SESSION_KEY, title: 'Streaming files' }],
    });
    const report = await fixture.createWorkspaceFile('streamed.md', '# Streamed report');
    const directory = await fixture.createWorkspaceDirectory('exports');
    await fixture.setSessionReplay(SESSION_KEY, []);
    await fixture.setTranscriptResponses(SESSION_KEY, [[]]);
    const page = await getStableWindow(app);
    await page.reload();
    await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
    const prefix = '[Streamed report](';
    await fixture.emitAcpSessionUpdates({ sessionKey: SESSION_KEY, updates: [{
      sessionUpdate: 'user_message', messageId: 'stream-user', content: [{ type: 'text', text: 'Show the report' }],
    }, {
      sessionUpdate: 'agent_message_chunk', messageId: 'stream-reply', content: { type: 'text', text: prefix },
    }] });
    await expect(page.getByTestId('acp-assistant-message')).toContainText('Streamed report');
    await expect(page.getByTestId('acp-markdown-file-link')).toHaveCount(0);
    await fixture.emitAcpSessionUpdates({ sessionKey: SESSION_KEY, updates: [{
      sessionUpdate: 'agent_message_chunk', messageId: 'stream-reply', content: { type: 'text', text: [
        `${pathToFileURL(report).href})`,
        `[Missing](${pathToFileURL(report + '.missing').href})`,
        `[Folder](${pathToFileURL(directory).href})`,
      ].join('\n\n') },
    }] });
    const message = page.getByTestId('acp-assistant-message');
    await expect(message.getByTestId('acp-markdown-file-link')).toHaveCount(3);
    await message.getByRole('button', { name: 'Missing', exact: true }).click();
    await expect(page.getByText('Attachment unavailable', { exact: true })).toBeVisible();
    await expect(page.getByTestId('artifact-panel')).toHaveCount(0);
    await message.getByRole('button', { name: 'Folder', exact: true }).click();
    await expect.poll(() => fixture.getShellInvocations()).toEqual([
      expect.objectContaining({ action: 'openPath', payload: { path: directory } }),
    ]);
    await expect(page.getByTestId('artifact-panel')).toHaveCount(0);
    await message.getByRole('button', { name: 'Streamed report', exact: true }).click();
    await expect(page.getByTestId('artifact-panel').getByRole('heading', { name: 'Streamed report' }))
      .toBeVisible({ timeout: 30_000 });
    expect(await getRecordedLegacyIpcInvocations(app)).toEqual([]);
  } finally {
    await closeElectronApp(app);
  }
});
