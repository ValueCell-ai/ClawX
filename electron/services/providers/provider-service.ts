import {
  PROVIDER_DEFINITIONS,
  getProviderDefinition,
} from '../../shared/providers/registry';
import type {
  ProviderAccount,
  ProviderConfig,
  ProviderDefinition,
} from '../../shared/providers/types';
import { BUILTIN_PROVIDER_TYPES } from '../../shared/providers/types';
import { ensureProviderStoreMigrated } from './provider-migration';
import {
  deleteProviderAccount,
  getDefaultProviderAccountId,
  getProviderAccount,
  listProviderAccounts,
  providerAccountToConfig,
  providerConfigToAccount,
  saveProviderAccount,
  setDefaultProviderAccount,
} from './provider-store';
import {
  deleteApiKey,
  deleteProvider,
  getApiKey,
  hasApiKey,
  saveProvider,
  setDefaultProvider,
  storeApiKey,
} from '../../utils/secure-storage';
import { getActiveOpenClawProviders, getOpenClawProvidersConfig } from '../../utils/openclaw-auth';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';
import type { ProviderWithKeyInfo } from '../../shared/providers/types';
import { logger } from '../../utils/logger';

function maskApiKey(apiKey: string | null): string | null {
  if (!apiKey) return null;
  if (apiKey.length > 12) {
    return `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
  }
  return '*'.repeat(apiKey.length);
}

const legacyProviderApiWarned = new Set<string>();

function logLegacyProviderApiUsage(method: string, replacement: string): void {
  if (legacyProviderApiWarned.has(method)) {
    return;
  }
  legacyProviderApiWarned.add(method);
  logger.warn(
    `[provider-migration] Legacy provider API "${method}" is deprecated. Migrate to "${replacement}".`,
  );
}

export class ProviderService {
  async listVendors(): Promise<ProviderDefinition[]> {
    return PROVIDER_DEFINITIONS;
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    await ensureProviderStoreMigrated();
    let accounts = await listProviderAccounts();

    // Seed: when ClawX store is empty but OpenClaw config has providers,
    // create ProviderAccount entries so the settings panel isn't blank.
    // This covers users who configured providers via CLI or openclaw.json directly.
    if (accounts.length === 0) {
      const activeProviders = await getActiveOpenClawProviders();
      if (activeProviders.size > 0) {
        accounts = await this.seedAccountsFromOpenClawConfig();
      }
      return accounts;
    }

    // Sync check: remove stale accounts whose provider no longer exists in
    // OpenClaw JSON (e.g. user deleted openclaw.json manually).
    {
      const activeProviders = await getActiveOpenClawProviders();

      // If the OpenClaw config is empty or unreadable, skip cleanup entirely
      // to avoid accidentally wiping valid accounts during transient states
      // (e.g. gateway restart, file lock, first launch before config sync).
      if (activeProviders.size === 0) {
        logger.warn(
          '[provider-sync] OpenClaw config has no active providers — skipping stale-account cleanup to preserve existing accounts',
        );
        return accounts;
      }

      const staleIds: string[] = [];

      for (const account of accounts) {
        const isBuiltin = (BUILTIN_PROVIDER_TYPES as readonly string[]).includes(account.vendorId);
        // Builtin providers (anthropic, openai, etc.) are always retained
        // because they don't require an explicit models.providers entry in
        // openclaw.json — the runtime recognises them natively.
        if (isBuiltin) continue;

        const openClawKey = getOpenClawProviderKeyForType(account.vendorId, account.id);
        const isActive =
          activeProviders.has(account.vendorId) ||
          activeProviders.has(account.id) ||
          activeProviders.has(openClawKey);

        if (!isActive) {
          staleIds.push(account.id);
        }
      }

      if (staleIds.length > 0) {
        for (const id of staleIds) {
          logger.info(`[provider-sync] Removing stale provider account "${id}" (no longer in OpenClaw config)`);
          await deleteProviderAccount(id);
        }
        return accounts.filter((a) => !staleIds.includes(a.id));
      }
    }

    return accounts;
  }

  /**
   * Seed the ClawX provider store from openclaw.json when the store is empty.
   * This is a one-time operation for users who configured providers externally.
   */
  private async seedAccountsFromOpenClawConfig(): Promise<ProviderAccount[]> {
    const { providers, defaultModel } = await getOpenClawProvidersConfig();

    // Determine the provider prefix from the default model (e.g. "siliconflow/deepseek..." → "siliconflow")
    const defaultModelProvider = defaultModel?.includes('/')
      ? defaultModel.split('/')[0]
      : undefined;

    const now = new Date().toISOString();
    const seeded: ProviderAccount[] = [];

    for (const [key, entry] of Object.entries(providers)) {
      const definition = getProviderDefinition(key);
      const isBuiltin = (BUILTIN_PROVIDER_TYPES as readonly string[]).includes(key);
      const vendorId = isBuiltin ? key : 'custom';

      const baseUrl = typeof entry.baseUrl === 'string' ? entry.baseUrl : definition?.providerConfig?.baseUrl;

      // Infer model from the default model if it belongs to this provider
      let model: string | undefined;
      if (defaultModelProvider === key && defaultModel) {
        model = defaultModel;
      } else if (definition?.defaultModelId) {
        model = definition.defaultModelId;
      }

      const account: ProviderAccount = {
        id: key,
        vendorId: (vendorId as ProviderAccount['vendorId']),
        label: definition?.name ?? key.charAt(0).toUpperCase() + key.slice(1),
        authMode: definition?.defaultAuthMode ?? 'api_key',
        baseUrl,
        apiProtocol: definition?.providerConfig?.api,
        headers: (entry.headers && typeof entry.headers === 'object'
          ? (entry.headers as Record<string, string>)
          : undefined),
        model,
        enabled: true,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      };

      await saveProviderAccount(account);
      seeded.push(account);
    }

    if (seeded.length > 0) {
      logger.info(
        `[provider-seed] Seeded ${seeded.length} provider account(s) from openclaw.json: ${seeded.map((a) => a.id).join(', ')}`,
      );
    }

    return seeded;
  }

  async getAccount(accountId: string): Promise<ProviderAccount | null> {
    await ensureProviderStoreMigrated();
    return getProviderAccount(accountId);
  }

  async getDefaultAccountId(): Promise<string | undefined> {
    await ensureProviderStoreMigrated();
    return getDefaultProviderAccountId();
  }

  async createAccount(account: ProviderAccount, apiKey?: string): Promise<ProviderAccount> {
    await ensureProviderStoreMigrated();
    await saveProvider(providerAccountToConfig(account));
    await saveProviderAccount(account);
    if (apiKey !== undefined && apiKey.trim()) {
      await storeApiKey(account.id, apiKey.trim());
    }
    return (await getProviderAccount(account.id)) ?? account;
  }

  async updateAccount(
    accountId: string,
    patch: Partial<ProviderAccount>,
    apiKey?: string,
  ): Promise<ProviderAccount> {
    await ensureProviderStoreMigrated();
    const existing = await getProviderAccount(accountId);
    if (!existing) {
      throw new Error('Provider account not found');
    }

    const nextAccount: ProviderAccount = {
      ...existing,
      ...patch,
      id: accountId,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };

    await saveProvider(providerAccountToConfig(nextAccount));
    await saveProviderAccount(nextAccount);
    if (apiKey !== undefined) {
      const trimmedKey = apiKey.trim();
      if (trimmedKey) {
        await storeApiKey(accountId, trimmedKey);
      } else {
        await deleteApiKey(accountId);
      }
    }

    return (await getProviderAccount(accountId)) ?? nextAccount;
  }

  async deleteAccount(accountId: string): Promise<boolean> {
    await ensureProviderStoreMigrated();
    return deleteProvider(accountId);
  }

  /**
   * @deprecated Use listAccounts() and map account data in callers.
   */
  async listLegacyProviders(): Promise<ProviderConfig[]> {
    logLegacyProviderApiUsage('listLegacyProviders', 'listAccounts');
    await ensureProviderStoreMigrated();
    const accounts = await listProviderAccounts();
    return accounts.map(providerAccountToConfig);
  }

  /**
   * @deprecated Use listAccounts() + secret-store based key summary.
   */
  async listLegacyProvidersWithKeyInfo(): Promise<ProviderWithKeyInfo[]> {
    logLegacyProviderApiUsage('listLegacyProvidersWithKeyInfo', 'listAccounts');
    const providers = await this.listLegacyProviders();
    const results: ProviderWithKeyInfo[] = [];
    for (const provider of providers) {
      const apiKey = await getApiKey(provider.id);
      results.push({
        ...provider,
        hasKey: !!apiKey,
        keyMasked: maskApiKey(apiKey),
      });
    }
    return results;
  }

  /**
   * @deprecated Use getAccount(accountId).
   */
  async getLegacyProvider(providerId: string): Promise<ProviderConfig | null> {
    logLegacyProviderApiUsage('getLegacyProvider', 'getAccount');
    await ensureProviderStoreMigrated();
    const account = await getProviderAccount(providerId);
    return account ? providerAccountToConfig(account) : null;
  }

  /**
   * @deprecated Use createAccount()/updateAccount().
   */
  async saveLegacyProvider(config: ProviderConfig): Promise<void> {
    logLegacyProviderApiUsage('saveLegacyProvider', 'createAccount/updateAccount');
    await ensureProviderStoreMigrated();
    const account = providerConfigToAccount(config);
    const existing = await getProviderAccount(config.id);
    if (existing) {
      await this.updateAccount(config.id, account);
      return;
    }
    await this.createAccount(account);
  }

  /**
   * @deprecated Use deleteAccount(accountId).
   */
  async deleteLegacyProvider(providerId: string): Promise<boolean> {
    logLegacyProviderApiUsage('deleteLegacyProvider', 'deleteAccount');
    await ensureProviderStoreMigrated();
    await this.deleteAccount(providerId);
    return true;
  }

  /**
   * @deprecated Use setDefaultAccount(accountId).
   */
  async setDefaultLegacyProvider(providerId: string): Promise<void> {
    logLegacyProviderApiUsage('setDefaultLegacyProvider', 'setDefaultAccount');
    await this.setDefaultAccount(providerId);
  }

  /**
   * @deprecated Use getDefaultAccountId().
   */
  async getDefaultLegacyProvider(): Promise<string | undefined> {
    logLegacyProviderApiUsage('getDefaultLegacyProvider', 'getDefaultAccountId');
    return this.getDefaultAccountId();
  }

  /**
   * @deprecated Use secret-store APIs by accountId.
   */
  async setLegacyProviderApiKey(providerId: string, apiKey: string): Promise<boolean> {
    logLegacyProviderApiUsage('setLegacyProviderApiKey', 'setProviderSecret(accountId, api_key)');
    return storeApiKey(providerId, apiKey);
  }

  /**
   * @deprecated Use secret-store APIs by accountId.
   */
  async getLegacyProviderApiKey(providerId: string): Promise<string | null> {
    logLegacyProviderApiUsage('getLegacyProviderApiKey', 'getProviderSecret(accountId)');
    return getApiKey(providerId);
  }

  /**
   * @deprecated Use secret-store APIs by accountId.
   */
  async deleteLegacyProviderApiKey(providerId: string): Promise<boolean> {
    logLegacyProviderApiUsage('deleteLegacyProviderApiKey', 'deleteProviderSecret(accountId)');
    return deleteApiKey(providerId);
  }

  /**
   * @deprecated Use secret-store APIs by accountId.
   */
  async hasLegacyProviderApiKey(providerId: string): Promise<boolean> {
    logLegacyProviderApiUsage('hasLegacyProviderApiKey', 'getProviderSecret(accountId)');
    return hasApiKey(providerId);
  }

  async setDefaultAccount(accountId: string): Promise<void> {
    await ensureProviderStoreMigrated();
    await setDefaultProviderAccount(accountId);
    await setDefaultProvider(accountId);
  }

  getVendorDefinition(vendorId: string): ProviderDefinition | undefined {
    return getProviderDefinition(vendorId);
  }
}

const providerService = new ProviderService();

export function getProviderService(): ProviderService {
  return providerService;
}
