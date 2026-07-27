import type { ProviderSecret } from '../../shared/providers/types';
import { getClawXProviderStore } from '../providers/store-instance';

export interface SecretStore {
  get(accountId: string): Promise<ProviderSecret | null>;
  set(secret: ProviderSecret): Promise<void>;
  delete(accountId: string): Promise<void>;
}

export class ElectronStoreSecretStore implements SecretStore {
  async get(accountId: string): Promise<ProviderSecret | null> {
    const store = await getClawXProviderStore();
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, ProviderSecret>;
    const secret = secrets[accountId];
    if (secret) {
      return secret;
    }

    const apiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
    const apiKey = apiKeys[accountId];
    if (!apiKey) {
      return null;
    }

    return {
      type: 'api_key',
      accountId,
      apiKey,
    };
  }

  async set(secret: ProviderSecret): Promise<void> {
    const store = await getClawXProviderStore();
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, ProviderSecret>;
    secrets[secret.accountId] = secret;
    store.set('providerSecrets', secrets);

    // Keep legacy apiKeys in sync until the rest of the app moves to account-based secrets.
    const apiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
    if (secret.type === 'api_key') {
      apiKeys[secret.accountId] = secret.apiKey;
    } else if (secret.type === 'local') {
      if (secret.apiKey) {
        apiKeys[secret.accountId] = secret.apiKey;
      } else {
        delete apiKeys[secret.accountId];
      }
    } else {
      delete apiKeys[secret.accountId];
    }
    store.set('apiKeys', apiKeys);
  }

  async delete(accountId: string): Promise<void> {
    const store = await getClawXProviderStore();
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, ProviderSecret>;
    delete secrets[accountId];
    store.set('providerSecrets', secrets);

    const apiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
    delete apiKeys[accountId];
    store.set('apiKeys', apiKeys);
  }
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
