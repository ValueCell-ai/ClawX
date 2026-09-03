import type { AsrConfig } from '@shared/host-api/contract';
import { deleteProviderSecret, getProviderSecret, setProviderSecret } from '../secrets/secret-store';

export const ASR_SECRET_ACCOUNT_ID = 'asr';
export const ASR_CONFIG_STORE_KEY = 'asrConfig';

// Lazy-load electron-store (ESM module) from the main process only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asrStore: any = null;

async function getAsrStore() {
  if (!asrStore) {
    const Store = (await import('electron-store')).default;
    asrStore = new Store({
      name: 'clawx-asr',
      defaults: {
        asrConfig: null as AsrConfig | null,
      },
    });
  }

  return asrStore;
}

export async function getAsrConfig(): Promise<AsrConfig | null> {
  const store = await getAsrStore();
  const config = store.get(ASR_CONFIG_STORE_KEY) as AsrConfig | null;
  return config ?? null;
}

export async function setAsrConfig(config: AsrConfig): Promise<void> {
  const store = await getAsrStore();
  store.set(ASR_CONFIG_STORE_KEY, config);
}

export async function getAsrApiKey(): Promise<string | null> {
  const secret = await getProviderSecret(ASR_SECRET_ACCOUNT_ID);
  if (secret && 'apiKey' in secret && typeof secret.apiKey === 'string') {
    return secret.apiKey;
  }
  return null;
}

export async function setAsrApiKey(apiKey: string): Promise<void> {
  if (apiKey === '') {
    await deleteProviderSecret(ASR_SECRET_ACCOUNT_ID);
    return;
  }
  await setProviderSecret({ type: 'api_key', accountId: ASR_SECRET_ACCOUNT_ID, apiKey });
}

export async function resolveAsrReadiness(): Promise<{
  config: AsrConfig | null;
  hasApiKey: boolean;
  configured: boolean;
}> {
  const [config, apiKey] = await Promise.all([getAsrConfig(), getAsrApiKey()]);
  const hasApiKey = apiKey !== null;
  return { config, hasApiKey, configured: config !== null && hasApiKey };
}
