import type { BrowserWindow } from 'electron';
import type { HostApiContract } from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import type { RuntimeManager } from '../runtime/manager';
import type { ProviderConfig } from '../utils/secure-storage';
import { browserOAuthManager, type BrowserOAuthProviderType } from '../utils/browser-oauth';
import { deviceOAuthManager, type OAuthProviderType } from '../utils/device-oauth';
import { removeProviderFromOpenClaw, saveProviderKeyToOpenClaw } from '../utils/openclaw-auth';
import { getProviderConfig } from '../utils/provider-registry';
import { logger } from '../utils/logger';
import { getProviderService } from './providers/provider-service';
import { providerAccountToConfig } from './providers/provider-store';
import {
  getOpenClawProviderKey,
  syncDefaultProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
  syncProviderApiKeyToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from './providers/provider-runtime-sync';
import { validateApiKeyWithProvider } from './providers/provider-validation';
import type { ProviderAccount } from '../shared/providers/types';
import { isRecord } from './payload-utils';
import {
  getCcConnectCodexOAuthStatus,
  importUserCodexOAuthToManagedHome,
  logoutCcConnectCodexOAuth,
} from '../runtime/cc-connect-provider-profile';

type ProvidersApiContext = {
  gatewayManager: GatewayManager;
  runtimeManager?: RuntimeManager;
  mainWindow: BrowserWindow;
};

type ProviderPayload<Action extends keyof HostApiContract['providers']> =
  Parameters<HostApiContract['providers'][Action]>[0];

type ValidationOptions = {
  baseUrl?: string;
  apiProtocol?: string;
};

function hasObjectChanges<T extends Record<string, unknown>>(
  existing: T,
  patch: Partial<T> | undefined,
): boolean {
  if (!patch) return false;
  const keys = Object.keys(patch) as Array<keyof T>;
  if (keys.length === 0) return false;
  return keys.some((key) => JSON.stringify(existing[key]) !== JSON.stringify(patch[key]));
}

function selectReplacementDefaultAccount(
  accounts: ProviderAccount[],
  deletedAccountId: string,
): ProviderAccount | undefined {
  return accounts
    .filter((account) => account.id !== deletedAccountId)
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);
      return updatedAtOrder !== 0 ? updatedAtOrder : left.id.localeCompare(right.id);
    })[0];
}

function payloadString(payload: unknown, key: string): string | undefined {
  if (typeof payload === 'string') return payload;
  if (!isRecord(payload)) return undefined;
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireString(payload: unknown, key: string, action: string): string {
  const value = payloadString(payload, key);
  if (!value) {
    throw new Error(`Invalid providers.${action} payload`);
  }
  return value;
}

function getPayloadRecord(payload: unknown, action: string): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new Error(`Invalid providers.${action} payload`);
  }
  return payload;
}

function getProviderId(payload: unknown, action: string): string {
  if (Array.isArray(payload)) {
    const [providerId] = payload;
    if (typeof providerId === 'string' && providerId.trim()) return providerId.trim();
  }
  return requireString(payload, 'providerId', action);
}

function getAccountId(payload: unknown, action: string): string {
  return requireString(payload, 'accountId', action);
}

function getApiKeyPayload(payload: unknown, action: string): { providerId: string; apiKey: string } {
  if (Array.isArray(payload)) {
    const [providerId, apiKey] = payload;
    if (typeof providerId === 'string' && providerId.trim() && typeof apiKey === 'string') {
      return { providerId: providerId.trim(), apiKey };
    }
  }
  const record = getPayloadRecord(payload, action);
  const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : '';
  if (!providerId || typeof record.apiKey !== 'string') {
    throw new Error(`Invalid providers.${action} payload`);
  }
  return { providerId, apiKey: record.apiKey };
}

function getProviderUpdatePayload(payload: unknown): {
  providerId: string;
  updates: Partial<ProviderConfig>;
  apiKey?: string;
} {
  if (Array.isArray(payload)) {
    const [providerId, updates, apiKey] = payload;
    if (typeof providerId === 'string' && providerId.trim() && isRecord(updates)) {
      return { providerId: providerId.trim(), updates: updates as Partial<ProviderConfig>, apiKey: typeof apiKey === 'string' ? apiKey : undefined };
    }
  }
  const record = getPayloadRecord(payload, 'updateWithKey');
  const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : '';
  if (!providerId || !isRecord(record.updates)) {
    throw new Error('Invalid providers.updateWithKey payload');
  }
  return {
    providerId,
    updates: record.updates as Partial<ProviderConfig>,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : undefined,
  };
}

function getSavePayload(payload: unknown): { config: ProviderConfig; apiKey?: string } {
  if (Array.isArray(payload)) {
    const [config, apiKey] = payload;
    if (isRecord(config)) {
      return { config: config as unknown as ProviderConfig, apiKey: typeof apiKey === 'string' ? apiKey : undefined };
    }
  }
  const record = getPayloadRecord(payload, 'save');
  if (!isRecord(record.config)) {
    throw new Error('Invalid providers.save payload');
  }
  return {
    config: record.config as unknown as ProviderConfig,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : undefined,
  };
}

async function syncActiveRuntimeProviderProfile(
  ctx: Pick<ProvidersApiContext, 'runtimeManager'>,
  payload: { providerId?: string; reason: string },
): Promise<boolean> {
  const provider = ctx.runtimeManager?.getActiveProvider();
  if (!provider?.syncProviderProfile) return false;
  await provider.syncProviderProfile(payload);
  return true;
}

async function syncProviderApiKeyToActiveRuntime(
  providerType: string,
  providerId: string,
  apiKey: string,
  ctx: Pick<ProvidersApiContext, 'runtimeManager'>,
): Promise<void> {
  if (await syncActiveRuntimeProviderProfile(ctx, { providerId, reason: 'api-key' })) {
    return;
  }
  await syncProviderApiKeyToRuntime(providerType, providerId, apiKey);
}

async function syncSavedProviderToActiveRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  ctx: Pick<ProvidersApiContext, 'gatewayManager' | 'runtimeManager'>,
): Promise<void> {
  if (await syncActiveRuntimeProviderProfile(ctx, { providerId: config.id, reason: 'save' })) {
    return;
  }
  await syncSavedProviderToRuntime(config, apiKey, ctx.gatewayManager);
}

async function syncUpdatedProviderToActiveRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  ctx: Pick<ProvidersApiContext, 'gatewayManager' | 'runtimeManager'>,
  reason = 'update',
): Promise<void> {
  if (await syncActiveRuntimeProviderProfile(ctx, { providerId: config.id, reason })) {
    return;
  }
  await syncUpdatedProviderToRuntime(config, apiKey, ctx.gatewayManager);
}

async function syncDeletedProviderToActiveRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  ctx: Pick<ProvidersApiContext, 'gatewayManager' | 'runtimeManager'>,
  runtimeProviderKey?: string,
): Promise<void> {
  if (await syncActiveRuntimeProviderProfile(ctx, { providerId, reason: 'delete' })) {
    return;
  }
  await syncDeletedProviderToRuntime(provider, providerId, ctx.gatewayManager, runtimeProviderKey);
}

async function syncDeletedProviderApiKeyToActiveRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  ctx: Pick<ProvidersApiContext, 'runtimeManager'>,
  runtimeProviderKey?: string,
): Promise<void> {
  if (await syncActiveRuntimeProviderProfile(ctx, { providerId, reason: 'delete-api-key' })) {
    return;
  }
  await syncDeletedProviderApiKeyToRuntime(provider, providerId, runtimeProviderKey);
}

async function syncDefaultProviderToActiveRuntime(
  providerId: string,
  ctx: Pick<ProvidersApiContext, 'gatewayManager' | 'runtimeManager'>,
): Promise<void> {
  if (await syncActiveRuntimeProviderProfile(ctx, { providerId, reason: 'set-default' })) {
    return;
  }
  await syncDefaultProviderToRuntime(providerId, ctx.gatewayManager);
}

async function removeProviderFromActiveRuntime(
  providerKey: string,
  ctx: Pick<ProvidersApiContext, 'runtimeManager'>,
  providerId: string,
): Promise<void> {
  if (await syncActiveRuntimeProviderProfile(ctx, { providerId, reason: 'remove-provider' })) {
    return;
  }
  await removeProviderFromOpenClaw(providerKey);
}

async function validateKey(payload: ProviderPayload<'validateKey'>): Promise<{ valid: boolean; error?: string }> {
  try {
    const body = getPayloadRecord(payload, 'validateKey');
    const accountId = typeof body.accountId === 'string' && body.accountId.trim()
      ? body.accountId.trim()
      : undefined;
    const vendorId = typeof body.vendorId === 'string' && body.vendorId.trim()
      ? body.vendorId.trim()
      : undefined;
    const providerId = typeof body.providerId === 'string' && body.providerId.trim()
      ? body.providerId.trim()
      : undefined;
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined;
    if (!apiKey) {
      return { valid: false, error: 'Invalid providers.validateKey payload' };
    }

    const providerService = getProviderService();
    const lookupId = accountId || vendorId || providerId || '';
    const account = lookupId ? await providerService.getAccount(lookupId) : null;
    const legacyProvider = !account && providerId ? await providerService._getProviderInternal(providerId) : null;
    const providerType = account?.vendorId || legacyProvider?.type || vendorId || providerId || lookupId;
    if (!providerType) {
      return { valid: false, error: 'Invalid providers.validateKey payload' };
    }

    const options = isRecord(body.options) ? body.options as ValidationOptions : undefined;
    const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
    const resolvedBaseUrl = options?.baseUrl || account?.baseUrl || legacyProvider?.baseUrl || registryBaseUrl;
    const resolvedProtocol = options?.apiProtocol || account?.apiProtocol || legacyProvider?.apiProtocol;
    return await validateApiKeyWithProvider(providerType, apiKey, {
      baseUrl: resolvedBaseUrl,
      apiProtocol: resolvedProtocol,
    });
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

async function saveProvider(payload: ProviderPayload<'save'>, ctx: ProvidersApiContext) {
  const providerService = getProviderService();
  const { config, apiKey } = getSavePayload(payload);
  try {
    await providerService._saveProviderInternal(config);
    if (apiKey !== undefined) {
      const trimmedKey = apiKey.trim();
      if (trimmedKey) {
        await providerService._setProviderApiKeyInternal(config.id, trimmedKey);
        await syncProviderApiKeyToActiveRuntime(config.type, config.id, trimmedKey, ctx);
      }
    }
    await syncSavedProviderToActiveRuntime(config, apiKey, ctx);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function deleteProvider(payload: ProviderPayload<'delete'>, ctx: ProvidersApiContext) {
  const providerService = getProviderService();
  const providerId = getProviderId(payload, 'delete');
  try {
    const existing = await providerService._getProviderInternal(providerId);
    await providerService._deleteProviderInternal(providerId);
    await syncDeletedProviderToActiveRuntime(existing, providerId, ctx);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function setProviderApiKey(payload: ProviderPayload<'setApiKey'>, ctx: ProvidersApiContext) {
  const providerService = getProviderService();
  const { providerId, apiKey } = getApiKeyPayload(payload, 'setApiKey');
  try {
    await providerService._setProviderApiKeyInternal(providerId, apiKey);
    const provider = await providerService._getProviderInternal(providerId);
    const providerType = provider?.type || providerId;
    await syncProviderApiKeyToActiveRuntime(providerType, providerId, apiKey, ctx);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function updateProviderWithKey(payload: ProviderPayload<'updateWithKey'>, ctx: ProvidersApiContext) {
  const providerService = getProviderService();
  const { providerId, updates, apiKey } = getProviderUpdatePayload(payload);
  const existing = await providerService._getProviderInternal(providerId);
  if (!existing) {
    return { success: false, error: 'Provider not found' };
  }

  const previousKey = await providerService._getProviderApiKeyInternal(providerId);
  const previousOck = getOpenClawProviderKey(existing.type, providerId);

  try {
    const nextConfig: ProviderConfig = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    const ock = getOpenClawProviderKey(nextConfig.type, providerId);
    await providerService._saveProviderInternal(nextConfig);

    if (apiKey !== undefined) {
      const trimmedKey = apiKey.trim();
      if (trimmedKey) {
        await providerService._setProviderApiKeyInternal(providerId, trimmedKey);
        await syncProviderApiKeyToActiveRuntime(nextConfig.type, providerId, trimmedKey, ctx);
      } else {
        await providerService._deleteProviderApiKeyInternal(providerId);
        await removeProviderFromActiveRuntime(ock, ctx, providerId);
      }
    }

    await syncUpdatedProviderToActiveRuntime(nextConfig, apiKey, ctx);
    return { success: true };
  } catch (error) {
    try {
      await providerService._saveProviderInternal(existing);
      if (previousKey) {
        await providerService._setProviderApiKeyInternal(providerId, previousKey);
        if (!await syncActiveRuntimeProviderProfile(ctx, { providerId, reason: 'rollback' })) {
          await saveProviderKeyToOpenClaw(previousOck, previousKey);
        }
      } else {
        await providerService._deleteProviderApiKeyInternal(providerId);
        await removeProviderFromActiveRuntime(previousOck, ctx, providerId);
      }
    } catch (rollbackError) {
      logger.warn('Failed to rollback provider updateWithKey:', rollbackError);
    }
    return { success: false, error: String(error) };
  }
}

async function deleteProviderApiKey(payload: ProviderPayload<'deleteApiKey'>, ctx: ProvidersApiContext) {
  const providerService = getProviderService();
  const providerId = getProviderId(payload, 'deleteApiKey');
  try {
    await providerService._deleteProviderApiKeyInternal(providerId);
    const provider = await providerService._getProviderInternal(providerId);
    await syncDeletedProviderApiKeyToActiveRuntime(provider, providerId, ctx);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function setDefaultProvider(payload: ProviderPayload<'setDefault'>, ctx: ProvidersApiContext) {
  const providerService = getProviderService();
  const providerId = getProviderId(payload, 'setDefault');
  try {
    await providerService._setDefaultProviderInternal(providerId);
    await syncDefaultProviderToActiveRuntime(providerId, ctx);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function createAccount(payload: ProviderPayload<'createAccount'>, ctx: ProvidersApiContext) {
  const providerService = getProviderService();
  const body = getPayloadRecord(payload, 'createAccount');
  if (!isRecord(body.account)) {
    throw new Error('Invalid providers.createAccount payload');
  }
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined;
  try {
    const account = await providerService.createAccount(body.account as unknown as ProviderAccount, apiKey);
    await syncSavedProviderToActiveRuntime(providerAccountToConfig(account), apiKey, ctx);
    return { success: true, account };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function updateAccount(payload: ProviderPayload<'updateAccount'>, ctx: ProvidersApiContext) {
  const providerService = getProviderService();
  const body = getPayloadRecord(payload, 'updateAccount');
  const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
  const updates = isRecord(body.updates) ? body.updates as Partial<ProviderAccount> : undefined;
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined;
  if (!accountId || !updates) {
    throw new Error('Invalid providers.updateAccount payload');
  }
  try {
    const existing = await providerService.getAccount(accountId);
    if (!existing) {
      return { success: false, error: 'Provider account not found' };
    }
    const hasPatchChanges = hasObjectChanges(existing as unknown as Record<string, unknown>, updates as Record<string, unknown>);
    if (!hasPatchChanges && apiKey === undefined) {
      return { success: true, noChange: true, account: existing };
    }
    const account = await providerService.updateAccount(accountId, updates, apiKey);
    await syncUpdatedProviderToActiveRuntime(providerAccountToConfig(account), apiKey, ctx);
    return { success: true, account };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function deleteAccount(
  payload: ProviderPayload<'deleteAccount'> & { apiKeyOnly?: boolean },
  ctx: ProvidersApiContext,
) {
  const providerService = getProviderService();
  const body = getPayloadRecord(payload, 'deleteAccount');
  const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
  const apiKeyOnly = body.apiKeyOnly === true;
  if (!accountId) {
    throw new Error('Invalid providers.deleteAccount payload');
  }
  try {
    const existing = await providerService.getAccount(accountId);
    const runtimeProviderKey = existing?.authMode === 'oauth_browser' && existing.vendorId === 'openai'
      ? 'openai'
      : undefined;
    if (apiKeyOnly) {
      await providerService._deleteProviderApiKeyInternal(accountId);
      await syncDeletedProviderApiKeyToActiveRuntime(
        existing ? providerAccountToConfig(existing) : null,
        accountId,
        ctx,
        runtimeProviderKey,
      );
      return { success: true };
    }
    const currentDefaultAccountId = await providerService.getDefaultAccountId();
    const replacementDefault = currentDefaultAccountId === accountId
      ? selectReplacementDefaultAccount(await providerService.listAccounts(), accountId)
      : undefined;

    await providerService.deleteAccount(accountId);
    if (replacementDefault) {
      await providerService.setDefaultAccount(replacementDefault.id);
      await syncDefaultProviderToActiveRuntime(replacementDefault.id, ctx);
    }
    await syncDeletedProviderToActiveRuntime(
      existing ? providerAccountToConfig(existing) : null,
      accountId,
      ctx,
      runtimeProviderKey,
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function setDefaultAccount(payload: ProviderPayload<'setDefaultAccount'>, ctx: ProvidersApiContext) {
  const providerService = getProviderService();
  const accountId = getAccountId(payload, 'setDefaultAccount');
  try {
    const currentDefault = await providerService.getDefaultAccountId();
    if (currentDefault === accountId) {
      return { success: true, noChange: true };
    }
    await providerService.setDefaultAccount(accountId);
    await syncDefaultProviderToActiveRuntime(accountId, ctx);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function requestOAuth(payload: ProviderPayload<'requestOAuth'>) {
  const body = getPayloadRecord(payload, 'requestOAuth');
  const provider = typeof body.provider === 'string' ? body.provider : undefined;
  if (!provider) {
    return { success: false, error: 'Invalid providers.requestOAuth payload' };
  }
  const region = body.region === 'global' || body.region === 'cn' ? body.region : undefined;
  const options = {
    accountId: typeof body.accountId === 'string' ? body.accountId : undefined,
    label: typeof body.label === 'string' ? body.label : undefined,
  };
  try {
    if (provider === 'openai') {
      await browserOAuthManager.startFlow(provider as BrowserOAuthProviderType, options);
    } else {
      await deviceOAuthManager.startFlow(provider as OAuthProviderType, region, options);
    }
    return { success: true };
  } catch (error) {
    logger.error('providers.requestOAuth failed', error);
    return { success: false, error: String(error) };
  }
}

async function cancelOAuth() {
  try {
    await deviceOAuthManager.stopFlow();
    await browserOAuthManager.stopFlow();
    return { success: true };
  } catch (error) {
    logger.error('providers.cancelOAuth failed', error);
    return { success: false, error: String(error) };
  }
}

async function submitOAuth(payload: ProviderPayload<'submitOAuth'>) {
  const body = getPayloadRecord(payload, 'submitOAuth');
  const code = typeof body.code === 'string' ? body.code : '';
  try {
    const accepted = browserOAuthManager.submitManualCode(code);
    if (!accepted) {
      return { success: false, error: 'No active manual OAuth input pending' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function codexOAuthStatus(payload?: ProviderPayload<'codexOAuthStatus'>) {
  try {
    const accountId = payloadString(payload, 'accountId');
    return await getCcConnectCodexOAuthStatus({ accountId });
  } catch (error) {
    logger.error('providers.codexOAuthStatus failed', error);
    return { success: false, error: String(error) };
  }
}

async function importCodexOAuth(
  payload: ProviderPayload<'importCodexOAuth'> | undefined,
  ctx: Pick<ProvidersApiContext, 'runtimeManager'>,
) {
  try {
    const accountId = payloadString(payload, 'accountId');
    const result = await importUserCodexOAuthToManagedHome({ accountId });
    await syncActiveRuntimeProviderProfile(ctx, {
      providerId: result.provider?.accountId ?? accountId,
      reason: 'codex-oauth-import',
    });
    return result;
  } catch (error) {
    logger.error('providers.importCodexOAuth failed', error);
    return { success: false, error: String(error) };
  }
}

async function logoutCodexOAuth(
  payload: ProviderPayload<'logoutCodexOAuth'> | undefined,
  ctx: Pick<ProvidersApiContext, 'runtimeManager'>,
) {
  try {
    const accountId = payloadString(payload, 'accountId');
    const managedOnly = isRecord(payload) && payload.managedOnly === true;
    const result = await logoutCcConnectCodexOAuth({ accountId, managedOnly });
    await syncActiveRuntimeProviderProfile(ctx, {
      providerId: result.provider?.accountId ?? accountId,
      reason: 'codex-oauth-logout',
    });
    return result;
  } catch (error) {
    logger.error('providers.logoutCodexOAuth failed', error);
    return { success: false, error: String(error) };
  }
}

export function createProvidersApi(ctx: ProvidersApiContext): CompleteHostServiceRegistry['providers'] {
  const providerService = getProviderService();
  deviceOAuthManager.setWindow(ctx.mainWindow);
  browserOAuthManager.setWindow(ctx.mainWindow);
  browserOAuthManager.setSuccessHandler(async ({ accountId }) => {
    const account = await providerService.getAccount(accountId);
    if (!account) {
      throw new Error(`Provider account not found after OAuth success: ${accountId}`);
    }
    await syncUpdatedProviderToActiveRuntime(
      providerAccountToConfig(account),
      undefined,
      ctx,
      'oauth',
    );
  });

  return {
    list: async () => providerService._listProvidersWithKeyInfoInternal(),
    get: async (payload) => providerService._getProviderInternal(getProviderId(payload, 'get')),
    getDefault: async () => providerService._getDefaultProviderInternal(),
    hasApiKey: async (payload) => providerService._hasProviderApiKeyInternal(getProviderId(payload, 'hasApiKey')),
    getApiKey: async (payload) => providerService._getProviderApiKeyInternal(getProviderId(payload, 'getApiKey')),
    validateKey,
    save: async (payload) => saveProvider(payload, ctx),
    delete: async (payload) => deleteProvider(payload, ctx),
    setApiKey: async (payload) => setProviderApiKey(payload, ctx),
    updateWithKey: async (payload) => updateProviderWithKey(payload, ctx),
    deleteApiKey: async (payload) => deleteProviderApiKey(payload, ctx),
    setDefault: async (payload) => setDefaultProvider(payload, ctx),
    accounts: async () => providerService.listAccounts(),
    vendors: async () => providerService.listVendors(),
    accountKeyInfo: async () => providerService.listAccountsKeyInfo(),
    getDefaultAccount: async () => ({ accountId: await providerService.getDefaultAccountId() ?? null }),
    getAccount: async (payload) => providerService.getAccount(getAccountId(payload, 'getAccount')),
    getAccountApiKey: async (payload) => providerService.getAccountApiKey(getAccountId(payload, 'getAccountApiKey')),
    hasAccountApiKey: async (payload) => providerService.hasAccountApiKey(getAccountId(payload, 'hasAccountApiKey')),
    createAccount: async (payload) => createAccount(payload, ctx),
    updateAccount: async (payload) => updateAccount(payload, ctx),
    deleteAccount: async (payload) => deleteAccount(payload, ctx),
    deleteAccountApiKey: async (payload) => deleteAccount({ accountId: getAccountId(payload, 'deleteAccountApiKey'), apiKeyOnly: true }, ctx),
    setDefaultAccount: async (payload) => setDefaultAccount(payload, ctx),
    requestOAuth,
    cancelOAuth,
    submitOAuth,
    codexOAuthStatus,
    importCodexOAuth: async (payload) => importCodexOAuth(payload, ctx),
    logoutCodexOAuth: async (payload) => logoutCodexOAuth(payload, ctx),
  };
}
