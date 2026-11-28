import { closeElectronApp, expect, getRecordedHostInvocations, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { navigateToSection } from './fixtures/navigation';

function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stableKey(item)}`).join(',')}}`;
}

test('edits ordered global and assistant fallback chains in their own scope', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  const modelA = 'custom-12345678/model-alpha';
  const modelB = 'custom-12345678/model-beta';
  const agent = { id: 'main', name: 'Main', isDefault: true, workspace: '/tmp', agentDir: '/tmp', mainSessionKey: 'agent:main:main', modelDisplay: 'model-alpha', modelRef: modelA, overrideModelRef: null, inheritedModel: true, modelFallbacks: null, channelTypes: [] };
  const snapshot = { success: true, agents: [agent], defaultAgentId: 'main', defaultModelRef: modelA, defaultModelFallbacks: [modelA], configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {} };
  const globalSnapshot = { ...snapshot, defaultModelFallbacks: [modelB, modelA] };
  const agentSnapshot = { ...globalSnapshot, agents: [{ ...agent, modelFallbacks: [modelA] }] };
  const key = (module: string, action: string, payload: unknown = null) => stableKey([module, action, payload]);
  try {
    await installIpcMocks(app, { gatewayStatus: { state: 'stopped', port: 18789 }, recordHostInvocations: true, hostApi: {
      [key('settings', 'getAll')]: { language: 'en', theme: 'light', setupComplete: true },
      [key('agents', 'list')]: snapshot,
      [key('agents', 'updateFallbacks', { id: null, fallbacks: [modelB, modelA] })]: globalSnapshot,
      [key('agents', 'updateFallbacks', { id: 'main', fallbacks: [modelA] })]: agentSnapshot,
      [key('channels', 'accounts')]: { success: true, channels: [] },
      [key('providers', 'accounts')]: [{ id: 'custom-12345678', vendorId: 'custom', label: 'Research Lab', authMode: 'local', enabled: true, model: 'model-alpha', metadata: { customModels: ['model-alpha', 'model-beta'] }, updatedAt: '2026-10-31' }],
      [key('providers', 'vendors')]: [{ id: 'custom', name: 'Custom' }],
      [key('providers', 'accountKeyInfo')]: [],
      [key('providers', 'getDefaultAccount')]: { accountId: 'custom-12345678' },
      [key('providers', 'list')]: [],
    } });
    const page = await getStableWindow(app);
    await page.reload();
    await navigateToSection(page, 'agents');
    await page.getByTestId('global-fallback-open').click();
    const globalDialog = page.getByTestId('global-fallback-dialog');
    await expect(globalDialog).toContainText('Research Lab / model-alpha');
    await globalDialog.getByTestId('global-fallback-picker-button').click();
    await page.getByTestId('global-fallback-picker-menu').getByRole('menuitemradio', { name: 'model-beta', exact: true }).click();
    await globalDialog.getByRole('button', { name: 'Move Research Lab / model-beta up' }).click();
    await globalDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(globalDialog).toHaveCount(0);
    await expect(page.getByTestId('global-fallback-open')).toBeFocused();
    await page.getByTestId('agent-manage-main').click();
    const detail = page.getByTestId('agent-detail-dialog');
    await expect(detail.getByTestId('agent-fallbacks')).toContainText('model-beta');
    await detail.getByRole('button', { name: 'Remove Research Lab / model-beta' }).click();
    await detail.getByTestId('agent-overview-save').click();
    await expect(detail).toHaveCount(0);
    const calls = await getRecordedHostInvocations(app);
    expect(calls.filter(call => call.module === 'agents' && call.action === 'updateFallbacks').map(call => call.payload)).toEqual([
      { id: null, fallbacks: [modelB, modelA] }, { id: 'main', fallbacks: [modelA] },
    ]);
  } finally {
    await closeElectronApp(app);
  }
});
