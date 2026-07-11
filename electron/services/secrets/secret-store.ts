import type { ProviderSecret } from '../../shared/providers/types';
import { getClawXProviderStore } from '../providers/store-instance';
import { deleteVaultSecret, getVaultSecret, setVaultSecret } from './credential-vault';

export interface SecretStore {
  get(accountId: string): Promise<ProviderSecret | null>;
  set(secret: ProviderSecret): Promise<void>;
  delete(accountId: string): Promise<void>;
}

export class ElectronStoreSecretStore implements SecretStore {
  async get(accountId: string): Promise<ProviderSecret | null> {
    const encrypted = await getVaultSecret(accountId);
    if (encrypted) {
      const store = await getClawXProviderStore();
      await this.clearLegacySecret(store, accountId);
      return encrypted;
    }

    const store = await getClawXProviderStore();
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, ProviderSecret>;
    const secret = secrets[accountId];
    if (secret) {
      await setVaultSecret(secret);
      await this.clearLegacySecret(store, accountId);
      return secret;
    }

    const apiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
    const apiKey = apiKeys[accountId];
    if (!apiKey) {
      return null;
    }

    const migrated: ProviderSecret = {
      type: 'api_key',
      accountId,
      apiKey,
    };
    await setVaultSecret(migrated);
    await this.clearLegacySecret(store, accountId);
    return migrated;
  }

  async set(secret: ProviderSecret): Promise<void> {
    await setVaultSecret(secret);
    const store = await getClawXProviderStore();
    await this.clearLegacySecret(store, secret.accountId);
  }

  async delete(accountId: string): Promise<void> {
    await deleteVaultSecret(accountId);
    const store = await getClawXProviderStore();
    await this.clearLegacySecret(store, accountId);
  }

  private async clearLegacySecret(store: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  }, accountId: string): Promise<void> {
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, ProviderSecret>;
    delete secrets[accountId];
    store.set('providerSecrets', secrets);

    const apiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
    delete apiKeys[accountId];
    store.set('apiKeys', apiKeys);
  }
}

export async function migrateLegacyProviderSecretsToVault(): Promise<number> {
  const store = await getClawXProviderStore();
  const legacySecrets = (store.get('providerSecrets') ?? {}) as Record<string, ProviderSecret>;
  const legacyApiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
  const accountIds = new Set([...Object.keys(legacyApiKeys), ...Object.keys(legacySecrets)]);
  if (accountIds.size === 0) return 0;

  for (const accountId of accountIds) {
    const existing = await getVaultSecret(accountId);
    if (existing) continue;
    const secret = legacySecrets[accountId] ?? (legacyApiKeys[accountId]
      ? { type: 'api_key' as const, accountId, apiKey: legacyApiKeys[accountId] }
      : undefined);
    if (secret) await setVaultSecret(secret);
  }

  store.set('providerSecrets', {});
  store.set('apiKeys', {});
  return accountIds.size;
}

const secretStore = new ElectronStoreSecretStore();

export function getSecretStore(): SecretStore {
  return secretStore;
}

export async function getProviderSecret(accountId: string): Promise<ProviderSecret | null> {
  return getSecretStore().get(accountId);
}

export async function setProviderSecret(secret: ProviderSecret): Promise<void> {
  await getSecretStore().set(secret);
}

export async function deleteProviderSecret(accountId: string): Promise<void> {
  await getSecretStore().delete(accountId);
}
