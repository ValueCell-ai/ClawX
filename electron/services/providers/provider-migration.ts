import type { ProviderConfig } from '../../shared/providers/types';
import {
  getDefaultProviderAccountId,
  providerConfigToAccount,
  saveProviderAccount,
} from './provider-store';
import { getClawXProviderStore } from './store-instance';

const PROVIDER_STORE_SCHEMA_VERSION = 2;

export async function ensureProviderStoreMigrated(): Promise<void> {
  const store = await getClawXProviderStore();
  const schemaVersion = Number(store.get('schemaVersion') ?? 0);

  if (schemaVersion >= PROVIDER_STORE_SCHEMA_VERSION) {
    return;
  }

  // v0 → v1: migrate legacy `providers` entries to `providerAccounts`.
  if (schemaVersion < 1) {
    const legacyProviders = (store.get('providers') ?? {}) as Record<string, ProviderConfig>;
    const defaultProviderId = (store.get('defaultProvider') ?? null) as string | null;
    const existingDefaultAccountId = await getDefaultProviderAccountId();

    for (const provider of Object.values(legacyProviders)) {
      const account = providerConfigToAccount(provider, {
        isDefault: provider.id === defaultProviderId,
      });
      await saveProviderAccount(account);
    }

    if (!existingDefaultAccountId && defaultProviderId) {
      store.set('defaultProviderAccountId', defaultProviderId);
    }
  }

  // v1 → v2: clear the legacy `providers` store.
  // The old `saveProvider()` was duplicating entries into this store, causing
  // phantom and duplicate accounts when the migration above re-runs.
  // Now that createAccount/updateAccount no longer write to `providers`,
  // we clear it to prevent stale entries from causing issues.
  if (schemaVersion < 2) {
    store.set('providers', {});
  }

  store.set('schemaVersion', PROVIDER_STORE_SCHEMA_VERSION);
}
