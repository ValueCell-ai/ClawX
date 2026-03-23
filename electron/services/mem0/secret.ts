import {
  deleteProviderSecret,
  getProviderSecret,
  setProviderSecret,
} from '../secrets/secret-store';
import { MEM0_SECRET_ACCOUNT_ID } from '../../../shared/mem0';

export async function getMem0ApiKey(): Promise<string | null> {
  const secret = await getProviderSecret(MEM0_SECRET_ACCOUNT_ID);
  if (secret?.type === 'api_key') {
    return secret.apiKey;
  }
  if (secret?.type === 'local') {
    return secret.apiKey ?? null;
  }
  return null;
}

export async function hasMem0ApiKey(): Promise<boolean> {
  return Boolean(await getMem0ApiKey());
}

export async function setMem0ApiKey(apiKey: string): Promise<void> {
  await setProviderSecret({
    type: 'api_key',
    accountId: MEM0_SECRET_ACCOUNT_ID,
    apiKey,
  });
}

export async function deleteMem0ApiKey(): Promise<void> {
  await deleteProviderSecret(MEM0_SECRET_ACCOUNT_ID);
}
