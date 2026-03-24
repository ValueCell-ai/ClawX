import {
  PROVIDER_DEFINITIONS,
  getProviderDefinition,
} from '../../shared/providers/registry';
import type {
  ProviderAccount,
  ProviderConfig,
  ProviderDefinition,
  ProviderType,
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
  setDefaultProvider,
  storeApiKey,
} from '../../utils/secure-storage';
import { getActiveOpenClawProviders, getOpenClawProvidersConfig } from '../../utils/openclaw-auth';
import { getAliasSourceTypes, getOpenClawProviderKeyForType } from '../../utils/provider-keys';
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

    // ── openclaw.json is the ONLY source of truth ──
    // The provider list is derived entirely from openclaw.json.
    // The electron-store is only used as a metadata cache (label, authMode, etc.).

    const { providers: openClawProviders, defaultModel } = await getOpenClawProvidersConfig();
    const activeProviders = await getActiveOpenClawProviders();

    if (activeProviders.size === 0) {
      return [];
    }

    // Read store accounts as a lookup cache (NOT as the source of what to display).
    const allStoreAccounts = await listProviderAccounts();

    // Index store accounts by their openclaw runtime key for fast lookup.
    const storeByKey = new Map<string, ProviderAccount[]>();
    for (const account of allStoreAccounts) {
      const ock = getOpenClawProviderKeyForType(account.vendorId, account.id);
      const group = storeByKey.get(ock) ?? [];
      group.push(account);
      storeByKey.set(ock, group);
    }

    const result: ProviderAccount[] = [];
    const processedKeys = new Set<string>();

    // For each active provider in openclaw.json, produce exactly ONE account.
    for (const key of activeProviders) {
      if (processedKeys.has(key)) continue;
      processedKeys.add(key);

      const storeGroup = storeByKey.get(key) ?? [];

      if (storeGroup.length > 0) {
        // Pick the best store account for this key:
        // 1. Prefer alias variants (e.g. minimax-portal-cn over minimax-portal)
        // 2. Among equal variants, prefer the most recently updated
        const aliasAccounts = storeGroup.filter((a) => a.vendorId !== key);
        const candidates = aliasAccounts.length > 0 ? aliasAccounts : storeGroup;
        candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        result.push(candidates[0]);

        // Clean up orphaned duplicates from the store.
        const kept = candidates[0];
        for (const account of storeGroup) {
          if (account.id !== kept.id) {
            logger.info(
              `[provider-sync] Removing orphaned account "${account.id}" for key "${key}" (keeping "${kept.id}")`,
            );
            await deleteProviderAccount(account.id);
          }
        }
      } else {
        // No store account for this key — create a seed from openclaw.json.
        const entry = openClawProviders[key];
        if (entry) {
          const seeded = ProviderService.buildAccountsFromOpenClawEntries(
            { [key]: entry },
            new Set(),
            new Set(),
            defaultModel,
          );
          for (const account of seeded) {
            await saveProviderAccount(account);
            result.push(account);
            logger.info(`[provider-sync] Seeded provider account "${account.id}" from openclaw.json`);
          }
        }
      }
    }

    return result;
  }



  /**
   * Build ProviderAccount objects from OpenClaw config entries, skipping any
   * whose id or vendorId is already represented by an existing account.
   */
  static buildAccountsFromOpenClawEntries(
    providers: Record<string, Record<string, unknown>>,
    existingIds: Set<string>,
    existingVendorIds: Set<string>,
    defaultModel: string | undefined,
  ): ProviderAccount[] {
    const defaultModelProvider = defaultModel?.includes('/')
      ? defaultModel.split('/')[0]
      : undefined;

    const now = new Date().toISOString();
    const built: ProviderAccount[] = [];

    for (const [key, entry] of Object.entries(providers)) {
      if (existingIds.has(key)) continue;

      const definition = getProviderDefinition(key);
      const isBuiltin = (BUILTIN_PROVIDER_TYPES as readonly string[]).includes(key);
      const vendorId = isBuiltin ? key : 'custom';

      // Skip if an account with this vendorId already exists (e.g. user already
      // created "openrouter-uuid" via UI — no need to import bare "openrouter").
      if (existingVendorIds.has(vendorId)) continue;

      // Skip if an alias source type already exists.
      // e.g. openclaw.json has "minimax-portal" but account vendorId is "minimax-portal-cn"
      const aliasSources = getAliasSourceTypes(key);
      if (aliasSources.some((source) => existingVendorIds.has(source))) {
        continue;
      }

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
        vendorId: (vendorId as ProviderAccount['vendorId'] as ProviderType),
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

      built.push(account);
    }

    return built;
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
    // Only save to providerAccounts store — do NOT call saveProvider() which
    // writes to the legacy `providers` store and causes phantom/duplicate issues.
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

    // Only save to providerAccounts store — skip legacy saveProvider().
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
    const accounts = await this.listAccounts();
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
