import type { BrowserWindow } from 'electron';
import type { HostApiContract } from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
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

type ProvidersApiContext = {
  gatewayManager: GatewayManager;
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

async function saveProvider(payload: ProviderPayload<'save'>, gatewayManager?: GatewayManager) {
  const providerService = getProviderService();
  const { config, apiKey } = getSavePayload(payload);
  try {
    await providerService._saveProviderInternal(config);
    if (apiKey !== undefined) {
      const trimmedKey = apiKey.trim();
      if (trimmedKey) {
        await providerService._setProviderApiKeyInternal(config.id, trimmedKey);
        await syncProviderApiKeyToRuntime(config.type, config.id, trimmedKey);
      }
    }
    await syncSavedProviderToRuntime(config, apiKey, gatewayManager);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function deleteProvider(payload: ProviderPayload<'delete'>, gatewayManager?: GatewayManager) {
  const providerService = getProviderService();
  const providerId = getProviderId(payload, 'delete');
  try {
    const existing = await providerService._getProviderInternal(providerId);
    await providerService._deleteProviderInternal(providerId);
    await syncDeletedProviderToRuntime(existing, providerId, gatewayManager);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function setProviderApiKey(payload: ProviderPayload<'setApiKey'>) {
  const providerService = getProviderService();
  const { providerId, apiKey } = getApiKeyPayload(payload, 'setApiKey');
  try {
    await providerService._setProviderApiKeyInternal(providerId, apiKey);
    const provider = await providerService._getProviderInternal(providerId);
    const providerType = provider?.type || providerId;
    await syncProviderApiKeyToRuntime(providerType, providerId, apiKey);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function updateProviderWithKey(payload: ProviderPayload<'updateWithKey'>, gatewayManager?: GatewayManager) {
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
        await syncProviderApiKeyToRuntime(nextConfig.type, providerId, trimmedKey);
      } else {
        await providerService._deleteProviderApiKeyInternal(providerId);
        await removeProviderFromOpenClaw(ock);
      }
    }

    await syncUpdatedProviderToRuntime(nextConfig, apiKey, gatewayManager);
    return { success: true };
  } catch (error) {
    try {
      await providerService._saveProviderInternal(existing);
      if (previousKey) {
        await providerService._setProviderApiKeyInternal(providerId, previousKey);
        await saveProviderKeyToOpenClaw(previousOck, previousKey);
      } else {
        await providerService._deleteProviderApiKeyInternal(providerId);
        await removeProviderFromOpenClaw(previousOck);
      }
    } catch (rollbackError) {
      logger.warn('Failed to rollback provider updateWithKey:', rollbackError);
    }
    return { success: false, error: String(error) };
  }
}

async function deleteProviderApiKey(payload: ProviderPayload<'deleteApiKey'>) {
  const providerService = getProviderService();
  const providerId = getProviderId(payload, 'deleteApiKey');
  try {
    await providerService._deleteProviderApiKeyInternal(providerId);
    const provider = await providerService._getProviderInternal(providerId);
    await syncDeletedProviderApiKeyToRuntime(provider, providerId);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function setDefaultProvider(payload: ProviderPayload<'setDefault'>, gatewayManager?: GatewayManager) {
  const providerService = getProviderService();
  const providerId = getProviderId(payload, 'setDefault');
  try {
    await providerService._setDefaultProviderInternal(providerId);
    await syncDefaultProviderToRuntime(providerId, gatewayManager);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function createAccount(payload: ProviderPayload<'createAccount'>, gatewayManager?: GatewayManager) {
  const providerService = getProviderService();
  const body = getPayloadRecord(payload, 'createAccount');
  if (!isRecord(body.account)) {
    throw new Error('Invalid providers.createAccount payload');
  }
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined;
  try {
    const account = await providerService.createAccount(body.account as unknown as ProviderAccount, apiKey);
    await syncSavedProviderToRuntime(providerAccountToConfig(account), apiKey, gatewayManager);
    return { success: true, account };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function updateAccount(payload: ProviderPayload<'updateAccount'>, gatewayManager?: GatewayManager) {
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
    await syncUpdatedProviderToRuntime(providerAccountToConfig(account), apiKey, gatewayManager);
    return { success: true, account };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function deleteAccount(
  payload: ProviderPayload<'deleteAccount'> & { apiKeyOnly?: boolean },
  gatewayManager?: GatewayManager,
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
      await syncDeletedProviderApiKeyToRuntime(
        existing ? providerAccountToConfig(existing) : null,
        accountId,
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
      await syncDefaultProviderToRuntime(replacementDefault.id);
    }
    await syncDeletedProviderToRuntime(
      existing ? providerAccountToConfig(existing) : null,
      accountId,
      gatewayManager,
      runtimeProviderKey,
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function setDefaultAccount(payload: ProviderPayload<'setDefaultAccount'>, gatewayManager?: GatewayManager) {
  const providerService = getProviderService();
  const accountId = getAccountId(payload, 'setDefaultAccount');
  try {
    const currentDefault = await providerService.getDefaultAccountId();
    if (currentDefault === accountId) {
      return { success: true, noChange: true };
    }
    await providerService.setDefaultAccount(accountId);
    await syncDefaultProviderToRuntime(accountId, gatewayManager);
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

export function createProvidersApi(ctx: ProvidersApiContext): CompleteHostServiceRegistry['providers'] {
  const providerService = getProviderService();
  deviceOAuthManager.setWindow(ctx.mainWindow);
  browserOAuthManager.setWindow(ctx.mainWindow);

  return {
    list: async () => providerService._listProvidersWithKeyInfoInternal(),
    get: async (payload) => providerService._getProviderInternal(getProviderId(payload, 'get')),
    getDefault: async () => providerService._getDefaultProviderInternal(),
    hasApiKey: async (payload) => providerService._hasProviderApiKeyInternal(getProviderId(payload, 'hasApiKey')),
    getApiKey: async (payload) => providerService._getProviderApiKeyInternal(getProviderId(payload, 'getApiKey')),
    validateKey,
    save: async (payload) => saveProvider(payload, ctx.gatewayManager),
    delete: async (payload) => deleteProvider(payload, ctx.gatewayManager),
    setApiKey: setProviderApiKey,
    updateWithKey: async (payload) => updateProviderWithKey(payload, ctx.gatewayManager),
    deleteApiKey: deleteProviderApiKey,
    setDefault: async (payload) => setDefaultProvider(payload, ctx.gatewayManager),
    accounts: async () => providerService.listAccounts(),
    vendors: async () => providerService.listVendors(),
    accountKeyInfo: async () => providerService.listAccountsKeyInfo(),
    getDefaultAccount: async () => ({ accountId: await providerService.getDefaultAccountId() ?? null }),
    getAccount: async (payload) => providerService.getAccount(getAccountId(payload, 'getAccount')),
    getAccountApiKey: async (payload) => providerService.getAccountApiKey(getAccountId(payload, 'getAccountApiKey')),
    hasAccountApiKey: async (payload) => providerService.hasAccountApiKey(getAccountId(payload, 'hasAccountApiKey')),
    createAccount: async (payload) => createAccount(payload, ctx.gatewayManager),
    updateAccount: async (payload) => updateAccount(payload, ctx.gatewayManager),
    deleteAccount: async (payload) => deleteAccount(payload, ctx.gatewayManager),
    deleteAccountApiKey: async (payload) => deleteAccount({ accountId: getAccountId(payload, 'deleteAccountApiKey'), apiKeyOnly: true }, ctx.gatewayManager),
    setDefaultAccount: async (payload) => setDefaultAccount(payload, ctx.gatewayManager),
    requestOAuth,
    cancelOAuth,
    submitOAuth,
  };
}
